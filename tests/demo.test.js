"use strict";
// The demo controller must deliver reports at exactly the spacing it promises, however late its timer fires:
// the dashboard's rate readout (and its tests) are only meaningful if the simulated stream is steady.
const test = require("node:test");
const assert = require("node:assert/strict");
const { MS3Demo } = require("../demo.js");

// Drive the demo with a clock and a timer we control. Returns { demo, at(t), restore() }: at(t) moves the clock to t and fires the
// interval timer if the demo has one running.
function harness(speed) {
  const realNow = performance.now, realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  let now = 0, tick = null;
  performance.now = () => now;
  globalThis.setInterval = fn => { tick = fn; return 1; };
  globalThis.clearInterval = () => { tick = null; };
  return {
    demo: MS3Demo.create(speed),
    at(t) { now = t; if (tick) tick(); },
    timerRunning: () => tick !== null,
    restore() { performance.now = realNow; globalThis.setInterval = realSet; globalThis.clearInterval = realClear; },
  };
}
function drive(speed, tickTimes) {
  const h = harness(speed), stamps = [];
  try {
    const listener = e => stamps.push(e.timeStamp);
    h.demo.addEventListener("inputreport", listener);
    for (const t of tickTimes) h.at(t);
    h.demo.removeEventListener("inputreport", listener);
    return stamps;
  } finally {
    h.restore();
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

test("a report that is due exactly at a tick is delivered at that tick, not a tick later", () => {
  assert.deepEqual(drive("fast", [16, 20]), [16, 20]);
});

test("when the last listener leaves and another arrives, the stream starts afresh instead of replaying what it missed", () => {
  const h = harness("fast");
  try {
    const first = () => {};
    h.demo.addEventListener("inputreport", first);
    h.at(16);
    h.demo.removeEventListener("inputreport", first);
    assert.equal(h.timerRunning(), false, "the timer stops with the last listener");
    const stamps = [];
    h.demo.addEventListener("inputreport", e => stamps.push(e.timeStamp));
    h.at(616);   // 600 ms later: less than the one-second pause rule, so only the restart on re-adding can prevent a replay
    assert.deepEqual(stamps, [616]);
  } finally {
    h.restore();
  }
});
