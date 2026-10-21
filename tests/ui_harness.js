"use strict";
// Shared by the browser tests (ui*.test.js): a static server for the page, a headless Chromium driven over the
// DevTools protocol, and a fake navigator.hid for the real WebHID path. No controller is needed.
// `skip` is set when Chromium or Node's WebSocket client is not available.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const chromium = ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "microsoft-edge"]
  .map(n => spawnSync("which", [n], { encoding: "utf8" })).find(r => r.status === 0)?.stdout.trim();
const skip = !chromium ? "Chromium not installed" : typeof WebSocket === "undefined" ? "no WebSocket client in this Node" : false;

const h = { skip, base: null, notFound: [] };
let server, browser, profile, cdp, injected = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer() {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/blank") { res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>blank</title><link rel="icon" href="data:,">`); return; }
    const file = path.join(ROOT, path.normalize(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { h.notFound.push(req.url); res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => { h.base = `http://127.0.0.1:${server.address().port}`; r(); }));
}

async function startBrowser() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "ms3-ui-"));
  const args = ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--disable-extensions",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"];
  if (process.getuid && process.getuid() === 0) args.unshift("--no-sandbox");
  browser = spawn(chromium, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });   // its own process group, so teardown can reach every child
  const port = await new Promise((resolve, reject) => {
    let buf = "";
    const giveUp = setTimeout(() => reject(new Error("Chromium did not start")), 15000);
    browser.stderr.on("data", d => { buf += d; const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(giveUp); resolve(m[1]); } });
    browser.on("exit", () => { clearTimeout(giveUp); reject(new Error("Chromium exited early")); });
  });
  let page;   // the first page can take a moment to be listed after "DevTools listening"
  for (let tries = 0; tries < 50 && !page; tries++) {
    page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === "page");
    if (!page) await sleep(100);
  }
  if (!page) throw new Error("Chromium has no page to drive");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", () => reject(new Error("could not connect to Chromium's DevTools"))); });
  let id = 0;
  const pending = new Map(), handlers = [];
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { ok, bad } = pending.get(m.id); pending.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); }
    else if (m.method) handlers.forEach(fn => fn(m.method, m.params));
  });
  cdp = {
    send: (method, params = {}) => new Promise((ok, bad) => { const n = ++id; pending.set(n, { ok, bad }); ws.send(JSON.stringify({ id: n, method, params })); }),
    on: fn => handlers.push(fn),
    close: () => ws.close(),
  };
  h.cdp = cdp;
}

async function setup() { if (!skip) { await startServer(); await startBrowser(); } }

// Chromium's helper processes can outlive the main one by a moment and write into the profile again, so: stop the main
// process, then everything left in its group, and remove the profile until it stays gone.
async function teardown() {
  if (skip) return;
  cdp?.close();
  server?.closeAllConnections?.();
  server?.close();
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    const exited = new Promise(r => browser.once("exit", r));
    browser.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  try { process.kill(-browser.pid, "SIGKILL"); } catch (e) { /* nothing left in the group */ }
  for (let i = 0; i < 20; i++) {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await sleep(150);
    if (!fs.existsSync(profile)) return;
  }
}

// Open a page and collect everything that should never happen: console errors, CSP reports, third-party requests.
async function open(urlPath, { beforeLoad, storage } = {}) {
  const seen = { errors: [], requests: [] };
  cdp.on((method, p) => {
    if (method === "Runtime.exceptionThrown") seen.errors.push(p.exceptionDetails.text + " " + (p.exceptionDetails.exception?.description || ""));
    if (method === "Runtime.consoleAPICalled" && p.type === "error") seen.errors.push(p.args.map(a => a.value ?? a.description).join(" "));
    if (method === "Log.entryAdded" && p.entry.level === "error") seen.errors.push(p.entry.text);
    if (method === "Network.requestWillBeSent") seen.requests.push(p.request.url);
  });
  await Promise.all(["Page", "Runtime", "Log", "Network"].map(d => cdp.send(`${d}.enable`)));
  if (injected) { await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: injected }); injected = null; }
  await cdp.send("Page.navigate", { url: `${h.base}/blank` });   // a page on the same origin, to set storage on
  if (storage !== undefined) await ev(`localStorage.setItem("ms3settings", ${JSON.stringify(storage)})`);
  else await ev(`localStorage.clear()`);
  if (beforeLoad) injected = (await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: beforeLoad })).identifier;
  seen.requests.length = 0;
  seen.errors.length = 0;
  h.notFound.length = 0;
  await cdp.send("Page.navigate", { url: `${h.base}${urlPath}` });
  await waitFor(`document.readyState === "complete"`, 20000);   // a cold browser on a busy machine can be slow to load the first page
  return seen;
}

