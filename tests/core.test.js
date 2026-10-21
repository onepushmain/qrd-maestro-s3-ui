"use strict";
// Tests for core.js: report decoding, button table and layout, settings validation, stats.
// Expected values are written out by hand from the DualShock 4 report layout, QRD's manual
// (https://qrdgame.com/pages/qrd-maestro-s3-manual) and one report captured from a real controller.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const MS3 = require("../core.js");

const fixture = name => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8").trim();
const view = (bytes, from = 0) => new DataView(bytes.buffer, bytes.byteOffset + from, bytes.length - from);
const down = out => Object.keys(out.pressed).filter(k => out.pressed[k]).sort();

// A USB input report as WebHID delivers it: the report-id byte is already removed, 63 bytes.
function usbBytes(patch = {}) {
  const b = new Uint8Array(63);
  b.fill(128, 0, 4);   // sticks centred
  b[4] = 0x08;         // hat neutral
  for (const [i, v] of Object.entries(patch)) b[Number(i)] = v;
  return b;
}

test("each hardware button is read from its own bit of the report", () => {
  // [key, byte index, mask] straight from the DualShock 4 input report
  const bits = [
    ["square", 4, 0x10], ["cross", 4, 0x20], ["circle", 4, 0x40], ["triangle", 4, 0x80],
    ["l1", 5, 0x01], ["r1", 5, 0x02], ["l2", 5, 0x04], ["r2", 5, 0x08],
    ["share", 5, 0x10], ["options", 5, 0x20], ["l3", 5, 0x40], ["r3", 5, 0x80],
    ["ps", 6, 0x01], ["tpad", 6, 0x02],
  ];
  for (const [id, index, mask] of bits) {
    const b = usbBytes();
    b[index] |= mask;
    assert.deepEqual(down(MS3.decodeReport(0x01, view(b))), [id], `byte ${index} mask 0x${mask.toString(16)}`);
  }
});

test("the d-pad hat decodes to the right directions, and out-of-range values mean neutral", () => {
  const want = {
    0: ["up"], 1: ["right", "up"], 2: ["right"], 3: ["down", "right"], 4: ["down"],
    5: ["down", "left"], 6: ["left"], 7: ["left", "up"], 8: [], 15: [],
  };
  for (const [hat, dirs] of Object.entries(want)) {
    const out = MS3.decodeReport(0x01, view(usbBytes({ 4: Number(hat) })));
    assert.deepEqual([...out.dirs].sort(), dirs, `hat ${hat}`);
    assert.deepEqual(down(out), dirs, `pressed for hat ${hat}`);
  }
});

test("the Turbo key has no report bit and is never reported pressed", () => {
  const out = MS3.decodeReport(0x01, view(usbBytes({ 4: 0xf8, 5: 0xff, 6: 0xff })));
  assert.equal("turbo" in out.pressed, false);
});

test("a 63-byte 0x01 report is USB", () => {
  assert.equal(MS3.decodeReport(0x01, view(usbBytes())).transport, "USB");
});

test("a 9-byte 0x01 report is Bluetooth basic mode, decodes the same buttons, and has no battery", () => {
  const b = new Uint8Array(9);
  b.fill(128, 0, 4);
  b[4] = 0x08 | 0x10;   // neutral hat + square
  const out = MS3.decodeReport(0x01, view(b));
  assert.equal(out.transport, "Bluetooth (basic)");
  assert.deepEqual(down(out), ["square"]);
  assert.equal(out.battery, null);
});

test("a 0x11 report is Bluetooth and every field sits two bytes later", () => {
  const b = new Uint8Array(77);
  b.fill(128, 2, 6);
  b[2 + 4] = 0x08 | 0x80;   // neutral hat + triangle
  b[2 + 29] = 0x07;         // level 7, no cable
  const out = MS3.decodeReport(0x11, view(b));
  assert.equal(out.transport, "Bluetooth");
  assert.deepEqual(down(out), ["triangle"]);
  assert.deepEqual(out.battery, { percent: 75, state: "discharging" });
});

test("unknown report ids and truncated reports are ignored", () => {
  assert.equal(MS3.decodeReport(0x05, view(new Uint8Array(63))), null);
  assert.equal(MS3.decodeReport(0x01, view(new Uint8Array(5))), null);
  assert.equal(MS3.decodeReport(0x11, view(new Uint8Array(8))), null);
});

test("battery follows the Linux driver: level*10+5, charging only when the cable bit is set", () => {
  const cases = [
    [0x15, { percent: 55, state: "charging" }],      // level 5, cable bit
    [0x1a, { percent: 100, state: "charging" }],     // level 10, cable bit
    [0x1b, { percent: 100, state: "full" }],         // level 11, cable bit
    [0x1c, null],                                    // level 12-15 with the cable bit is not a real level
    [0x00, { percent: 5, state: "discharging" }],
    [0x07, { percent: 75, state: "discharging" }],
    [0x0a, { percent: 100, state: "discharging" }],  // what the real controller reported while on USB at 100%
    [0x0f, { percent: 100, state: "discharging" }],
  ];
  for (const [status, want] of cases) {
    assert.deepEqual(MS3.decodeBattery(status), want, `status 0x${status.toString(16)}`);
  }
});

