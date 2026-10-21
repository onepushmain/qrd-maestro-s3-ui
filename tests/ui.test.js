"use strict";
// Browser tests of the page itself, in headless Chromium. The page's demo mode (?demo) stands in for a controller.
// The WebHID path is in ui_hid.test.js and what the page shows for each report is in ui_panels.test.js.
// Skipped when Chromium or Node's WebSocket client is not available.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./ui_harness");
const { skip, open, ev, waitFor, sleep } = h;

test.before(h.setup);
test.after(h.teardown);

test("demo mode renders the controller with no console errors and no third-party requests", { skip }, async () => {
  const seen = await open("/?demo");
  await waitFor(`document.querySelector("#statusText").textContent.includes("Demo")`);
  assert.equal(await ev(`document.querySelectorAll(".key").length`), 19);
  const foreign = seen.requests.filter(u => !u.startsWith(h.base) && !u.startsWith("data:"));
  assert.deepEqual(foreign, []);
  assert.deepEqual(seen.errors, [], `404s: ${h.notFound.join(", ")}`);
});

// Run `js` in the page and report which Content-Security-Policy directive it violated, if any.
const violation = js => ev(`new Promise(res => {
  document.addEventListener("securitypolicyviolation", e => res(e.effectiveDirective), { once: true });
  setTimeout(() => res("no violation"), 1500);
  ${js}
})`);

test("the content security policy forbids network requests, remote images, inline scripts and inline styles", { skip }, async () => {
  await open("/?demo");
  assert.equal(await violation(`fetch("https://example.com/").catch(() => {});`), "connect-src");
  assert.equal(await violation(`new Image().src = "https://example.com/x.png";`), "img-src");
  assert.equal(await violation(`const s = document.createElement("script"); s.textContent = "window.__ran = true"; document.head.append(s);`), "script-src-elem");
  assert.equal(await ev(`window.__ran`), undefined);
  assert.equal(await violation(`const s = document.createElement("style"); s.textContent = "body { display: none }"; document.head.append(s);`), "style-src-elem");
  assert.notEqual(await ev(`getComputedStyle(document.body).display`), "none");
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
  await h.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await waitFor(`getComputedStyle(document.querySelector("#drawer")).visibility === "hidden"`);
  assert.equal(await ev(`document.activeElement.id`), "openSettings");
  assert.equal(await ev(`document.querySelector("#openSettings").getAttribute("aria-expanded")`), "false");
});

const labels = () => ev(`Object.fromEntries([...document.querySelectorAll(".key")].map(k => [k.id.slice(4), k.textContent.trim()]))`);

test("the keys carry PlayStation names by default", { skip }, async () => {
  await open("/?demo");
  assert.deepEqual(await labels(), {
    left: "◀", down: "▼", right: "▶", up: "▲", square: "□", triangle: "△", l1: "L1", r1: "R1",
    cross: "✕", circle: "○", l2: "L2", r2: "R2", share: "SHARE", turbo: "TURBO", l3: "L3", options: "OPTION",
    ps: "PS", r3: "R3", tpad: "TOUCHPAD",
  });
});

test("choosing the 1P-4K labels relabels the keys like the manual", { skip }, async () => {
  await open("/?demo");
  await ev(`const s = document.querySelector("#sLabels"); s.value = "hitbox"; s.dispatchEvent(new Event("change", { bubbles: true }))`);
  const now = await labels();
  assert.deepEqual([now.l1, now.r1, now.l2, now.r2], ["3P", "4P", "3K", "4K"]);
  assert.deepEqual([now.square, now.triangle, now.cross, now.circle], ["1P", "2P", "1K", "2K"]);
});

test("settings saved by an older or damaged version never produce blank or undefined labels", { skip }, async () => {
  await open("/?demo", { storage: JSON.stringify({ labels: "klingon", caseColor: "red", swap: true, up: "left", bounce: "x", panels: 7 }) });
  const texts = await ev(`[...document.querySelectorAll(".key")].map(k => k.textContent.trim())`);
  assert.equal(texts.length, 19);
  assert.ok(texts.every(t => t && t !== "undefined"), texts.join());
  assert.equal(await ev(`document.querySelector("#sLabels").value`), "ps");
});

