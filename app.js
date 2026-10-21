"use strict";
(function () {
  const DS4_VENDOR = 0x054c;
  const $ = id => document.getElementById(id);

  // ---------- settings ----------
  const DEFAULTS = {
    caseColor: "#121417", cap: "#2a2e34", glow: "#2bd6f0", theme: "system",
    labels: "ps", up: "right", swap: false, bounce: 12, led: "#2b6cf0",
    panels: { health: true, timing: true, combos: true, raw: false }
  };
  let S = structuredClone(DEFAULTS);
  try { const saved = JSON.parse(localStorage.getItem("ms3settings") || "null"); if (saved) S = Object.assign(S, saved, { panels: Object.assign({}, DEFAULTS.panels, saved.panels) }); } catch (e) {}
  const save = () => { try { localStorage.setItem("ms3settings", JSON.stringify(S)); } catch (e) {} };

  // ---------- buttons: logical id, HID byte/mask, label per scheme ----------
  const KEYS = {
    left:     { dir: true, lbl: { ps: "◀", arcade: "◀", xbox: "◀", hitbox: "◀" } },
    down:     { dir: true, lbl: { ps: "▼", arcade: "▼", xbox: "▼", hitbox: "▼" } },
    right:    { dir: true, lbl: { ps: "▶", arcade: "▶", xbox: "▶", hitbox: "▶" } },
    up:       { dir: true, lbl: { ps: "▲", arcade: "▲", xbox: "▲", hitbox: "▲" } },
    square:   { b: 1, m: 0x10, lbl: { ps: "□", arcade: "LP", xbox: "X",  hitbox: "1P" } },
    triangle: { b: 1, m: 0x80, lbl: { ps: "△", arcade: "MP", xbox: "Y",  hitbox: "2P" } },
    r1:       { b: 2, m: 0x02, lbl: { ps: "R1", arcade: "HP", xbox: "RB", hitbox: "3P" } },
    l1:       { b: 2, m: 0x01, lbl: { ps: "L1", arcade: "3P", xbox: "LB", hitbox: "4P" } },
    cross:    { b: 1, m: 0x20, lbl: { ps: "✕", arcade: "LK", xbox: "A",  hitbox: "1K" } },
    circle:   { b: 1, m: 0x40, lbl: { ps: "○", arcade: "MK", xbox: "B",  hitbox: "2K" } },
    r2:       { b: 2, m: 0x08, lbl: { ps: "R2", arcade: "HK", xbox: "RT", hitbox: "3K" } },
    l2:       { b: 2, m: 0x04, lbl: { ps: "L2", arcade: "3K", xbox: "LT", hitbox: "4K" } },
    share:    { b: 2, m: 0x10, lbl: { ps: "SHARE", arcade: "SHARE", xbox: "VIEW", hitbox: "SHARE" }, small: true },
    tpad:     { b: 3, m: 0x02, lbl: { ps: "TOUCHPAD", arcade: "TOUCHPAD", xbox: "TOUCHPAD", hitbox: "TOUCHPAD" }, small: true, pad: true },
    options:  { b: 2, m: 0x20, lbl: { ps: "OPTION", arcade: "OPTION", xbox: "MENU", hitbox: "OPTION" }, small: true },
    l3:       { b: 2, m: 0x40, lbl: { ps: "L3", arcade: "L3", xbox: "LS", hitbox: "L3" }, small: true },
    r3:       { b: 2, m: 0x80, lbl: { ps: "R3", arcade: "R3", xbox: "RS", hitbox: "R3" }, small: true },
    ps:       { b: 3, m: 0x01, lbl: { ps: "PS", arcade: "HOME", xbox: "GUIDE", hitbox: "HOME" }, small: true },
  };

  // positions in a 1000 x 500 case (Hitbox / Noir-style stagger), d = diameter
  function layout() {
    const P = {
      left:  [135, 215, 80], down: [232, 188, 80], right: [328, 212, 80],
      p1: [520, 200, 80], p2: [615, 172, 80], p3: [710, 178, 80], p4: [805, 200, 80],
      k1: [505, 297, 80], k2: [600, 269, 80], k3: [695, 275, 80], k4: [790, 297, 80],
      share: [300, 62, 46], tpad: [470, 62, [190, 50]], options: [640, 62, 46],
      l3: [748, 62, 46], r3: [818, 62, 46], ps: [900, 62, 46],
    };
    const up = S.up === "right" ? [440, 400, 100] : [262, 395, 100];
    const pos = {
      left: P.left, down: P.down, right: P.right, up,
      square: P.p1, triangle: P.p2, cross: P.k1, circle: P.k2,
      r1: S.swap ? P.p4 : P.p3, l1: S.swap ? P.p3 : P.p4,
      r2: S.swap ? P.k4 : P.k3, l2: S.swap ? P.k3 : P.k4,
      share: P.share, tpad: P.tpad, options: P.options, l3: P.l3, r3: P.r3, ps: P.ps,
    };
    return pos;
  }

  function buildController() {
    const c = $("case");
    c.querySelectorAll(".key").forEach(k => k.remove());
    const pos = layout();
    for (const id in KEYS) {
      const k = KEYS[id], [x, y, d] = pos[id];
      const el = document.createElement("div");
      el.className = "key" + (k.small ? " small" : "") + (k.pad ? " pad" : "");
      el.id = "key_" + id;
      el.style.left = (x / 10) + "%"; el.style.top = (y / 5) + "%";
      if (Array.isArray(d)) { el.style.width = (d[0] / 10) + "%"; el.style.height = (d[1] / 5) + "%"; }
      else el.style.width = (d / 10) + "%";
      el.textContent = k.lbl[S.labels];
      c.appendChild(el);
    }
  }

  function applySettings() {
    const r = document.documentElement.style;
    r.setProperty("--case", S.caseColor); r.setProperty("--cap", S.cap);
    r.setProperty("--glow", S.glow); r.setProperty("--ledbar", S.led);
    if (S.theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", S.theme);
    $("panelHealth").hidden = !S.panels.health; $("panelTiming").hidden = !S.panels.timing;
    $("panelCombos").hidden = !S.panels.combos; $("panelRaw").hidden = !S.panels.raw;
    $("debounceMs").textContent = S.bounce; $("sBounceVal").textContent = S.bounce;
    buildController(); buildHealth();
  }

  function syncForm() {
    $("sCase").value = S.caseColor; $("sCap").value = S.cap; $("sGlow").value = S.glow; $("sTheme").value = S.theme;
    $("sLabels").value = S.labels; $("sUp").value = S.up; $("sSwap").checked = S.swap;
    $("pHealth").checked = S.panels.health; $("pTiming").checked = S.panels.timing;
    $("pCombos").checked = S.panels.combos; $("pRaw").checked = S.panels.raw;
    $("sBounce").value = S.bounce; $("sLed").value = S.led;
  }

  const bind = (id, ev, fn) => $(id).addEventListener(ev, e => { fn(e.target); save(); applySettings(); });
  bind("sCase", "input", t => S.caseColor = t.value);
  bind("sCap", "input", t => S.cap = t.value);
  bind("sGlow", "input", t => S.glow = t.value);
  bind("sTheme", "change", t => S.theme = t.value);
  bind("sLabels", "change", t => S.labels = t.value);
  bind("sUp", "change", t => S.up = t.value);
  bind("sSwap", "change", t => S.swap = t.checked);
  bind("pHealth", "change", t => S.panels.health = t.checked);
  bind("pTiming", "change", t => S.panels.timing = t.checked);
  bind("pCombos", "change", t => S.panels.combos = t.checked);
  bind("pRaw", "change", t => S.panels.raw = t.checked);
  bind("sBounce", "input", t => S.bounce = +t.value);
  bind("sLed", "input", t => S.led = t.value);
  $("resetSettings").addEventListener("click", () => { S = structuredClone(DEFAULTS); save(); syncForm(); applySettings(); });
  $("openSettings").addEventListener("click", () => $("drawer").classList.add("open"));
  $("closeSettings").addEventListener("click", () => $("drawer").classList.remove("open"));
  document.addEventListener("keydown", e => { if (e.key === "Escape") $("drawer").classList.remove("open"); });

  // ---------- stats ----------
  const HAT = { 0: ["up"], 1: ["up","right"], 2: ["right"], 3: ["right","down"], 4: ["down"], 5: ["down","left"], 6: ["left"], 7: ["left","up"], 8: [] };
  const fresh = () => ({ presses: 0, bounces: 0, last: 0, state: false, minGap: Infinity });
  const stats = {}; for (const id in KEYS) stats[id] = fresh();

  function buildHealth() {
    const body = $("healthBody"); body.innerHTML = "";
    for (const id in KEYS) {
      const s = stats[id], tr = document.createElement("tr");
      tr.className = s.bounces ? "flag" : (s.presses ? "ok" : "");
      tr.innerHTML = "<td>" + KEYS[id].lbl[S.labels] + "</td><td class=num>" + s.presses + "</td><td class=num>" + s.bounces +
        "</td><td class=num>" + (s.minGap === Infinity ? "—" : s.minGap.toFixed(1)) + "</td><td class=health>" +
        (s.bounces ? "CHECK" : s.presses ? "OK" : "—") + "</td>";
      body.appendChild(tr);
    }
  }

  // ---------- device ----------
  let device = null, transport = "—", lastTs = 0, emaInt = 0, emaJit = 0, count = 0;

  function parseReport(reportId, data) {
    let off;
    if (reportId === 0x01) { off = 0; transport = "USB"; }
    else if (reportId === 0x11) { off = 2; transport = "Bluetooth"; }
    else return;
    if (data.byteLength < off + 9) return;

    const now = performance.now();
    if (lastTs) { const dt = now - lastTs; emaInt = emaInt ? emaInt * 0.9 + dt * 0.1 : dt; emaJit = emaJit * 0.9 + Math.abs(dt - emaInt) * 0.1; }
    lastTs = now; count++;

    const b = { 1: data.getUint8(off + 4), 2: data.getUint8(off + 5), 3: data.getUint8(off + 6) };
    const dirs = HAT[b[1] & 0x0f] || [];
    for (const id in KEYS) {
      const k = KEYS[id];
      const on = k.dir ? dirs.includes(id) : (b[k.b] & k.m) !== 0;
      const el = $("key_" + id); if (el) el.classList.toggle("on", on);
      const s = stats[id];
      if (on !== s.state) {
        if (s.last) { const gap = now - s.last; if (gap < s.minGap) s.minGap = gap; if (gap < S.bounce) s.bounces++; }
        if (on) s.presses++;
        s.last = now; s.state = on;
      }
    }
    const names = { up: "Up", right: "Right", down: "Down", left: "Left" };
    $("dirName").textContent = dirs.length ? dirs.map(d => names[d]).join(" + ") : "Neutral";

    const bi = off + 29;
    if (data.byteLength > bi) {
      const raw = data.getUint8(bi), lvl = raw & 0x0f, cable = (raw & 0x10) !== 0;
      $("battery").textContent = (lvl >= 11 ? "Full" : Math.min(100, lvl * 10) + "%") + (cable ? " ⚡" : "");
    }
    if (S.panels.raw) {
      let hex = "ID " + reportId.toString(16).padStart(2, "0") + "  ";
      for (let i = 0; i < Math.min(data.byteLength, 24); i++) hex += data.getUint8(i).toString(16).padStart(2, "0") + " ";
      $("hex").textContent = hex;
    }
  }

  setInterval(() => {
    if (!device) return;
    const hz = emaInt ? Math.round(1000 / emaInt) : 0;
    $("rate").textContent = hz || "—";
    $("interval").textContent = emaInt ? emaInt.toFixed(1) : "—";
    $("jitter").textContent = emaJit ? emaJit.toFixed(2) : "—";
    $("transport").textContent = transport;
    const chip = $("rateChip");
    if (hz) {
      const [cls, txt, verdict] = hz >= 500 ? ["good", "FAST", "Excellent. Reports arrive far faster than a 60 fps frame."]
        : hz >= 200 ? ["good", "GOOD", "Good. Several reports per game frame."]
        : hz >= 100 ? ["warn", "OK", "About 2 reports per frame. A lower latency mode may help."]
        : ["crit", "SLOW", "About 1 report per frame, so inputs can land a frame late. Try Option + 4K (lowest latency)."];
      chip.className = "chip " + cls; chip.textContent = txt; chip.hidden = false;
      $("timingVerdict").innerHTML = "<b>" + hz + " Hz</b> (" + emaInt.toFixed(1) + " ms between reports). " + verdict;
    }
    if (S.panels.health) buildHealth();
  }, 300);

  async function attach(d) {
    device = d;
    if (!d.opened) await d.open();
    try { await d.receiveFeatureReport(0x02); } catch (e) {}   // read-only; wakes full reports on Bluetooth
    d.addEventListener("inputreport", e => parseReport(e.reportId, e.data));
    $("statusDot").className = "dot on"; $("statusText").textContent = d.productName || "Wireless Controller";
    $("intro").hidden = true; $("errbox").hidden = true; $("reset").hidden = false; $("connect").textContent = "Reconnect";
  }

  $("connect").addEventListener("click", async () => {
    if (!("hid" in navigator)) { $("errbox").textContent = "This browser has no WebHID. Use Chrome, Edge, or Helium."; $("errbox").hidden = false; return; }
    try {
      const [d] = await navigator.hid.requestDevice({ filters: [{ vendorId: DS4_VENDOR }] });
      if (d) await attach(d);
    } catch (err) { $("errbox").textContent = "Could not open the controller: " + err.message; $("errbox").hidden = false; }
  });
  $("reset").addEventListener("click", () => { for (const id in KEYS) stats[id] = fresh(); count = 0; emaInt = emaJit = lastTs = 0; buildHealth(); });

  if ("hid" in navigator) {
    navigator.hid.addEventListener("disconnect", e => {
      if (e.device === device) { device = null; $("statusDot").className = "dot"; $("statusText").textContent = "Disconnected"; }
    });
    navigator.hid.getDevices().then(list => { const d = list.find(x => x.vendorId === DS4_VENDOR); if (d) attach(d).catch(() => {}); });
  }

  // ---------- lightbar (DS4 output report 0x05 over USB: runtime state only) ----------
  async function sendLed(r, g, b) {
    const st = $("ledStatus");
    if (!device) { st.textContent = "Connect the controller first."; return; }
    if (transport !== "USB") { st.textContent = "Lightbar control works over USB only (Bluetooth needs a signed report)."; return; }
    const data = new Uint8Array(31);
    data[0] = 0x02;                      // valid_flag0: lightbar only, no rumble
    data[5] = r; data[6] = g; data[7] = b;
    try { await device.sendReport(0x05, data); st.textContent = "Sent. If the Maestro's LEDs didn't change, its firmware ignores the DS4 lightbar."; }
    catch (e) { st.textContent = "The controller refused the report: " + e.message; }
  }
  const hex2 = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  $("ledApply").addEventListener("click", () => sendLed(...hex2(S.led)));
  $("ledOff").addEventListener("click", () => sendLed(0, 0, 0));

  syncForm(); applySettings();
})();
