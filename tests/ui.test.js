"use strict";
// Browser-level tests: the real page in headless Chromium, driven over the DevTools protocol.
// The page's demo mode (?demo) stands in for a controller, so no hardware is needed.
// Skipped when Chromium or Node's WebSocket client is not available.
const test = require("node:test");
const assert = require("node:assert/strict");
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

let server, base, browser, profile, cdp, injected = null;
const notFound = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startServer() {
  server = http.createServer((req, res) => {
    if (new URL(req.url, "http://x").pathname === "/blank") { res.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>blank</title><link rel="icon" href="data:,">`); return; }
    const file = path.join(ROOT, path.normalize(new URL(req.url, "http://x").pathname === "/" ? "/index.html" : new URL(req.url, "http://x").pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { notFound.push(req.url); res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => { base = `http://127.0.0.1:${server.address().port}`; r(); }));
}

async function startBrowser() {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "ms3-ui-"));
  const args = ["--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--disable-extensions",
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"];
  if (process.getuid && process.getuid() === 0) args.unshift("--no-sandbox");
  browser = spawn(chromium, args, { stdio: ["ignore", "ignore", "pipe"] });
  const port = await new Promise((resolve, reject) => {
    let buf = "";
    browser.stderr.on("data", d => { buf += d; const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/); if (m) resolve(m[1]); });
    browser.on("exit", () => reject(new Error("Chromium exited early")));
    setTimeout(() => reject(new Error("Chromium did not start")), 15000);
  });
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map(), handlers = [];
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { ok, bad } = pending.get(m.id); pending.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); }
    else if (m.method) handlers.forEach(h => h(m.method, m.params));
  });
  cdp = {
    send: (method, params = {}) => new Promise((ok, bad) => { const n = ++id; pending.set(n, { ok, bad }); ws.send(JSON.stringify({ id: n, method, params })); }),
    on: h => handlers.push(h),
    close: () => ws.close(),
  };
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
  await cdp.send("Page.navigate", { url: `${base}/blank` });   // a page on the same origin, to set storage on
  if (storage !== undefined) await ev(`localStorage.setItem("ms3settings", ${JSON.stringify(storage)})`);
  else await ev(`localStorage.clear()`);
  if (beforeLoad) injected = (await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: beforeLoad })).identifier;
  seen.requests.length = 0;
  seen.errors.length = 0;
  notFound.length = 0;
  await cdp.send("Page.navigate", { url: `${base}${urlPath}` });
  await waitFor(`document.readyState === "complete"`);
  return seen;
}

async function ev(expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

async function waitFor(expression, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await ev(expression); if (v) return v; } catch (e) { /* page still loading */ }
    if (Date.now() > end) throw new Error(`timed out waiting for: ${expression}`);
    await sleep(50);
  }
}

test.before(async () => { if (!skip) { await startServer(); await startBrowser(); } });
test.after(async () => {
  if (skip) return;
  cdp?.close(); browser?.kill(); server?.close(); fs.rmSync(profile, { recursive: true, force: true });
});

test("demo mode renders the controller with no console errors and no third-party requests", { skip }, async () => {
  const seen = await open("/?demo");
  await waitFor(`document.querySelector("#statusText").textContent.includes("Demo")`);
  assert.equal(await ev(`document.querySelectorAll(".key").length`), 19);
  const foreign = seen.requests.filter(u => !u.startsWith(base) && !u.startsWith("data:"));
  assert.deepEqual(foreign, []);
  assert.deepEqual(seen.errors, [], `404s: ${notFound.join(", ")}`);
});

test("the page's content security policy forbids network requests", { skip }, async () => {
  await open("/?demo");
  const directive = await ev(`new Promise(res => {
    document.addEventListener("securitypolicyviolation", e => res(e.effectiveDirective));
    fetch("https://example.com/").catch(() => {});
    setTimeout(() => res("no violation"), 2000);
  })`);
  assert.equal(directive, "connect-src");
});

test("demo mode shows USB at about 250 Hz, lights keys, and reads the battery like the Linux driver", { skip }, async () => {
  await open("/?demo");
  await waitFor(`document.querySelector("#rate").textContent.trim() !== "—"`);
  const rate = Number(await ev(`document.querySelector("#rate").textContent`));
  assert.ok(rate >= 200 && rate <= 300, `rate ${rate}`);
  assert.equal(await ev(`document.querySelector("#transport").textContent`), "USB");
  assert.match(await ev(`document.querySelector("#battery").textContent`), /85%/);
  assert.equal((await ev(`document.querySelector("#rateChip").textContent`)).trim(), "GOOD");
  await waitFor(`document.querySelectorAll(".key.on").length >= 1`);
});

