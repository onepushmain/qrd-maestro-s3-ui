"use strict";
// What the page shows for each input report: the SOCD box, the battery, the switch-health table and the rate readout.
// Reports come from a fake navigator.hid (see ui_harness.js); the optional second argument of send() is the event's
// timeStamp, so the timing the page sees is exact. Skipped when Chromium or Node's WebSocket client is not available.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./ui_harness");
const { skip, open, ev, waitFor, sleep, FAKE_HID } = h;

test.before(h.setup);
test.after(h.teardown);

const text = id => ev(`document.querySelector("#${id}").textContent`);
const send = (patch, t) => ev(`window.__fake.send(${JSON.stringify(patch)}, ${t})`);
const isOn = id => ev(`document.querySelector("#key_${id}").classList.contains("on")`);
const start = async options => { await open("/", { beforeLoad: FAKE_HID, ...options }); await waitFor(`document.querySelector("#statusText").textContent === "Wireless Controller"`); };
const SQUARE = { 4: 0x18 }, R1 = { 5: 0x02 }, IDLE = {};   // hat neutral, plus the square button, or R1

test("the SOCD box shows the direction the controller sends", { skip }, async () => {
  await start();
  assert.equal(await text("dirName"), "Neutral");
  await send({ 4: 0x00 });
  assert.equal(await text("dirName"), "Up");
  await send({ 4: 0x01 });
  assert.equal(await text("dirName"), "Up + Right");
  await send(IDLE);
  assert.equal(await text("dirName"), "Neutral");
});

test("when the direction buttons act as a stick, the page lights the direction and names the stick", { skip }, async () => {
  await start();
  await send({ 0: 0 });                    // left stick pushed left
  assert.equal(await text("dirName"), "Left (left stick)");
  assert.equal(await isOn("left"), true);
  await send({ 2: 255, 3: 255 });          // right stick pushed right and down
  assert.equal(await text("dirName"), "Right + Down (right stick)");
  assert.deepEqual([await isOn("left"), await isOn("right"), await isOn("down")], [false, true, true]);
  await send({ 4: 0x00, 0: 255 });         // the hat wins
  assert.equal(await text("dirName"), "Up");
  await send(IDLE);
  assert.equal(await text("dirName"), "Neutral");
});

test("the battery shows its level and whether it is charging or full, and a dash when the level is unknown", { skip }, async () => {
  await start();
  for (const [byte, want] of [[0x08, "85%"], [0x18, "85% ⚡"], [0x1b, "100% full"], [0x1c, "—"], [0x08, "85%"]]) {
    await send({ 29: byte });
    assert.equal(await text("battery"), want, `status byte 0x${byte.toString(16)}`);
  }
});

// The table is redrawn every 300 ms: row = [class, button, presses, bounces, smallest gap, verdict]
const rows = () => ev(`[...document.querySelectorAll("#healthBody tr")].map(tr => [tr.className, ...[...tr.children].map(td => td.textContent)])`);
async function row(label, until = () => true) {
  const end = Date.now() + 4000;
  for (;;) {
    const found = (await rows()).find(r => r[1] === label);
    if (found && until(found)) return found;
    if (Date.now() > end) throw new Error(`row ${label} was ${JSON.stringify(found)}`);
    await sleep(40);
  }
}

test("the health table counts presses, bounces and the smallest gap for each button, and flags a bouncing one", { skip }, async () => {
  await start();
  for (const [bytes, t] of [[SQUARE, 1000], [IDLE, 1100], [SQUARE, 1200], [IDLE, 1203], [R1, 2000], [IDLE, 2100]]) await send(bytes, t);   // square chatters once; R1 is clean
  assert.deepEqual(await row("□", r => r[2] === "2"), ["flag", "□", "2", "1", "3.0", "CHECK"]);
  assert.deepEqual(await row("R1"), ["ok", "R1", "1", "0", "100.0", "OK"]);
  assert.deepEqual(await row("○"), ["", "○", "0", "0", "—", "—"]);
  assert.deepEqual(await ev(`[...document.querySelectorAll("#panelHealth th")].map(th => th.textContent)`), ["Button", "Presses", "Bounces", "Min gap ms", "Health"]);
});

test("the bounce window setting decides what counts as a bounce", { skip }, async () => {
  await start();
  const setWindow = value => ev(`(() => { const s = document.querySelector("#sBounce"); s.value = ${value}; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await setWindow(3);
  await send(SQUARE, 100); await send(IDLE, 105);   // 5 ms apart: clean with a 3 ms window
  assert.equal((await row("□", r => r[2] === "1"))[3], "0");
  assert.equal(await text("debounceMs"), "3");
  await setWindow(12);
  await send(SQUARE, 200); await send(IDLE, 205);   // 5 ms apart: a bounce with a 12 ms window
  assert.equal((await row("□", r => r[2] === "2"))[3], "1");
});

test("Reset stats clears the counts", { skip }, async () => {
  await start();
  for (const [bytes, t] of [[SQUARE, 1000], [IDLE, 1100], [SQUARE, 1200], [IDLE, 1203]]) await send(bytes, t);
  await row("□", r => r[3] === "1");
  await ev(`document.querySelector("#reset").click()`);
  assert.deepEqual(await row("□"), ["", "□", "0", "0", "—", "—"]);
});

test("Reset stats while a button is held neither counts it as a new press nor leaves it lit after release", { skip }, async () => {
  await start();
  await send(SQUARE, 100);
  await row("□", r => r[2] === "1");
  await ev(`document.querySelector("#reset").click()`);
  await send(SQUARE, 120);   // still held
  await send(IDLE, 400);     // released
  assert.equal(await isOn("square"), false);
  await sleep(450);          // let the table redraw
  assert.deepEqual(await row("□"), ["", "□", "0", "0", "—", "—"]);
});

test("Reset stats restarts the report rate reading as well", { skip }, async () => {
  await start();
  let t = 1000;
  for (let i = 0; i < 60; i++) await send(IDLE, t += 4);    // 250 Hz
  await waitFor(`document.querySelector("#rate").textContent === "250"`);
  await ev(`document.querySelector("#reset").click()`);
  for (let i = 0; i < 5; i++) await send(IDLE, t += 20);    // 50 Hz: a reading that has to start from scratch
  await waitFor(`document.querySelector("#rate").textContent === "50"`);
});

test("the health table is updated in place, so selecting text in it survives the redraws", { skip }, async () => {
  await start();
  const before = await ev(`(() => {
    const td = document.querySelector("#healthBody tr td"), range = document.createRange();
    range.selectNodeContents(td); getSelection().removeAllRanges(); getSelection().addRange(range);
    window.__td = td; return td.textContent;
  })()`);
  await sleep(1000);   // three or more redraws
  assert.equal(await ev(`window.__td.isConnected`), true);
  assert.equal(await ev(`getSelection().toString()`), before);
});

test("a bounce seen only because reports were delivered together is not counted", { skip }, async () => {
  await start();
  await send(SQUARE, 1000);
  await send(IDLE, 1000.2);   // a stalled page was handed two reports at once
  await sleep(450);
  assert.deepEqual(await row("□"), ["ok", "□", "1", "0", "—", "OK"]);
});
