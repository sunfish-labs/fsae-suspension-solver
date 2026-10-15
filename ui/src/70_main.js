// ------------------------------------------------------------------ toolbar
function loadCfg(raw, name, opts = {}) {
  try { S.finishConfig(raw); } catch (e) { $("#jsonMsg").textContent = e.message; return false; }
  cfg = JSON.parse(JSON.stringify(raw));
  for (const k of ["wheel", "vehicle", "sweep", "clearance", "loads", "members"]) cfg[k] = S.deepMerge(S.DEFAULTS[k], cfg[k] || {});
  if (!cfg.rack_direction) cfg.rack_direction = [0, 1, 0];
  if (cfg.spring) cfg.spring = S.deepMerge(S.SPRING_DEFAULTS, cfg.spring);
  savedSpring = null; savedRocker = null;
  if (car && !chal) {
    const ax = cfg.axle === "rear" ? "rear" : "front";
    car.vehicle = cfg.vehicle; car[ax] = cfg; car[ax === "front" ? "rear" : "front"].vehicle = car.vehicle; car.src[ax] = name || cfg.name || "";
    if (axleView !== "car" || opts.toView) { axleView = opts.toView || ax; store.set("susp.view", axleView); }
    applyViewClasses();
  }
  fillForm(); run(); return true;
}
{ const grp = (lab, f) => { const o = PRESETS.map((p, i) => [p, i]).filter(([p]) => f(p.cfg)); return o.length ? `<optgroup label="${lab}">${o.map(([p, i]) => `<option value="${i}">${esc(p.label)}</option>`).join("")}</optgroup>` : ""; };
  $("#preset").innerHTML = grp("Whole cars", isCarRaw) + grp("Front corners", c => c.hardpoints && c.axle !== "rear") + grp("Rear corners", c => c.hardpoints && c.axle === "rear") + `<option value="custom" hidden>Your edits</option>`; }
