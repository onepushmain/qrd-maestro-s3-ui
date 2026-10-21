"use strict";
/* Pure logic for the Maestro S3 dashboard: the button table, report decoding, layout, settings
   validation and the counters behind the health and timing panels.
   It touches no DOM, so the browser loads it as the global `MS3` and `node --test` uses require(). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MS3 = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const SONY_VENDOR = 0x054c;
  const DS4_PRODUCTS = [0x09cc, 0x05c4];   // DualShock 4 v2 (what the Maestro S3 reports) and v1: the same report layout

  const same = s => ({ ps: s, arcade: s, xbox: s, hitbox: s });
  const lbl = (ps, arcade, xbox, hitbox) => ({ ps, arcade, xbox, hitbox });

  // Direction keys come from the d-pad hat; every other key is one bit of the input report.
  // `b` is the report byte (4 = face buttons, 5 = shoulders and system, 6 = Home and touchpad), `m` the bit mask.
  // Action keys follow QRD's manual: top row 1P 2P 3P 4P = square, triangle, L1, R1;
  // bottom row 1K 2K 3K 4K = cross, circle, L2, R2.
  const KEYS = {
    left:  { dir: true, lbl: same("◀") },
    down:  { dir: true, lbl: same("▼") },
    right: { dir: true, lbl: same("▶") },
    up:    { dir: true, lbl: same("▲") },
    square:   { b: 4, m: 0x10, lbl: lbl("□", "LP", "X", "1P") },
    triangle: { b: 4, m: 0x80, lbl: lbl("△", "MP", "Y", "2P") },
    l1:       { b: 5, m: 0x01, lbl: lbl("L1", "HP", "LB", "3P") },
    r1:       { b: 5, m: 0x02, lbl: lbl("R1", "3P", "RB", "4P") },
    cross:    { b: 4, m: 0x20, lbl: lbl("✕", "LK", "A", "1K") },
    circle:   { b: 4, m: 0x40, lbl: lbl("○", "MK", "B", "2K") },
    l2:       { b: 5, m: 0x04, lbl: lbl("L2", "HK", "LT", "3K") },
    r2:       { b: 5, m: 0x08, lbl: lbl("R2", "3K", "RT", "4K") },
    share:    { b: 5, m: 0x10, small: true, lbl: lbl("SHARE", "SHARE", "VIEW", "SHARE") },
    turbo:    { static: true, small: true, lbl: same("TURBO") },   // handled inside the controller, not in the report
    l3:       { b: 5, m: 0x40, small: true, lbl: lbl("L3", "L3", "LS", "L3") },
    options:  { b: 5, m: 0x20, small: true, lbl: lbl("OPTION", "OPTION", "MENU", "OPTION") },
    ps:       { b: 6, m: 0x01, small: true, lbl: lbl("PS", "HOME", "GUIDE", "HOME") },
    r3:       { b: 5, m: 0x80, small: true, lbl: lbl("R3", "R3", "RS", "R3") },
    tpad:     { b: 6, m: 0x02, small: true, pad: true, lbl: same("TOUCHPAD") },
  };

  // Positions on a 1000 x 650 case (QRD gives 300 x 195 mm), read off the diagram in the manual.
  // Round keys have a diameter `d`; the touchpad has `w` and `h`.
  const CASE = { w: 1000, h: 650 };
  const LAYOUT = {
    left:  { x: 196, y: 282, d: 80 }, down: { x: 307, y: 272, d: 80 }, right: { x: 413, y: 301, d: 80 },
    up:    { x: 481, y: 488, d: 100 },
    square: { x: 516, y: 260, d: 80 }, triangle: { x: 625, y: 237, d: 80 },
    l1:     { x: 735, y: 247, d: 80 }, r1:       { x: 844, y: 260, d: 80 },
    cross:  { x: 500, y: 368, d: 80 }, circle:   { x: 611, y: 346, d: 80 },
    l2:     { x: 720, y: 356, d: 80 }, r2:       { x: 831, y: 371, d: 80 },
    tpad:   { x: 500, y: 100, w: 170, h: 88 },
    share:   { x: 383, y: 67,  d: 30 }, turbo: { x: 383, y: 103, d: 30 }, l3: { x: 383, y: 140, d: 30 },
    options: { x: 619, y: 67,  d: 30 }, ps:    { x: 619, y: 103, d: 30 }, r3: { x: 619, y: 140, d: 30 },
  };
  const INDICATOR = { x: 500, y: 162, w: 80, h: 8 };   // the small indicator LED under the touchpad
  const RESET = { x: 352, y: 14 };                      // the reset hole on the top edge

  const HAT = [["up"], ["up", "right"], ["right"], ["right", "down"], ["down"],
    ["down", "left"], ["left"], ["left", "up"], []];

  function decodeBattery(status) {
    const level = status & 0x0f;
    if (status & 0x10) {   // cable bit
      if (level < 10) return { percent: level * 10 + 5, state: "charging" };
      if (level === 10) return { percent: 100, state: "charging" };
      if (level === 11) return { percent: 100, state: "full" };
      return null;
    }
    return { percent: Math.min(level * 10 + 5, 100), state: "discharging" };
  }

  // `data` is a DataView without the report-id byte, as WebHID delivers it.
  //   0x01, 63 bytes  USB
  //   0x01, 9 bytes   Bluetooth before the controller switches to full reports
  //   0x11            Bluetooth full report: the same fields two bytes later
  function decodeReport(reportId, data) {
    let off, transport;
    if (reportId === 0x01 && data.byteLength >= 30) { off = 0; transport = "USB"; }
    else if (reportId === 0x01 && data.byteLength >= 9) { off = 0; transport = "Bluetooth (basic)"; }
    else if (reportId === 0x11 && data.byteLength >= 2 + 30) { off = 2; transport = "Bluetooth"; }
    else return null;

    const dirs = [...(HAT[data.getUint8(off + 4) & 0x0f] || [])];
    const pressed = {};
    for (const [id, k] of Object.entries(KEYS)) {
      if (k.dir) pressed[id] = dirs.includes(id);
      else if (k.b !== undefined) pressed[id] = (data.getUint8(off + k.b) & k.m) !== 0;
    }
    const battery = data.byteLength > off + 29 ? decodeBattery(data.getUint8(off + 29)) : null;
    return { transport, dirs, pressed, battery };
  }

  const newStat = () => ({ presses: 0, bounces: 0, last: null, state: false, minGap: Infinity });

  function recordChange(s, on, now, bounceMs) {
    if (on === s.state) return;
    if (s.last !== null) {
      const gap = now - s.last;
      if (gap < s.minGap) s.minGap = gap;
      if (gap < bounceMs) s.bounces++;
    }
    if (on) s.presses++;
    s.last = now;
    s.state = on;
  }

  // A switch bounce shorter than the time between reports cannot be seen reliably.
  const canResolveBounce = (intervalMs, thresholdMs) => intervalMs * 2 <= thresholdMs;

  const rateGrade = hz => (hz >= 200 ? "good" : hz >= 100 ? "warn" : "crit");

  // Smooths the time between reports; gaps longer than `maxGapMs` are idle time, not slow reports.
  function createRateMeter(maxGapMs = 250) {
    let last = null, interval = 0, jitter = 0;
    return {
      push(t) {
        if (last !== null) {
          const dt = t - last;
          if (dt > 0 && dt <= maxGapMs) {
            const dev = interval ? Math.abs(dt - interval) : 0;
            interval = interval ? interval * 0.9 + dt * 0.1 : dt;
            jitter = jitter * 0.9 + dev * 0.1;
          }
        }
        last = t;
      },
      reset() { last = null; interval = 0; jitter = 0; },
      get hz() { return interval ? Math.round(1000 / interval) : 0; },
      get intervalMs() { return interval; },
      get jitterMs() { return jitter; },
    };
  }

  const DEFAULT_SETTINGS = Object.freeze({
    caseColor: "#121417", cap: "#2a2e34", glow: "#2bd6f0", ring: "#d23b3b", showRing: true,
    theme: "system", labels: "ps", bounce: 12, led: "#2b6cf0",
    panels: Object.freeze({ health: true, timing: true, combos: true, raw: false }),
  });
  const HEX = /^#[0-9a-f]{6}$/i;

  // Anything read back from storage is untrusted: keep valid values, replace the rest with defaults.
  function sanitizeSettings(raw) {
    const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const p = s.panels && typeof s.panels === "object" ? s.panels : {};
    const d = DEFAULT_SETTINGS;
    const color = (v, fallback) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);
    const pick = (v, list, fallback) => (list.includes(v) ? v : fallback);
    const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
    return {
      caseColor: color(s.caseColor, d.caseColor), cap: color(s.cap, d.cap),
      glow: color(s.glow, d.glow), ring: color(s.ring, d.ring), led: color(s.led, d.led),
      showRing: bool(s.showRing, d.showRing),
      theme: pick(s.theme, ["system", "dark", "light"], d.theme),
      labels: pick(s.labels, ["ps", "arcade", "xbox", "hitbox"], d.labels),
      bounce: typeof s.bounce === "number" && isFinite(s.bounce)
        ? Math.min(30, Math.max(3, Math.round(s.bounce))) : d.bounce,
      panels: {
        health: bool(p.health, d.panels.health), timing: bool(p.timing, d.panels.timing),
        combos: bool(p.combos, d.panels.combos), raw: bool(p.raw, d.panels.raw),
      },
    };
  }

  // Keeps exactly one listener on at most one device, however often attach() is called.
  function createBinding(onReport) {
    let current = null;
    const handler = e => onReport(e);
    function detach() {
      if (current) current.removeEventListener("inputreport", handler);
      current = null;
    }
    function attach(device) {
      if (device === current) return false;
      detach();
      device.addEventListener("inputreport", handler);
      current = device;
      return true;
    }
    return { attach, detach, get device() { return current; } };
  }

  return {
    SONY_VENDOR, DS4_PRODUCTS, KEYS, CASE, LAYOUT, INDICATOR, RESET, DEFAULT_SETTINGS,
    decodeReport, decodeBattery, newStat, recordChange, canResolveBounce, rateGrade,
    createRateMeter, sanitizeSettings, createBinding,
  };
});
