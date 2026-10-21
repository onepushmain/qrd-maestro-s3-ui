"use strict";
// The page's real WebHID path (finding, opening, losing and sending to a controller), against a fake navigator.hid
// injected before the page loads (see ui_harness.js). Skipped when Chromium or Node's WebSocket client is not available.
const test = require("node:test");
const assert = require("node:assert/strict");
const h = require("./ui_harness");
const { skip, open, ev, waitFor, sleep, FAKE_HID } = h;

test.before(h.setup);
test.after(h.teardown);

const text = id => ev(`document.querySelector("#${id}").textContent`);
const attached = `document.querySelector("#statusText").textContent === "Wireless Controller"`;
const isOn = id => ev(`document.querySelector("#key_${id}").classList.contains("on")`);
const listeners = pad => ev(`window.__fake.${pad}.listening.size`);

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
  await waitFor(`document.querySelector("#statusText").textContent === "Disconnected"`);
  assert.equal(await ev(`document.querySelectorAll(".key.on").length`), 0);
  assert.equal(await text("rate"), "—");
  await ev(`window.__fake.send({ 4: 0x18 })`);                 // a late report from the old connection must be ignored
  assert.equal(await ev(`document.querySelectorAll(".key.on").length`), 0);
  await ev(`window.__fake.fire("connect")`);
  await waitFor(attached);
  await ev(`window.__fake.send({ 4: 0x18 })`);
  assert.equal(await isOn("square"), true);
});

test("unplugging also clears the timing verdict, the bounce note and the raw report", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID, storage: JSON.stringify({ panels: { raw: true } }) });
  await waitFor(attached);
  await ev(`window.__t = setInterval(() => window.__fake.send({ 5: 0x02 }), 16)`);   // 62 Hz: slow, so the bounce note appears too
  await waitFor(`/Hz/.test(document.querySelector("#timingVerdict").textContent) && !document.querySelector("#healthNote").hidden`);
  assert.notEqual(await text("hex"), "—");
  await ev(`clearInterval(window.__t); window.__fake.fire("disconnect")`);
  await waitFor(`document.querySelector("#statusText").textContent === "Disconnected"`);
  assert.equal(await text("timingVerdict"), "Connect to sample the report stream.");
  assert.equal(await ev(`document.querySelector("#healthNote").hidden`), true);
  assert.equal(await text("hex"), "—");
  await sleep(450);   // the page redraws every 300 ms: nothing may come back
  assert.equal(await text("timingVerdict"), "Connect to sample the report stream.");
});

test("a controller unplugged while it is being opened is never shown as connected", { skip }, async () => {
  await open("/", { beforeLoad: "window.__openGate = new Promise(r => { window.__releaseOpen = r; });" + FAKE_HID });
  await waitFor(`window.__opening === true`);
  await ev(`window.__fake.fire("disconnect"); window.__releaseOpen();`);
  await sleep(300);
  assert.equal(await text("statusText"), "Disconnected");
  assert.equal(await ev(`document.querySelector("#statusDot").className`), "dot");
  assert.equal(await text("connect"), "Connect controller");
  assert.equal(await ev(`document.querySelector("#errbox").hidden`), true);
  assert.equal(await listeners("dev"), 0);
});

test("a second controller that appears before the first one's disconnect arrives is attached", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID });
  await waitFor(attached);
  await ev(`window.__fake.fire("connect", window.__fake.second); window.__fake.fire("disconnect", window.__fake.dev)`);
  await waitFor(`document.querySelector("#statusText").textContent === "Second Controller"`);
  await ev(`window.__fake.send({ 4: 0x18 }, undefined, window.__fake.second)`);
  assert.equal(await isOn("square"), true);
  assert.deepEqual([await listeners("dev"), await listeners("second")], [0, 1]);
});

test("a controller that disconnects first is replaced by the one that connects after it", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID });
  await waitFor(attached);
  await ev(`window.__fake.fire("disconnect", window.__fake.dev); window.__fake.fire("connect", window.__fake.second)`);
  await waitFor(`document.querySelector("#statusText").textContent === "Second Controller"`);
  assert.deepEqual([await listeners("dev"), await listeners("second")], [0, 1]);
});