test("a slow report stream is graded SLOW and warns that bounces cannot be seen", { skip }, async () => {
  await open("/?demo=slow");
  await waitFor(`document.querySelector("#rateChip").textContent.trim() === "SLOW"`);
  assert.equal(await ev(`document.querySelector("#healthNote").hidden`), false);
  assert.match(await ev(`document.querySelector("#healthNote").textContent`), /16\.\d ms.*bounces/);
});

test("pressing Connect again keeps the stream flowing at the same rate", { skip }, async () => {
  await open("/?demo");
  await waitFor(`document.querySelector("#rate").textContent.trim() !== "—"`);
  await ev(`for (let i = 0; i < 3; i++) document.querySelector("#connect").click()`);
  await sleep(1200);
  const rate = Number(await ev(`document.querySelector("#rate").textContent`));
  assert.ok(rate >= 200 && rate <= 300, `rate ${rate} after reconnecting`);
});

test("the settings drawer is out of the tab order until opened, and gives focus back when closed", { skip }, async () => {
  await open("/?demo");
  assert.equal(await ev(`getComputedStyle(document.querySelector("#drawer")).visibility`), "hidden");
  await ev(`document.querySelector("#openSettings").focus(); document.querySelector("#openSettings").click()`);
  await waitFor(`getComputedStyle(document.querySelector("#drawer")).visibility === "visible"`);
  assert.equal(await ev(`document.querySelector("#openSettings").getAttribute("aria-expanded")`), "true");
  assert.equal(await ev(`document.querySelector("#drawer").contains(document.activeElement)`), true);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await waitFor(`getComputedStyle(document.querySelector("#drawer")).visibility === "hidden"`);
  assert.equal(await ev(`document.activeElement.id`), "openSettings");
  assert.equal(await ev(`document.querySelector("#openSettings").getAttribute("aria-expanded")`), "false");
});

test("choosing the 1P-4K labels relabels the keys like the manual", { skip }, async () => {
  await open("/?demo");
  await ev(`const s = document.querySelector("#sLabels"); s.value = "hitbox"; s.dispatchEvent(new Event("change", { bubbles: true }))`);
  const text = id => ev(`document.querySelector("#key_${id}").textContent`);
  assert.deepEqual([await text("l1"), await text("r1"), await text("l2"), await text("r2")], ["3P", "4P", "3K", "4K"]);
});

test("settings saved by an older or damaged version never produce blank or undefined labels", { skip }, async () => {
  await open("/?demo", { storage: JSON.stringify({ labels: "klingon", caseColor: "red", swap: true, up: "left", bounce: "x", panels: 7 }) });
  const texts = await ev(`[...document.querySelectorAll(".key")].map(k => k.textContent.trim())`);
  assert.equal(texts.length, 19);
  assert.ok(texts.every(t => t && t !== "undefined"), texts.join());
  assert.equal(await ev(`document.querySelector("#sLabels").value`), "ps");
});

test("the indicator LED on the drawing follows the colour setting", { skip }, async () => {
  await open("/?demo");
  await ev(`const c = document.querySelector("#sLed"); c.value = "#00ff00"; c.dispatchEvent(new Event("input", { bubbles: true }))`);
  assert.equal(await ev(`getComputedStyle(document.querySelector("#indicator")).backgroundColor`), "rgb(0, 255, 0)");
});

test("without WebHID the page says so up front and disables Connect", { skip }, async () => {
  await open("/", { beforeLoad: `delete Navigator.prototype.hid;` });
  assert.equal(await ev(`document.querySelector("#errbox").hidden`), false);
  assert.match(await ev(`document.querySelector("#errbox").textContent`), /WebHID/);
  assert.equal(await ev(`document.querySelector("#connect").disabled`), true);
});

