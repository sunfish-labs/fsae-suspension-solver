// ---------------------------------------------------------------- 3D for CAD (Save ▾ → 3D for CAD…)
const CADX = window.SuspCAD;
const CAD_EXT = { igs: ".igs", step: ".step", csv: "_points.csv", stl: "_tubes.stl" };
function cadOpts() {
  return { fmt: $("#cadFmt").value, frame: $("#cadFrame").value, origin: $("#cadOrigin").value, units: $("#cadUnits").value,
    poses: [["bump", "#cadBump"], ["droop", "#cadDroop"], ["steer", "#cadSteer"]].filter(([, id]) => $(id).checked).map(([p]) => p) };
}
function cadGeometry(o) {
  const X = exportScope();
  if (!X.corners.length) throw new Error("Nothing to export: fix the design errors first.");
  const wb = X.isCar ? (car.vehicle || {}).wheelbase || X.corners[0].e.cfg.vehicle.wheelbase : null;
  return [X, CADX.geometry(X.corners.map(k => ({ e: k.e })), { frame: o.frame, origin: o.origin, units: o.units, poses: o.fmt === "stl" ? [] : o.poses, wheelbase: wb })];
}
function cadRefresh() {
  const o = cadOpts();
  try {
    const [X, g] = cadGeometry(o);
    $("#cadScope").textContent = X.isCar ? `The whole car: ${X.corners.map(k => k.lab.toLowerCase()).join(" and ")} corners, both sides.` : `This ${X.corners[0].lab.toLowerCase()} corner, both sides.`;
    $("#cadInfo").textContent = o.fmt === "stl" ? `${g.lines.filter(l => l.od).length} tubes at ride height.`
      : `${g.points.length} named points and ${g.lines.length} lines in ${g.layers.length} layers.`;
    $("#cadGo").disabled = false;
  } catch (e) { $("#cadInfo").textContent = e.message; $("#cadGo").disabled = true; }
  $$(".cadposes input").forEach(b => b.disabled = o.fmt === "stl");
  store.set("susp.cad", JSON.stringify(o));
}
function openCad() {
  $("#cadFrame").innerHTML = Object.entries(CADX.FRAMES).map(([k, f]) => `<option value="${k}">${esc(f.label)}</option>`).join("");
  let saved = {}; try { saved = JSON.parse(store.get("susp.cad") || "{}") || {}; } catch (e) { saved = {}; }
  for (const [k, id] of [["fmt", "#cadFmt"], ["frame", "#cadFrame"], ["origin", "#cadOrigin"], ["units", "#cadUnits"]]) if (saved[k] && $(id).querySelector(`option[value="${saved[k]}"]`)) $(id).value = saved[k];
  if (Array.isArray(saved.poses)) [["bump", "#cadBump"], ["droop", "#cadDroop"], ["steer", "#cadSteer"]].forEach(([p, id]) => $(id).checked = saved.poses.includes(p));
  $("#cadDlg").hidden = false; cadRefresh(); setTimeout(() => $("#cadGo").focus(), 0);
}
function closeCad() { $("#cadDlg").hidden = true; }
function wireCad() {
  $("#xCad").addEventListener("click", () => { $("#xmenu").open = false; openCad(); });
  $("#cadClose").addEventListener("click", closeCad);
  $("#cadDlg").addEventListener("click", (e) => { if (e.target.id === "cadDlg") closeCad(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#cadDlg").hidden) closeCad(); });
  $$("#cadDlg select, #cadDlg input").forEach(el => el.addEventListener("change", cadRefresh));
  $("#cadGo").addEventListener("click", () => {
    const o = cadOpts();
    try {
      const [X, g] = cadGeometry(o), meta = { name: X.name };
      const text = o.fmt === "igs" ? CADX.toIGES(g, meta) : o.fmt === "step" ? CADX.toSTEP(g, meta) : o.fmt === "csv" ? CADX.toCSV(g) : CADX.toSTL(g, meta);
      download(fileBase(X.name) + CAD_EXT[o.fmt], new Blob([text], { type: o.fmt === "csv" ? "text/csv" : "application/octet-stream" }));
      flash(`Saved ${fileBase(X.name) + CAD_EXT[o.fmt]} (${o.units}, ${o.frame === "sw" ? "SolidWorks axes" : CADX.FRAMES[o.frame].label.split(":")[0]})`);
    } catch (e) { $("#cadInfo").textContent = "Export failed: " + e.message; }
  });
}