test("a report captured from a real Maestro S3 decodes to idle, USB, 100%", () => {
  const bytes = Buffer.from(fixture("usb-idle-report.hex"), "hex");
  const out = MS3.decodeReport(bytes[0], view(bytes, 1));
  assert.equal(out.transport, "USB");
  assert.deepEqual(out.dirs, []);
  assert.deepEqual(down(out), []);
  assert.deepEqual(out.battery, { percent: 100, state: "discharging" });   // sysfs said 100% Discharging at capture
});

test("hitbox labels follow QRD's manual: 3P and 4P are L1 and R1, 3K and 4K are L2 and R2", () => {
  const want = { square: "1P", triangle: "2P", l1: "3P", r1: "4P", cross: "1K", circle: "2K", l2: "3K", r2: "4K" };
  for (const [id, label] of Object.entries(want)) assert.equal(MS3.KEYS[id].lbl.hitbox, label, id);
});

test("arcade labels put the hard punch and kick on L1 and L2 and the 3-button macros on R1 and R2", () => {
  const want = { square: "LP", triangle: "MP", l1: "HP", r1: "3P", cross: "LK", circle: "MK", l2: "HK", r2: "3K" };
  for (const [id, label] of Object.entries(want)) assert.equal(MS3.KEYS[id].lbl.arcade, label, id);
});

test("xbox labels pair with their PlayStation buttons", () => {
  const want = { cross: "A", circle: "B", square: "X", triangle: "Y", l1: "LB", r1: "RB", l2: "LT", r2: "RT" };
  for (const [id, label] of Object.entries(want)) assert.equal(MS3.KEYS[id].lbl.xbox, label, id);
});

test("buttons are laid out like the diagram in QRD's manual", () => {
  const L = MS3.LAYOUT;
  const byX = ids => [...ids].sort((a, b) => L[a].x - L[b].x);
  assert.deepEqual(byX(["r1", "square", "l1", "triangle"]), ["square", "triangle", "l1", "r1"]);   // 1P 2P 3P 4P
  assert.deepEqual(byX(["r2", "cross", "l2", "circle"]), ["cross", "circle", "l2", "r2"]);         // 1K 2K 3K 4K
  assert.deepEqual(byX(["right", "left", "down"]), ["left", "down", "right"]);

  const top = ["square", "triangle", "l1", "r1"], bottom = ["cross", "circle", "l2", "r2"];
  assert.ok(Math.max(...top.map(i => L[i].y)) < Math.min(...bottom.map(i => L[i].y)), "punch row above kick row");
  const lowest = Math.max(...Object.keys(L).filter(i => i !== "up").map(i => L[i].y));
  assert.ok(L.up.y > lowest, "Up sits below every other button");

  // two columns of small buttons around the touchpad: Share/Turbo/L3 on the left, Option/Home/R3 on the right
  assert.ok(L.share.x === L.turbo.x && L.turbo.x === L.l3.x, "left column");
  assert.ok(L.options.x === L.ps.x && L.ps.x === L.r3.x, "right column");
  assert.ok(L.share.x < L.tpad.x && L.tpad.x < L.options.x, "touchpad between the columns");
  assert.ok(L.share.y < L.turbo.y && L.turbo.y < L.l3.y, "left column order");
  assert.ok(L.options.y < L.ps.y && L.ps.y < L.r3.y, "right column order");
});

test("every key has a place, inside the case, and no two round keys overlap", () => {
  const L = MS3.LAYOUT, { w: W, h: H } = MS3.CASE;
  for (const id of Object.keys(MS3.KEYS)) assert.ok(L[id], `${id} has no layout entry`);
  const box = e => ({ w: e.w ?? e.d, h: e.h ?? e.d });
  for (const [id, e] of Object.entries(L)) {
    const { w, h } = box(e);
    assert.ok(e.x - w / 2 >= 0 && e.x + w / 2 <= W && e.y - h / 2 >= 0 && e.y + h / 2 <= H, `${id} leaves the case`);
  }
  const round = Object.entries(L).filter(([, e]) => e.d);
  for (let i = 0; i < round.length; i++) for (let j = i + 1; j < round.length; j++) {
    const [a, A] = round[i], [b, B] = round[j];
    const gap = Math.hypot(A.x - B.x, A.y - B.y) - (A.d + B.d) / 2;
    assert.ok(gap >= 0, `${a} overlaps ${b}`);
  }
});

test("saved settings that are invalid fall back to something valid", () => {
  const out = MS3.sanitizeSettings({
    caseColor: "red", cap: "#12", glow: 7, ring: "#GGGGGG", led: null, labels: "klingon", theme: "neon",
    bounce: 999, showRing: "yes", panels: { health: "no", raw: true, bogus: true }, swap: true, up: "left",
  });
  const hex = /^#[0-9a-f]{6}$/i;
  for (const k of ["caseColor", "cap", "glow", "ring", "led"]) assert.match(out[k], hex, k);
  assert.ok(["ps", "arcade", "xbox", "hitbox"].includes(out.labels));
  assert.ok(["system", "dark", "light"].includes(out.theme));
  assert.equal(out.bounce, 30);
  assert.equal(typeof out.showRing, "boolean");
  assert.equal(typeof out.panels.health, "boolean");
  assert.equal(out.panels.raw, true);
  assert.equal("bogus" in out.panels, false);
  assert.equal("swap" in out, false);   // settings from earlier versions are dropped
  assert.equal("up" in out, false);
});

