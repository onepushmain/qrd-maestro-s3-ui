"use strict";
/* Dashboard wiring: reads the controller over WebHID (or the built-in demo), draws it, and keeps the panels current.
   Decoding, validation and counting live in core.js, which has tests. */
(function () {
  const { KEYS, LAYOUT, CASE, INDICATOR, RESET, SONY_VENDOR } = MS3;
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const demo = params.has("demo") ? MS3Demo.create(params.get("demo") === "slow" ? "slow" : "fast") : null;

  // ---------- settings ----------
  let S;
  try { S = MS3.sanitizeSettings(JSON.parse(localStorage.getItem("ms3settings"))); }
  catch (e) { S = MS3.sanitizeSettings(null); }
  const save = () => { try { localStorage.setItem("ms3settings", JSON.stringify(S)); } catch (e) { /* storage unavailable: settings last for this visit */ } };

  // ---------- the controller drawing ----------
  function place(el, p) {
    const w = p.w ?? p.d, h = p.h ?? p.d;
    el.style.left = (p.x / CASE.w * 100) + "%";
    el.style.top = (p.y / CASE.h * 100) + "%";
    el.style.width = (w / CASE.w * 100) + "%";
    el.style.height = (h / CASE.h * 100) + "%";
  }

  function addText(parent, cls, text, x, y) {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = text;
    el.style.left = (x / CASE.w * 100) + "%";
    el.style.top = (y / CASE.h * 100) + "%";
    parent.appendChild(el);
  }

  function buildCase() {
    const c = $("case");
    c.replaceChildren();
    const brand = document.createElement("div");
    brand.className = "brand";
    brand.append("QRD");
    const model = document.createElement("small");
    model.textContent = "MAESTRO S3";
    brand.appendChild(model);
    c.appendChild(brand);
    for (const [id, k] of Object.entries(KEYS)) {
      const el = document.createElement("div");
      el.id = "key_" + id;
      el.className = "key" + (k.small ? " small" : "") + (k.pad ? " pad" : "") + (k.static ? " static" : "");
      if (k.static) el.title = "Handled inside the controller; it is not reported to the PC";
      place(el, LAYOUT[id]);
      c.appendChild(el);
    }
    const led = document.createElement("div");
    led.id = "indicator";
    led.title = "Indicator LED";
    place(led, INDICATOR);
    c.appendChild(led);
    addText(c, "mark", "INDICATOR LED", INDICATOR.x, INDICATOR.y + 22);
    const dot = document.createElement("div");
    dot.className = "dotmark";
    dot.style.left = (RESET.x / CASE.w * 100) + "%";
    dot.style.top = (RESET.y / CASE.h * 100) + "%";
    c.appendChild(dot);
    addText(c, "mark", "RESET", RESET.x, RESET.y + 14);
  }

  function applyLabels() {
    for (const [id, k] of Object.entries(KEYS)) {
      const el = $("key_" + id), text = k.lbl[S.labels];
      if (k.small && !k.pad) {   // small keys carry their name beside them, on the side facing away from the touchpad
        let side = el.firstElementChild;
        if (!side) {
          side = document.createElement("span");
          side.className = "side " + (LAYOUT[id].x < LAYOUT.tpad.x ? "l" : "r");
          el.appendChild(side);
        }
        side.textContent = text;
      } else el.textContent = text;
    }
  }

  function applyLook() {
    const r = document.documentElement.style;
    r.setProperty("--case", S.caseColor);
    r.setProperty("--cap", S.cap);
    r.setProperty("--glow", S.glow);
    r.setProperty("--ring", S.ring);
    r.setProperty("--ledbar", S.led);
    $("case").classList.toggle("ring", S.showRing);
    if (S.theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", S.theme);
    for (const [name, id] of [["health", "panelHealth"], ["timing", "panelTiming"], ["combos", "panelCombos"], ["raw", "panelRaw"]]) $(id).hidden = !S.panels[name];
    $("debounceMs").textContent = S.bounce;
    $("sBounceVal").textContent = S.bounce;
    applyLabels();
    renderHealth();
  }

  function syncForm() {
    $("sCase").value = S.caseColor; $("sCap").value = S.cap; $("sGlow").value = S.glow; $("sRing").value = S.ring;
    $("sShowRing").checked = S.showRing; $("sTheme").value = S.theme; $("sLabels").value = S.labels;
    $("pHealth").checked = S.panels.health; $("pTiming").checked = S.panels.timing;
    $("pCombos").checked = S.panels.combos; $("pRaw").checked = S.panels.raw;
    $("sBounce").value = S.bounce; $("sLed").value = S.led;
  }

  function bind(id, event, update) {
    $(id).addEventListener(event, e => { update(e.target); save(); applyLook(); });
  }
  bind("sCase", "input", t => S.caseColor = t.value);
  bind("sCap", "input", t => S.cap = t.value);
  bind("sGlow", "input", t => S.glow = t.value);
  bind("sRing", "input", t => S.ring = t.value);
  bind("sShowRing", "change", t => S.showRing = t.checked);
  bind("sTheme", "change", t => S.theme = t.value);
  bind("sLabels", "change", t => S.labels = t.value);
  bind("pHealth", "change", t => S.panels.health = t.checked);
  bind("pTiming", "change", t => S.panels.timing = t.checked);
  bind("pCombos", "change", t => S.panels.combos = t.checked);
  bind("pRaw", "change", t => S.panels.raw = t.checked);
  bind("sBounce", "input", t => S.bounce = Number(t.value));
  bind("sLed", "input", t => S.led = t.value);
  $("resetSettings").addEventListener("click", () => { S = MS3.sanitizeSettings(null); save(); syncForm(); applyLook(); });

  // ---------- settings drawer ----------
  const drawer = $("drawer"), opener = $("openSettings");
  function setDrawer(open) {
    drawer.classList.toggle("open", open);
    opener.setAttribute("aria-expanded", String(open));
    if (open) $("closeSettings").focus();
    else if (drawer.contains(document.activeElement)) opener.focus();
  }
  opener.addEventListener("click", () => setDrawer(true));
  $("closeSettings").addEventListener("click", () => setDrawer(false));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && drawer.classList.contains("open")) setDrawer(false); });

  // ---------- switch health ----------
  const stats = {};
  const hardwareKeys = Object.keys(KEYS).filter(id => !KEYS[id].static);
  const resetStats = () => { for (const id of hardwareKeys) stats[id] = MS3.newStat(); };
  resetStats();

  function renderHealth() {
    const body = $("healthBody");
    body.replaceChildren();
    for (const id of hardwareKeys) {
      const s = stats[id], tr = document.createElement("tr");
      tr.className = s.bounces ? "flag" : s.presses ? "ok" : "";
      const cells = [KEYS[id].lbl[S.labels], s.presses, s.bounces, s.minGap === Infinity ? "—" : s.minGap.toFixed(1), s.bounces ? "CHECK" : s.presses ? "OK" : "—"];
      cells.forEach((text, i) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (i === 4) td.className = "health"; else if (i > 0) td.className = "num";
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
  }

  // ---------- reading reports ----------
  const meter = MS3.createRateMeter();
  let device = null, transport = "—";
  const cap = s => s[0].toUpperCase() + s.slice(1);

  function onReport(e) {
    const out = MS3.decodeReport(e.reportId, e.data);
    if (!out) return;
    meter.push(e.timeStamp);
    transport = out.transport;
    for (const [id, down] of Object.entries(out.pressed)) {
      const was = stats[id].state;
      MS3.recordChange(stats[id], down, e.timeStamp, S.bounce);
      if (was !== down) $("key_" + id).classList.toggle("on", down);
    }
    $("dirName").textContent = out.dirs.length ? out.dirs.map(cap).join(" + ") : "Neutral";
    if (out.battery) {
      const { percent, state } = out.battery;
      $("battery").textContent = percent + "%" + (state === "charging" ? " ⚡" : state === "full" ? " full" : "");
    }
    if (S.panels.raw) {
      let hex = "ID " + e.reportId.toString(16).padStart(2, "0") + "  ";
      for (let i = 0; i < Math.min(e.data.byteLength, 24); i++) hex += e.data.getUint8(i).toString(16).padStart(2, "0") + " ";
      $("hex").textContent = hex;
    }
  }
  const binding = MS3.createBinding(onReport);

  const VERDICTS = {
    good: () => "Several reports arrive in every 60 fps game frame.",
    warn: usb => usb ? "About two reports per frame. A faster latency mode may help (Option + 4K)."
                     : "Normal for Bluetooth. A USB cable gives faster, steadier timing.",
    crit: usb => usb ? "About one report per frame, so a press can reach the game a frame late. Try the fastest latency mode (Option + 4K)."
                     : "Slow, even for Bluetooth. Use the USB cable for matches.",
  };
  const CHIPS = { good: "GOOD", warn: "OK", crit: "SLOW" };

  function refresh() {
    if (!device) return;
    const hz = meter.hz;
    $("rate").textContent = hz || "—";
    $("interval").textContent = hz ? meter.intervalMs.toFixed(1) : "—";
    $("jitter").textContent = hz ? meter.jitterMs.toFixed(2) : "—";
    $("transport").textContent = transport;
    if (hz) {
      const grade = MS3.rateGrade(hz), chip = $("rateChip");
      chip.className = "chip " + grade;
      chip.textContent = CHIPS[grade];
      chip.hidden = false;
      $("timingVerdict").textContent = `${hz} Hz, ${meter.intervalMs.toFixed(1)} ms between reports. ` + VERDICTS[grade](transport === "USB");
      const blind = !MS3.canResolveBounce(meter.intervalMs, S.bounce);
      $("healthNote").hidden = !blind;
      if (blind) $("healthNote").textContent = `Reports arrive every ${meter.intervalMs.toFixed(1)} ms, which is too slow to catch bounces shorter than ${S.bounce} ms. Switch the controller to a faster latency mode first.`;
    }
    renderHealth();
  }
  setInterval(refresh, 300);

  // ---------- connecting ----------
  const isGamepad = d => d.vendorId === SONY_VENDOR && d.collections.some(c => c.usagePage === 1 && c.usage === 5);
  function showError(message) { const box = $("errbox"); box.textContent = message; box.hidden = false; }

  async function attach(d) {
    if (!d.opened) await d.open();
    try { await d.receiveFeatureReport(0x02); }   // a read; over Bluetooth it makes the controller send full reports
    catch (err) { /* USB controllers and the demo do not need it */ }
    meter.reset();
    binding.attach(d);
    device = d;
    $("statusDot").className = "dot on";
    $("statusText").textContent = d.productName || "Wireless Controller";
    $("intro").hidden = true;
    $("errbox").hidden = true;
    $("reset").hidden = false;
    $("connect").textContent = "Reconnect";
  }

  // Nothing arrives any more, so nothing may stay lit or keep showing the last reading.
  function markDisconnected() {
    binding.detach();
    device = null;
    $("statusDot").className = "dot";
    $("statusText").textContent = "Disconnected";
    document.querySelectorAll(".key.on").forEach(k => k.classList.remove("on"));
    for (const id of hardwareKeys) stats[id].state = false;
    $("dirName").textContent = "Neutral";
    $("rateChip").hidden = true;
    for (const id of ["rate", "interval", "jitter", "battery", "transport"]) $(id).textContent = "—";
  }

  function report(err) {
    showError(`Could not open the controller: ${err.message}. Close anything else using it (Steam, a game, another browser tab) and try again.`);
  }

  $("connect").addEventListener("click", async () => {
    try {
      if (demo) { await attach(demo); return; }
      const [d] = await navigator.hid.requestDevice({ filters: [{ vendorId: SONY_VENDOR, usagePage: 1, usage: 5 }] });
      if (d) await attach(d);
    } catch (err) { report(err); }
  });
  $("reset").addEventListener("click", () => { resetStats(); meter.reset(); renderHealth(); });

  buildCase();   // the drawing must exist before the first report arrives
  syncForm();
  applyLook();

  if (demo) {
    $("demobar").hidden = false;
    $("intro").hidden = true;
    attach(demo);
  } else if (!("hid" in navigator)) {
    $("intro").hidden = true;
    $("connect").disabled = true;
    showError("This browser has no WebHID, so it cannot read the controller. Use Chrome, Edge, Brave or Helium, opened from http://localhost or an https address. Firefox and Safari do not support WebHID.");
  } else {
    navigator.hid.addEventListener("disconnect", e => { if (e.device === device) markDisconnected(); });
    navigator.hid.addEventListener("connect", e => { if (!device && isGamepad(e.device)) attach(e.device).catch(report); });
    navigator.hid.getDevices().then(list => { const d = list.find(isGamepad); if (d) attach(d).catch(report); });
  }

  // ---------- indicator LED (DualShock output report 0x05 over USB: runtime state only) ----------
  async function sendLed(r, g, b) {
    const status = $("ledStatus");
    if (demo) { status.textContent = "Demo mode: nothing was sent."; return; }
    if (!device) { status.textContent = "Connect the controller first."; return; }
    if (transport !== "USB") { status.textContent = "The LED can only be set over USB. Over Bluetooth the controller expects a checksum that this page does not add."; return; }
    const data = new Uint8Array(31);
    data[0] = 0x02;                 // valid flags: lightbar only, no rumble
    data[5] = r; data[6] = g; data[7] = b;
    try { await device.sendReport(0x05, data); status.textContent = "Sent."; }
    catch (err) { status.textContent = "The controller refused the report: " + err.message; }
  }
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  $("ledApply").addEventListener("click", () => sendLed(...rgb(S.led)));
  $("ledOff").addEventListener("click", () => sendLed(0, 0, 0));
})();
