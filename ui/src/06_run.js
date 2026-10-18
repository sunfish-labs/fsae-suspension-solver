// 06_run.js - Re-solving on every edit (debounced), and the JSON the Save menu writes.
// ------------------------------------------------------------------ run
let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(run, 160);
}
window.__suspIdle = () => busyN === 0 && timer === null;
function run() {
  timer = null;
  const t0 = performance.now();
  syncCar();
  try {
    ev = S.evaluate(cfg);
    loads = ev.spring ? S.runLoads(ev.cfg, ev.susp, ev.spring, carLltdFor(ev)) : null;
    err = null;
  } catch (e) {
    err = e;
    console.warn(e);
  }
  const ms = performance.now() - t0;
  if (!chal) store.set("susp.cfg", JSON.stringify(cfg));
  if (car && !chal) {
    store.set("susp.car", JSON.stringify(exportCar(true)));
    carRes = axleView === "car" ? evalCar() : null;
  }
  $("#jsonBox").value = JSON.stringify(exportCfg(), null, 2);
  const [Dt, Bt] = cfg.sweep ? S.travelRange(cfg) : [30, 30],
    Rk = cfg.sweep?.rack_travel ?? 35;
  const pz = $("#poseZ"),
    pr = $("#poseR");
  pz.min = -Dt;
  pz.max = Bt;
  pr.min = -Rk;
  pr.max = Rk;
  pose.dz = Math.max(-Dt, Math.min(Bt, pose.dz));
  pose.rack = cfg.axle === "rear" ? 0 : Math.max(-Rk, Math.min(Rk, pose.rack));
  pz.value = pose.dz;
  pr.value = pose.rack;
  teamCheck();
  renderAll(ms);
  showCurName();
  syncLegLabels();
  if (car && axleView === "car" && !chal) {
    renderCarIn();
    renderCarBox();
    renderLayoutBox();
  }
  renderViewTabs();
  updateScene();
}
function showCurName() {
  const el = $("#curName");
  if (!el || !cfg) return;
  el.innerHTML = chal
    ? `Challenge: <b>${esc(chal.def.title)}</b>`
    : car && axleView === "car"
      ? `<b>${esc(car.name || "Car")}</b>`
      : `${cfg.axle === "rear" ? "Rear" : "Front"}: <b>${esc(cfg.name || "untitled")}</b>`;
}
const exportCurrent = () => (car && axleView === "car" && !chal ? exportCar() : exportCfg());
function exportCfg() {
  const keys = [
    "name",
    "axle",
    "targets_file",
    "hardpoints",
    "wheel",
    "vehicle",
    "sweep",
    "clearance",
    "rack_direction",
    "targets",
    "spring",
    "loads",
    "members",
    "arb",
    "halfshaft",
    "joints",
  ];
  // saved in the team frame (ISO 8855, origin under the front axle): see 05_frame.js
  const c = S.cornerOut(cfg),
    o = { frame: S.FRAME };
  for (const k of keys) if (c[k] != null) o[k] = c[k];
  return o;
}