test("valid saved settings are kept, and bounce is clamped to a usable range", () => {
  const out = MS3.sanitizeSettings({ caseColor: "#102030", labels: "arcade", theme: "light", bounce: 2, panels: { raw: true, health: false } });
  assert.equal(out.caseColor, "#102030");
  assert.equal(out.labels, "arcade");
  assert.equal(out.theme, "light");
  assert.equal(out.bounce, 3);
  assert.equal(out.panels.raw, true);
  assert.equal(out.panels.health, false);
});

test("settings that are not an object give defaults instead of throwing", () => {
  for (const bad of [null, undefined, "x", 5, [], true]) {
    const out = MS3.sanitizeSettings(bad);
    assert.ok(["ps", "arcade", "xbox", "hitbox"].includes(out.labels));
    assert.equal(typeof out.panels, "object");
  }
});

test("switch stats count presses and flag changes faster than the bounce window", () => {
  const s = MS3.newStat();
  MS3.recordChange(s, true, 1000, 12);
  MS3.recordChange(s, false, 1100, 12);
  MS3.recordChange(s, true, 1300, 12);
  assert.deepEqual([s.presses, s.bounces, s.minGap], [2, 0, 100]);
  MS3.recordChange(s, false, 1305, 12);   // 5 ms after the press: chatter
  MS3.recordChange(s, true, 1308, 12);    // 3 ms later: chatter again
  assert.deepEqual([s.presses, s.bounces, s.minGap], [3, 2, 3]);
});

test("a change at time zero is still compared with the next one", () => {
  const s = MS3.newStat();
  MS3.recordChange(s, true, 0, 12);
  MS3.recordChange(s, false, 3, 12);
  assert.equal(s.bounces, 1);
});

test("repeating the same state in later reports is not a change", () => {
  const s = MS3.newStat();
  for (let t = 0; t < 100; t += 4) MS3.recordChange(s, true, t, 12);
  assert.deepEqual([s.presses, s.bounces], [1, 0]);
});

test("bounce counting needs reports faster than the window", () => {
  assert.equal(MS3.canResolveBounce(4, 12), true);    // 250 Hz
  assert.equal(MS3.canResolveBounce(6, 12), true);
  assert.equal(MS3.canResolveBounce(7, 12), false);
  assert.equal(MS3.canResolveBounce(16, 12), false);  // 62 Hz
});

test("report rate grades: 200 Hz and up good, 100 Hz and up ok, below that slow", () => {
  const want = [[250, "good"], [200, "good"], [199, "warn"], [100, "warn"], [99, "crit"], [62, "crit"]];
  for (const [hz, grade] of want) assert.equal(MS3.rateGrade(hz), grade, `${hz} Hz`);
});

test("rate meter reads a steady stream and has no jitter", () => {
  const m = MS3.createRateMeter();
  assert.equal(m.hz, 0);
  for (let i = 0; i < 50; i++) m.push(1000 + i * 4);
  assert.equal(m.hz, 250);
  assert.equal(m.intervalMs, 4);
  assert.equal(m.jitterMs, 0);
  const slow = MS3.createRateMeter();
  for (let i = 0; i < 50; i++) slow.push(i * 20);
  assert.equal(slow.hz, 50);
});

test("rate meter ignores idle gaps between bursts of reports", () => {
  const m = MS3.createRateMeter();
  let t = 0;
  for (let i = 0; i < 30; i++) m.push(t += 4);
  t += 2000;                                    // controller went quiet
  for (let i = 0; i < 30; i++) m.push(t += 4);
  assert.equal(m.hz, 250);
  assert.equal(m.jitterMs, 0);
});

test("attaching the same device twice delivers each report once", () => {
  const seen = [];
  const binding = MS3.createBinding(e => seen.push(e.reportId));
  const dev = new EventTarget();
  assert.equal(binding.attach(dev), true);
  assert.equal(binding.attach(dev), false);
  const ev = new Event("inputreport");
  ev.reportId = 1;
  dev.dispatchEvent(ev);
  assert.deepEqual(seen, [1]);
});

test("attaching a second device releases the first, and detach is safe to repeat", () => {
  const seen = [];
  const binding = MS3.createBinding(e => seen.push(e.tag));
  const a = new EventTarget(), b = new EventTarget();
  const fire = (dev, tag) => { const ev = new Event("inputreport"); ev.tag = tag; dev.dispatchEvent(ev); };
  binding.attach(a);
  binding.attach(b);
  fire(a, "a");
  fire(b, "b");
  assert.deepEqual(seen, ["b"]);
  binding.detach();
  binding.detach();
  fire(b, "b2");
  assert.deepEqual(seen, ["b"]);
  assert.equal(binding.device, null);
});