$("#preset").addEventListener("change", (e) => {
  if (e.target.value === "custom") return; if (chal) exitChallenge(true); view.target = null;
  const p = PRESETS[+e.target.value];
  if (isCarRaw(p.cfg)) { axleView = "car"; store.set("susp.view", "car"); applyViewClasses(); loadCar(p.cfg, p.label); }
  else loadCfg(p.cfg, p.label, { toView: p.cfg.axle === "rear" ? "rear" : "front" });
});
function flash(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(flash.t); flash.t = setTimeout(() => t.hidden = true, 2200); }
$("#fileIn").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const raw = JSON.parse(await f.text());
    if (isCarRaw(raw)) { if (chal) exitChallenge(true); axleView = "car"; store.set("susp.view", "car"); applyViewClasses(); if (loadCar(raw, f.name)) $("#preset").value = "custom"; }
    else if (!raw.hardpoints && (raw.front || raw.rear || raw.targets || Object.values(raw).some(v => Array.isArray(v) && v.length === 2))) {
      const t = S.targetsFromFile(raw, cfg.axle); delete t._note;
      cfg.targets = Object.assign({}, t, cfg.targets || {});
      if (car && axleView === "car") { const o = car.rear === cfg ? car.front : car.rear, t2 = S.targetsFromFile(raw, o.axle); delete t2._note; o.targets = Object.assign({}, t2, o.targets || {}); }
      $("#preset").value = "custom"; run();
      $("#errBox").insertAdjacentHTML("afterbegin", `<div class="banner warn">Applied ${Object.keys(t).length} target ranges from ${esc(f.name)} to this design. They are now saved in its JSON under <span class="mono">targets</span>.</div>`);
    } else { if (chal) exitChallenge(true); view.target = null; if (loadCfg(raw, f.name, { toView: raw.axle === "rear" ? "rear" : "front" })) $("#preset").value = "custom"; }
  }
  catch (ex) { $("#errBox").innerHTML = `<div class="banner bad">${esc(f.name)} is not a valid config: ${esc(ex.message)}</div>`; }
  e.target.value = "";
});
$("#carFile").addEventListener("change", async (e) => {
  const f = e.target.files[0], ax = carSlotPending; e.target.value = ""; if (!f || !ax) return;
  try { const raw = JSON.parse(await f.text());
    if (isCarRaw(raw)) { loadCar(raw, f.name); return; }
    if (!raw.hardpoints) throw new Error("no hardpoints in this file");
    const note = raw.axle && raw.axle !== ax ? ` It was saved as a ${raw.axle} corner and is now used as the ${ax}.` : "";
    loadCfg(Object.assign({}, raw, { axle: ax }), f.name, { toView: "car" }); $("#preset").value = "custom";
    $("#errBox").insertAdjacentHTML("afterbegin", `<div class="banner warn">Opened ${esc(f.name)} as the ${ax} corner. Its vehicle settings (mass, CG, wheelbase…) now apply to the whole car.${note}</div>`);
  } catch (ex) { $("#errBox").innerHTML = `<div class="banner bad">${esc(f.name)} is not a valid design: ${esc(ex.message)}</div>`; }
});
$$("#axleSeg button").forEach(b => b.addEventListener("click", () => { if (chal) return; setView(b.dataset.ax); }));
$("#btnCopy").addEventListener("click", async (e) => {
  const txt = JSON.stringify(exportCurrent(), null, 2), b = e.currentTarget;
  $("#xmenu").open = false;
  try { await navigator.clipboard.writeText(txt); flash("Copied the JSON"); }
  catch (ex) { if (axleView === "car") setView("front"); $("#cardJson").open = true; $("#jsonBox").focus(); $("#jsonBox").select(); flash("Copy blocked by the browser: select the JSON box and copy"); }
});
// Save JSON: a real file on the user's computer. Chrome/Edge can save straight back to the file that was opened;
// other browsers download a copy. Hidden only inside sandboxed embeds, where downloads are blocked.
let framed = false; try { framed = window.self !== window.top; } catch (e) { framed = true; }
let fileHandle = null;
if (!framed) {
  $("#btnDownload").hidden = false; if (window.showSaveFilePicker) $("#btnSaveAs").hidden = false;
  $("#btnSaveAs").addEventListener("click", () => { fileHandle = null; $("#btnDownload").click(); });
  $("#btnDownload").addEventListener("click", async () => {
    const txt = JSON.stringify(exportCurrent(), null, 2), name = ((axleView === "car" && car && !chal ? car.name : cfg.name) || "design").replace(/[^\w.-]+/g, "_") + ".json", b = $("#btnDownload");
    try {
      if (window.showSaveFilePicker) {
        if (!fileHandle) fileHandle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: "Design JSON", accept: { "application/json": [".json"] } }] });
        const w = await fileHandle.createWritable(); await w.write(txt); await w.close();
        $("#xmenu").open = false; flash("Saved to " + fileHandle.name); return;
      }
    } catch (ex) { if (ex && ex.name === "AbortError") return; fileHandle = null; }
    const blob = new Blob([txt], { type: "application/json" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $("#xmenu").open = false;
  });
}
// first-visit card, shown on every visit until "Don't show this again" is ticked
function openWelcome() { $("#welcome").hidden = false; $("#wHide").checked = store.get("susp.hideWelcome") === "1"; setTimeout(() => $("#wExplore").focus(), 0); }
function closeWelcome() { store.set("susp.hideWelcome", $("#wHide").checked ? "1" : "0"); $("#welcome").hidden = true; }
$("#btnStart").addEventListener("click", openWelcome);
function openLearn() { if (chal) return; if (axleView === "car") setView("front"); tab = "learn"; renderTabs(); showPanel(); $("#tabs").scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" }); }
$("#btnLearn").addEventListener("click", openLearn);
$("#wClose").addEventListener("click", closeWelcome);
$("#welcome").addEventListener("click", (e) => { if (e.target.id === "welcome") closeWelcome(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#welcome").hidden) closeWelcome(); });
$("#wExplore").addEventListener("click", () => { closeWelcome(); if (!chal) { $("#preset").value = String(PRESETS.findIndex(p => isCarRaw(p.cfg))); $("#preset").dispatchEvent(new Event("change")); } });
$("#wOpen").addEventListener("click", () => { closeWelcome(); $("#fileIn").click(); });
$("#wChal").addEventListener("click", () => { closeWelcome(); openChallenges(); });
$("#wLearn").addEventListener("click", () => { closeWelcome(); openLearn(); });
$("#btnApplyJson").addEventListener("click", () => {
  try { const raw = JSON.parse($("#jsonBox").value); if (loadCfg(raw)) { $("#jsonMsg").textContent = "Applied."; $("#preset").value = "custom"; } }
  catch (ex) { $("#jsonMsg").textContent = "Not valid JSON: " + ex.message; }
});
$("#btnUndo").addEventListener("click", () => undo());


document.addEventListener("input", (e) => { if (e.target.dataset && e.target.dataset.path) $("#preset").value = "custom"; });

// ------------------------------------------------------------------ boot
buildForm();
initThree();
const savedTab = store.get("susp.tab"); if (savedTab && TABS.some(t => t[0] === savedTab) && savedTab !== "learn") tab = savedTab;
$("#panels").addEventListener("click", (e) => { const b = e.target.closest("[data-msub]"); if (!b) return; tab = b.dataset.msub; store.set("susp.tab", tab); renderTabs(); showPanel(); });
wireExport();
{ const dm = $("#dispMenu"); document.addEventListener("click", (e) => { if (dm.open && !dm.contains(e.target)) dm.open = false; }); }
// color theme: Auto follows the computer; Light / Dark are remembered in this browser
{ const tm = $("#themeMenu"), cur = () => document.documentElement.getAttribute("data-theme") || "";
  const sync = () => $$("#themeMenu [data-theme-set]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeSet === cur())));
  document.addEventListener("click", (e) => { if (tm.open && !tm.contains(e.target)) tm.open = false; });
  $$("#themeMenu [data-theme-set]").forEach(b => b.addEventListener("click", () => { const t = b.dataset.themeSet;
    if (t) document.documentElement.setAttribute("data-theme", t); else document.documentElement.removeAttribute("data-theme");
    store.set("susp.theme", t); sync(); tm.open = false; }));
  sync(); }
// boot: the saved car if there is one; else an old single-corner draft inside the example car; else the example car
{
  const ex = exampleCarRaw(), savedCar = store.get("susp.car"), saved = store.get("susp.cfg");
  let ok = false;
  if (savedCar) { try { const raw = JSON.parse(savedCar); if (isCarRaw(raw)) { car = carFrom(raw); car.src = { front: "your edits", rear: "your edits" }; ok = true; } } catch (e) { /* bad draft */ } }
  if (!ok) car = carFrom(ex);
  if (!["car", "front", "rear"].includes(axleView)) axleView = "car";
  cfg = car[axleView === "rear" ? "rear" : "front"];
  if (!ok && saved) { try { const raw = JSON.parse(saved); S.finishConfig(JSON.parse(saved)); const c = cornerFrom(raw); car[c.axle === "rear" ? "rear" : "front"] = c; car.vehicle = c.vehicle; car.front.vehicle = car.rear.vehicle = c.vehicle; car.src[c.axle] = "your edits"; cfg = car[axleView === "rear" ? "rear" : "front"]; } catch (e) { /* ignore */ } }
  $("#preset").value = ok || saved ? "custom" : String(PRESETS.findIndex(p => p.cfg === ex));
  applyViewClasses(); fillForm(); run();
}
$("#vhint").hidden = store.get("susp.tipSeen") === "1";
if (store.get("susp.hideWelcome") !== "1") openWelcome();
