"use strict";
/* A simulated controller, so the dashboard can be tried without hardware.
   Open index.html?demo for a 250 Hz USB stream or ?demo=slow for a 62 Hz one.
   It plays a looping set of button and direction presses in the same report format WebHID delivers. */
(function (root) {
  const STEPS = [   // [hat, face-button bits, shoulder/system bits], each shown for 600 ms
    [8, 0x00, 0x00], [6, 0x00, 0x00], [5, 0x00, 0x00], [4, 0x00, 0x00], [3, 0x00, 0x00],
    [2, 0x10, 0x00], [8, 0x80, 0x02], [8, 0x60, 0x00], [0, 0x00, 0x0c], [8, 0x00, 0x30],
  ];
  const STEP_MS = 600;

  function create(speed) {
    const reportMs = speed === "slow" ? 16 : 4;
    const perTick = 16 / reportMs;
    const listeners = new Set();
    let timer = null;

    function frame([hat, face, shoulders]) {
      const bytes = new Uint8Array(63);
      bytes.fill(128, 0, 4);          // sticks centred
      bytes[4] = hat | face;
      bytes[5] = shoulders;
      bytes[29] = 0x08;               // battery level 8, not charging: 85%
      return new DataView(bytes.buffer);
    }

    function tick() {
      const now = performance.now();
      const step = STEPS[Math.floor(now / STEP_MS) % STEPS.length];
      for (let i = 0; i < perTick; i++) {   // timestamps are exact, whatever the timer jitter
        const event = { reportId: 1, data: frame(step), timeStamp: now - (perTick - 1 - i) * reportMs };
        listeners.forEach(fn => fn(event));
      }
    }

    return {
      _demo: true,
      productName: "Demo controller",
      opened: true,
      open: async () => {},
      receiveFeatureReport: async () => { throw new Error("not available in the demo"); },
      addEventListener(type, fn) {
        if (type !== "inputreport") return;
        listeners.add(fn);
        if (!timer) timer = setInterval(tick, 16);
      },
      removeEventListener(type, fn) {
        listeners.delete(fn);
        if (!listeners.size && timer) { clearInterval(timer); timer = null; }
      },
    };
  }

  root.MS3Demo = { create };
})(typeof self !== "undefined" ? self : this);