test("a controller that is unplugged while being opened leaves no error behind, even when the open fails because of it", { skip }, async () => {
  await open("/", { beforeLoad: "window.__openGate = new Promise((_, no) => { window.__failOpenGate = () => no(new Error('device is gone')); });" + FAKE_HID });
  await waitFor(`window.__opening === true`);
  await ev(`window.__fake.fire("disconnect"); window.__failOpenGate();`);
  await sleep(300);
  assert.equal(await ev(`document.querySelector("#errbox").hidden`), true);
  assert.equal(await text("statusText"), "Disconnected");
});

test("a slow look at what is plugged in cannot override a newer one", { skip }, async () => {
  await open("/", { beforeLoad: "window.__slowFirstLook = true;" + FAKE_HID });
  await ev(`window.__fake.fire("disconnect", window.__fake.dev); window.__fake.fire("connect", window.__fake.second)`);   // swapped while the first look is still pending
  await waitFor(`document.querySelector("#statusText").textContent === "Second Controller"`);
  await sleep(900);   // the first look answers now, with the list as it was
  assert.equal(await text("statusText"), "Second Controller");
  assert.deepEqual([await listeners("dev"), await listeners("second")], [0, 1]);
  assert.equal(await ev(`document.querySelector("#errbox").hidden`), true);
});

test("if the controller is no longer listed, the page stops claiming it is connected", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID });
  await waitFor(attached);
  await ev(`window.__fake.unplugQuietly(); window.__fake.fire("disconnect", window.__fake.second)`);   // the other pad's event makes the page look again
  await waitFor(`document.querySelector("#statusText").textContent === "Disconnected"`);
  assert.equal(await listeners("dev"), 0);
});

test("looking again after another pad comes or goes does not re-read the controller in use, but Reconnect does", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID });
  await waitFor(attached);
  assert.equal(await ev(`window.__fake.dev.featureReads`), 1);
  await ev(`window.__fake.fire("connect", window.__fake.second); window.__fake.fire("disconnect", window.__fake.second)`);
  await sleep(200);
  assert.equal(await ev(`window.__fake.dev.featureReads`), 1);
  await ev(`document.querySelector("#connect").click()`);   // over Bluetooth this read is what makes the controller send full reports
  await waitFor(`window.__fake.dev.featureReads === 2`);
});

test("another controller plugging in or out does not disturb the one in use", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID });
  await waitFor(attached);
  await ev(`window.__fake.fire("connect", window.__fake.second)`);
  await sleep(150);
  assert.equal(await text("statusText"), "Wireless Controller");
  await ev(`window.__fake.fire("disconnect", window.__fake.second)`);
  await sleep(150);
  assert.equal(await text("statusText"), "Wireless Controller");
  await ev(`window.__fake.send({ 4: 0x18 })`);
  assert.equal(await isOn("square"), true);
  assert.deepEqual([await listeners("dev"), await listeners("second")], [1, 0]);
});

test("pressing Connect again never adds a second listener to the controller", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID });
  await waitFor(attached);
  await ev(`for (let i = 0; i < 3; i++) document.querySelector("#connect").click()`);
  await sleep(200);
  assert.equal(await listeners("dev"), 1);
});

test("Connect asks the browser for a DualShock 4 class gamepad, nothing broader", { skip }, async () => {
  await open("/", { beforeLoad: `window.__notGranted = true;` + FAKE_HID });
  assert.equal(await text("statusText"), "Disconnected");
  await ev(`document.querySelector("#connect").click()`);
  await waitFor(attached);
  assert.deepEqual(await ev(`window.__fake.filters`), [
    { vendorId: 0x054c, productId: 0x09cc, usagePage: 1, usage: 5 },   // DualShock 4 v2, which is what the Maestro S3 reports
    { vendorId: 0x054c, productId: 0x05c4, usagePage: 1, usage: 5 },   // DualShock 4 v1
  ]);
});

test("closing the picker without choosing a controller is not an error", { skip }, async () => {
  await open("/", { beforeLoad: `window.__notGranted = true; window.__pickNothing = true;` + FAKE_HID });
  await ev(`document.querySelector("#connect").click()`);
  await sleep(200);
  assert.equal(await ev(`document.querySelector("#errbox").hidden`), true);
  assert.equal(await text("statusText"), "Disconnected");
});

test("a browser that refuses the picker is not told that opening the controller failed", { skip }, async () => {
  await open("/", { beforeLoad: `window.__notGranted = true; window.__failRequest = true;` + FAKE_HID });
  await ev(`document.querySelector("#connect").click()`);
  await waitFor(`!document.querySelector("#errbox").hidden`);
  const message = await text("errbox");
  assert.match(message, /^Could not ask the browser for a controller: blocked by policy/);
  assert.doesNotMatch(message, /Another program|udev/);   // nothing was opened, so advice about opening does not apply
});