test("every key is drawn where the layout table puts it, as fractions of the case", { skip }, async () => {
  await open("/?demo");
  const drawn = await ev(`(() => {
    const c = document.querySelector("#case").getBoundingClientRect();
    const frac = el => { const r = el.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - c.left) / c.width, y: (r.top + r.height / 2 - c.top) / c.height, w: r.width / c.width, h: r.height / c.height }; };
    const out = { case: c.width / c.height, indicator: frac(document.getElementById("indicator")) };
    for (const id of Object.keys(MS3.LAYOUT)) out[id] = frac(document.getElementById("key_" + id));
    return { out, layout: MS3.LAYOUT, indicator: MS3.INDICATOR };
  })()`);
  const want = p => ({ x: p.x / 1000, y: p.y / 650, w: (p.w ?? p.d) / 1000, h: (p.h ?? p.d) / 650 });   // a 1000 x 650 case; positions are centres
  assert.ok(Math.abs(drawn.out.case - 1000 / 650) < 0.01, `case ${drawn.out.case}`);
  const wrong = [];
  for (const [id, place] of Object.entries({ ...drawn.layout, indicator: drawn.indicator })) {
    for (const [axis, value] of Object.entries(want(place))) {
      if (Math.abs(drawn.out[id][axis] - value) > 0.004) wrong.push(`${id}.${axis} ${drawn.out[id][axis].toFixed(3)} not ${value.toFixed(3)}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test("the indicator LED on the drawing follows the colour setting", { skip }, async () => {
  await open("/?demo");
  await ev(`const c = document.querySelector("#sLed"); c.value = "#00ff00"; c.dispatchEvent(new Event("input", { bubbles: true }))`);
  assert.equal(await ev(`getComputedStyle(document.querySelector("#indicator")).backgroundColor`), "rgb(0, 255, 0)");
});

test("in demo mode sending the LED colour says nothing was sent", { skip }, async () => {
  await open("/?demo");
  await ev(`document.querySelector("#ledApply").click()`);
  assert.equal(await ev(`document.querySelector("#ledStatus").textContent`), "Demo mode: nothing was sent.");
});

test("without WebHID the page says so up front and disables Connect", { skip }, async () => {
  await open("/", { beforeLoad: `delete Navigator.prototype.hid;` });
  assert.equal(await ev(`document.querySelector("#errbox").hidden`), false);
  assert.match(await ev(`document.querySelector("#errbox").textContent`), /WebHID/);
  assert.equal(await ev(`document.querySelector("#connect").disabled`), true);
});

// ---- readable text: WCAG 2.x AA needs 4.5:1 for normal-size text (formula written out here, not imported) ----
const luminance = ([r, g, b]) => {
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// text colour and the first opaque background behind it, for each selector, read from the rendered page
const probe = `(sels => sels.map(sel => {
  const el = document.querySelector(sel);
  if (!el) return [sel, null, null];
  const nums = c => c.match(/[\\d.]+/g).map(Number);
  let bg = null;
  for (let n = el; n && !bg; n = n.parentElement) { const c = nums(getComputedStyle(n).backgroundColor); if ((c[3] ?? 1) === 1) bg = c.slice(0, 3); }
  return [sel, nums(getComputedStyle(el).color).slice(0, 3), bg];
}))`;
const TEXTS = ["#connect", "#openSettings", ".stat .k", "#dirName", ".sub", ".legend", ".note", "#timingVerdict", ".combos kbd", ".combos span",
  "th", "#ledStatus", ".drawer h3", ".drawer label", "#demobar", "#demobar a", "td.num"];

// The page can be dark because the user chose it or because their system is: both sets of colours must be readable.
const THEMES = [   // [name, theme saved in Settings, what the operating system prefers]
  ["light", "light", null], ["dark", "dark", null],
  ["system on a dark OS", "system", "dark"], ["system on a light OS", "system", "light"],
];
for (const [name, theme, preferred] of THEMES) {
  test(`text is readable in the ${name} theme`, { skip }, async () => {
    await h.cdp.send("Emulation.setEmulatedMedia", { features: preferred ? [{ name: "prefers-color-scheme", value: preferred }] : [] });
    try {
      const storage = JSON.stringify({ theme });
      await open("/?demo", { storage });
      await waitFor(`document.querySelector("#rateChip").textContent.trim() === "GOOD"`);
      const found = await ev(`(() => {
        const P = ${probe}, chip = document.querySelector("#rateChip"), row = document.querySelector("#healthBody tr"), out = P(${JSON.stringify(TEXTS)});
        for (const grade of ["good", "warn", "crit"]) { chip.className = "chip " + grade; out.push(...P(["#rateChip"]).map(([s, ...rest]) => [s + " " + grade, ...rest])); }
        for (const state of ["ok", "flag"]) { row.className = state; out.push(...P(["#healthBody tr td.health"]).map(([s, ...rest]) => [s + " " + state, ...rest])); }
        return out;
      })()`);
      await open("/?demo=slow", { storage });
      await waitFor(`!document.querySelector("#healthNote").hidden`);
      found.push(...await ev(`${probe}(["#healthNote"])`));
      await open("/", { storage });
      found.push(...await ev(`${probe}(["#intro a", "#intro"])`));
      const unreadable = found.filter(([, fg, bg]) => !fg || !bg || contrast(fg, bg) < 4.5)
        .map(([sel, fg, bg]) => `${sel} ${fg && bg ? contrast(fg, bg).toFixed(2) : "missing"}`);
      assert.deepEqual(unreadable, []);
    } finally {
      await h.cdp.send("Emulation.setEmulatedMedia", { features: [] });
    }
  });
}