async function ev(expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(expression, ms = Number(process.env.MS3_UI_WAIT) || 6000) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await ev(expression); if (v) return v; } catch (e) { /* page still loading */ }
    if (Date.now() > end) throw new Error(`timed out waiting for: ${expression}`);
    await sleep(50);
  }
}

// ---- a fake navigator.hid, injected before the page loads ----
// Pads: `dev` ("Wireless Controller", plugged in), `second`, and three Sony devices the page must never pick: a headset,
// a device with a controller's product id but no gamepad collection, and a DualSense (a gamepad with another layout).
// Knobs, set before load: __notGranted, __failOpen, __failSend, __failRequest, __pickNothing, __withHeadset, __withDualSense,
// __slowFirstLook (the first getDevices() answers late, with the list as it was), __openGate (a promise that open() waits for). Every pad records the "inputreport" listeners it has (`listening`)
// and the reports it was sent (`sent`).
const FAKE_HID = `(() => {
  const hid = new EventTarget();
  function pad(name, productId, usagePage) {
    const d = new EventTarget(), listening = new Set();
    const add = d.addEventListener.bind(d), remove = d.removeEventListener.bind(d);
    d.addEventListener = (type, fn, o) => { if (type === "inputreport") listening.add(fn); add(type, fn, o); };
    d.removeEventListener = (type, fn, o) => { if (type === "inputreport") listening.delete(fn); remove(type, fn, o); };
    return Object.assign(d, { vendorId: 0x054c, productId, productName: name, opened: false, listening, sent: [], featureReads: 0,
      collections: [{ usagePage, usage: 5 }],
      async open() { window.__opening = true; if (window.__openGate) await window.__openGate; if (window.__failOpen) throw new Error("access denied"); this.opened = true; },
      async receiveFeatureReport() { this.featureReads++; throw new Error("not needed on USB"); },
      async sendReport(id, data) { if (window.__failSend) throw new Error("device busy"); this.sent.push([id, Array.from(data)]); } });
  }
  const dev = pad("Wireless Controller", 0x09cc, 1), second = pad("Second Controller", 0x09cc, 1);
  const headset = pad("Sony Headset", 0x0ce6, 0xff00), vendorOnly = pad("Sony vendor-defined", 0x09cc, 0xff00);
  const dualsense = pad("DualSense Wireless Controller", 0x0ce6, 1);
  const present = new Set([dev]);   // what is plugged in
  window.__fake = {
    dev, second, headset, vendorOnly, dualsense, filters: null, granted: !window.__notGranted,
    // a USB input report: sticks centred, hat neutral, then whatever bytes the test sets; t is the event's timeStamp
    send(patch = {}, t, d = dev) {
      const b = new Uint8Array(63); b.fill(128, 0, 4); b[4] = 0x08;
      for (const [i, v] of Object.entries(patch)) b[i] = v;
      this.sendRaw(b, d, 1, t);
    },
    sendRaw(bytes, d = dev, reportId = 1, t) {
      const ev = new Event("inputreport"); ev.reportId = reportId; ev.data = new DataView(new Uint8Array(bytes).buffer);
      if (t !== undefined) Object.defineProperty(ev, "timeStamp", { value: t });
      d.dispatchEvent(ev);
    },
    unplugQuietly(d = dev) { present.delete(d); },   // gone from the list, with no disconnect event
    fire(type, d = dev) { if (type === "connect") present.add(d); else present.delete(d); const ev = new Event(type); ev.device = d; hid.dispatchEvent(ev); },
  };
  let looks = 0;
  hid.getDevices = async () => {
    if (!window.__fake.granted) return [];
    const others = [];
    if (window.__withHeadset) others.push(headset, vendorOnly);
    if (window.__withDualSense) others.push(dualsense);
    const list = [...others, ...[...present].sort((a, b) => a.productName.localeCompare(b.productName))];   // taken now, delivered later if slow
    if (window.__slowFirstLook && ++looks === 1) await new Promise(r => setTimeout(r, 700));
    return list;
  };
  hid.requestDevice = async opts => {
    if (window.__failRequest) throw new Error("blocked by policy");
    window.__fake.filters = opts.filters; window.__fake.granted = true;
    return window.__pickNothing ? [] : [dev];
  };
  Object.defineProperty(Navigator.prototype, "hid", { get: () => hid, configurable: true });
})();`;

Object.assign(h, { setup, teardown, open, ev, waitFor, sleep, FAKE_HID });
module.exports = h;