test("a device that cannot be opened is explained, not silently ignored", { skip }, async () => {
  await open("/", { beforeLoad: `window.__failOpen = true;` + FAKE_HID });
  await waitFor(`!document.querySelector("#errbox").hidden`);
  const message = await text("errbox");
  assert.match(message, /Could not open the controller: access denied/);
  assert.match(message, /Steam/);
  assert.match(message, /udev rules/);   // on Linux this is the usual cause
  assert.equal(await text("statusText"), "Disconnected");
});

test("a Sony device that is not a gamepad is never picked as the controller", { skip }, async () => {
  await open("/", { beforeLoad: `window.__withHeadset = true;` + FAKE_HID });   // a headset and a device with a controller's id but no gamepad collection
  await waitFor(attached);
  assert.deepEqual([await listeners("headset"), await listeners("vendorOnly"), await listeners("dev")], [0, 0, 1]);
});

test("a Sony gamepad with a different report layout is never picked as the controller", { skip }, async () => {
  await open("/", { beforeLoad: `window.__withDualSense = true;` + FAKE_HID });
  await waitFor(attached);
  assert.deepEqual([await listeners("dualsense"), await listeners("dev")], [0, 1]);
});

// ---- the indicator LED: DualShock 4 output report 0x05, 31 bytes, flags in byte 0, red green blue in bytes 5-7 ----
const frame = (r, g, b) => [5, Object.assign(new Array(31).fill(0), { 0: 2, 5: r, 6: g, 7: b })];
const setLed = hex => ev(`(() => { const c = document.querySelector("#sLed"); c.value = "${hex}"; c.dispatchEvent(new Event("input", { bubbles: true })); })()`);

test("Send to controller writes the chosen colour, and Turn off writes black, as a game would", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID });
  await waitFor(attached);
  await ev(`window.__fake.send({})`);   // a USB report, so the page knows the transport
  await setLed("#336699");
  await ev(`document.querySelector("#ledApply").click()`);
  await waitFor(`window.__fake.dev.sent.length === 1`);
  assert.equal(await text("ledStatus"), "Sent.");
  await ev(`document.querySelector("#ledOff").click()`);
  await waitFor(`window.__fake.dev.sent.length === 2`);
  assert.deepEqual(await ev(`window.__fake.dev.sent`), [frame(0x33, 0x66, 0x99), frame(0, 0, 0)]);
});

test("a controller that refuses the LED report is reported as refusing", { skip }, async () => {
  await open("/", { beforeLoad: "window.__failSend = true;" + FAKE_HID });
  await waitFor(attached);
  await ev(`window.__fake.send({}); document.querySelector("#ledApply").click()`);
  await waitFor(`/refused/.test(document.querySelector("#ledStatus").textContent)`);
  assert.equal(await text("ledStatus"), "The controller refused the report: device busy");
});

test("over Bluetooth nothing is sent to the LED, and the page says why", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID });
  await waitFor(attached);
  await ev(`window.__fake.sendRaw([128, 128, 128, 128, 0x08, 0, 0, 0, 0])`);   // a 9-byte report: Bluetooth basic mode
  await waitFor(`document.querySelector("#transport").textContent.startsWith("Bluetooth")`);
  await ev(`document.querySelector("#ledApply").click()`);
  await waitFor(`/over USB/.test(document.querySelector("#ledStatus").textContent)`);
  assert.deepEqual(await ev(`window.__fake.dev.sent`), []);
});

test("without a controller the LED button asks you to connect first", { skip }, async () => {
  await open("/", { beforeLoad: "window.__notGranted = true;" + FAKE_HID });
  await ev(`document.querySelector("#ledApply").click()`);
  assert.equal(await text("ledStatus"), "Connect the controller first.");
  assert.deepEqual(await ev(`window.__fake.dev.sent`), []);
});

test("the connection and LED messages are announced to screen readers", { skip }, async () => {
  await open("/", { beforeLoad: FAKE_HID });
  assert.equal(await ev(`document.querySelector("#statusText").getAttribute("role")`), "status");
  assert.equal(await ev(`document.querySelector("#ledStatus").getAttribute("role")`), "status");
});
