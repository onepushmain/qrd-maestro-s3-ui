"use strict";
// The demo controller must deliver reports at exactly the spacing it promises, however late its timer fires:
// the dashboard's rate readout (and its tests) are only meaningful if the simulated stream is steady.
const test = require("node:test");
const assert = require("node:assert/strict");
const { MS3Demo } = require("../demo.js");

// Drive the demo with a clock and a timer we control.
function drive(speed, tickTimes) {
  const realNow = performance.now, realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  let now = 0, tick = null;
  performance.now = () => now;
  globalThis.setInterval = fn => { tick = fn; return 1; };
  globalThis.clearInterval = () => { tick = null; };
  try {
    const demo = MS3Demo.create(speed), stamps = [];
    demo.addEventListener("inputreport", e => stamps.push(e.timeStamp));
    for (const t of tickTimes) { now = t; tick(); }
    demo.removeEventListener("inputreport", stamps.push);
    return stamps;
  } finally {
    performance.now = realNow; globalThis.setInterval = realSet; globalThis.clearInterval = realClear;
  }
}
const gaps = xs => xs.slice(1).map((x, i) => x - xs[i]);

test("a 250 Hz demo delivers reports exactly 4 ms apart even when its ticks arrive unevenly", () => {
  const stamps = drive("fast", [16, 33, 49, 80, 96, 97, 130, 146]);
  assert.ok(stamps.length > 20, `${stamps.length} reports`);
  assert.deepEqual([...new Set(gaps(stamps))], [4]);
});

test("a 62 Hz demo delivers reports exactly 16 ms apart even when its ticks arrive unevenly", () => {
  const stamps = drive("slow", [16, 31, 50, 81, 96, 97, 130]);
  assert.ok(stamps.length >= 6, `${stamps.length} reports`);
  assert.deepEqual([...new Set(gaps(stamps))], [16]);
});

test("a timer that was late catches up, but never delivers a report from the future", () => {
  const ticks = [16, 90, 110];
  const stamps = drive("fast", ticks);
  assert.ok(Math.max(...stamps) <= ticks[ticks.length - 1]);
});

test("after a long pause the demo restarts instead of replaying the whole gap", () => {
  const stamps = drive("fast", [16, 32, 5000]);
  assert.ok(stamps.length < 40, `${stamps.length} reports after a 5 s pause`);
});