// ---- the real WebHID path, with a fake navigator.hid injected before the page loads ----
const FAKE_HID = `(() => {
  const hid = new EventTarget(), dev = new EventTarget();
  Object.assign(dev, { vendorId: 0x054c, productId: 0x09cc, productName: "Wireless Controller", opened: false,
    collections: [{ usagePage: 1, usage: 5 }],
    async open() { if (window.__failOpen) throw new Error("access denied"); this.opened = true; },
    async receiveFeatureReport() { throw new Error("not needed on USB"); } });
  const headset = new EventTarget();   // a Sony device that is not a gamepad
  Object.assign(headset, { vendorId: 0x054c, productId: 0x0ce6, productName: "Sony Headset", opened: false,
    collections: [{ usagePage: 0xff00, usage: 1 }], async open() { this.opened = true; }, async receiveFeatureReport() {} });
  const dualsense = new EventTarget();   // a Sony gamepad with a different report layout
  Object.assign(dualsense, { vendorId: 0x054c, productId: 0x0ce6, productName: "DualSense Wireless Controller", opened: false,
    collections: [{ usagePage: 1, usage: 5 }], async open() { this.opened = true; }, async receiveFeatureReport() {} });
  window.__fake = {
    dev, filters: null, granted: !window.__notGranted,
    send(patch = {}) {   // a USB input report: sticks centred, hat neutral, then whatever bytes the test sets
      const b = new Uint8Array(63); b.fill(128, 0, 4); b[4] = 0x08;
      for (const [i, v] of Object.entries(patch)) b[i] = v;
      const ev = new Event("inputreport"); ev.reportId = 1; ev.data = new DataView(b.buffer); dev.dispatchEvent(ev);
    },
    fire(type) { const ev = new Event(type); ev.device = dev; hid.dispatchEvent(ev); },
  };
  hid.getDevices = async () => (window.__fake.granted ? (window.__withHeadset ? [headset, dev] : window.__withDualSense ? [dualsense, dev] : [dev]) : []);
  hid.requestDevice = async opts => { window.__fake.filters = opts.filters; window.__fake.granted = true; return [dev]; };
  Object.defineProperty(Navigator.prototype, "hid", { get: () => hid, configurable: true });
})();`;
const attached = `document.querySelector("#statusText").textContent === "Wireless Controller"`;
const isOn = id => ev(`document.querySelector("#key_${id}").classList.contains("on")`);

test("a controller the browser already trusts is attached on load and its presses light the drawing", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID });
  await waitFor(attached);
  await ev(`window.__fake.send({ 4: 0x18 })`);   // square
  assert.equal(await isOn("square"), true);
  await ev(`window.__fake.send({})`);
  assert.equal(await isOn("square"), false);
  await ev(`for (let i = 0; i < 5; i++) window.__fake.send({})`);
  await waitFor(`document.querySelector("#transport").textContent === "USB"`);
});

test("unplugging clears the lit keys and the readings, and plugging back in reconnects", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID });
  await waitFor(attached);
  await ev(`window.__t = setInterval(() => window.__fake.send({ 4: 0x18, 5: 0x02 }), 4)`);   // square and R1 held, streaming
  await waitFor(`document.querySelector("#rate").textContent !== "—"`);                        // a live reading is on screen
  await ev(`clearInterval(window.__t)`);
  await ev(`window.__fake.fire("disconnect")`);
  assert.equal(await ev(`document.querySelector("#statusText").textContent`), "Disconnected");
  assert.equal(await ev(`document.querySelectorAll(".key.on").length`), 0);
  assert.equal(await ev(`document.querySelector("#rate").textContent`), "—");
  await ev(`window.__fake.send({ 4: 0x18 })`);                 // a late report from the old connection must be ignored
  assert.equal(await ev(`document.querySelectorAll(".key.on").length`), 0);
  await ev(`window.__fake.fire("connect")`);
  await waitFor(attached);
  await ev(`window.__fake.send({ 4: 0x18 })`);
  assert.equal(await isOn("square"), true);
});

test("Connect asks the browser for a DualShock 4 class gamepad, nothing broader", { skip }, async () => {
  await open("/", { beforeLoad: `window.__notGranted = true;` + FAKE_HID });
  assert.equal(await ev(`document.querySelector("#statusText").textContent`), "Disconnected");
  await ev(`document.querySelector("#connect").click()`);
  await waitFor(attached);
  assert.deepEqual(await ev(`window.__fake.filters`), [
    { vendorId: 0x054c, productId: 0x09cc, usagePage: 1, usage: 5 },   // DualShock 4 v2, which is what the Maestro S3 reports
    { vendorId: 0x054c, productId: 0x05c4, usagePage: 1, usage: 5 },   // DualShock 4 v1
  ]);
});

test("a device that cannot be opened is explained, not silently ignored", { skip }, async () => {
  await open("/", { beforeLoad: `window.__failOpen = true;` + FAKE_HID });
  await waitFor(`!document.querySelector("#errbox").hidden`);
  assert.match(await ev(`document.querySelector("#errbox").textContent`), /Could not open the controller: access denied/);
  assert.equal(await ev(`document.querySelector("#statusText").textContent`), "Disconnected");
});

test("a Sony device that is not a gamepad is never picked as the controller", { skip }, async () => {
  await open("/", { beforeLoad: `window.__withHeadset = true;` + FAKE_HID });
  await waitFor(attached);
  assert.notEqual(await ev(`document.querySelector("#statusText").textContent`), "Sony Headset");
});

test("a Sony gamepad with a different report layout is never picked as the controller", { skip }, async () => {
  await open("/", { beforeLoad: `window.__withDualSense = true;` + FAKE_HID });
  await waitFor(attached);
  assert.notEqual(await ev(`document.querySelector("#statusText").textContent`), "DualSense Wireless Controller");
});
