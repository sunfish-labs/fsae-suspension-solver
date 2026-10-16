// ---------------------------------------------------------------- 3D for CAD (Export ▾ → 3D for CAD…)
const CADX = window.SuspCAD;
const CAD_EXT = { solid: "_solids.step", igs: ".igs", step: ".step", csv: "_points.csv", stl: "_tubes.stl", fea: "_fea_loads.csv" };
const CAD_RIDE_ONLY = new Set(["stl", "solid", "fea"]); // body formats: ride height only (FEA loads: each case's own pose)
const wbOf = X => (X.isCar ? (car.vehicle || {}).wheelbase || X.corners[0].e.cfg.vehicle.wheelbase : null);
function cadOpts() {
  return {
    fmt: $("#cadFmt").value,
    frame: $("#cadFrame").value,
    origin: $("#cadOrigin").value,
    units: $("#cadUnits").value,
    poses: [
      ["bump", "#cadBump"],
      ["droop", "#cadDroop"],
      ["steer", "#cadSteer"],
    ]
      .filter(([, id]) => $(id).checked)
      .map(([p]) => p),
  };
}
function cadGeometry(o) {
  const X = exportScope();
  if (!X.corners.length) throw new Error("Nothing to export: fix the design errors first.");
  const wb = X.isCar ? (car.vehicle || {}).wheelbase || X.corners[0].e.cfg.vehicle.wheelbase : null;
  return [
    X,
    CADX.geometry(
      X.corners.map(k => ({ e: k.e })),
      { frame: o.frame, origin: o.origin, units: o.units, poses: CAD_RIDE_ONLY.has(o.fmt) ? [] : o.poses, wheelbase: wb }
    ),
  ];
}
function cadRefresh() {
  const o = cadOpts();
  try {
    const [X, g] = cadGeometry(o);
    $("#cadScope").textContent = X.isCar
      ? `The whole car: ${X.corners.map(k => k.lab.toLowerCase()).join(" and ")} corners, both sides.`
      : `This ${X.corners[0].lab.toLowerCase()} corner, both sides.`;
    const nFea =
      o.fmt === "fea"
        ? CADX.toFEACSV(X.corners, { frame: o.frame, origin: o.origin, units: o.units, wheelbase: wbOf(X) }).split("\n").length - 2
        : 0;
    $("#cadInfo").textContent =
      o.fmt === "fea"
        ? nFea > 0
          ? `${nFea} forces: every load case, on the upright, each wishbone and the rocker of the right-hand ${X.isCar ? "corners" : "corner"}, at their points in these axes and units (forces in N). In FEA, hold the part where it meets the chassis (pivots) and apply the rest; each part's forces balance, so the supports should carry almost nothing.`
          : "Part loads need the spring block (pushrod, rocker, damper)."
        : o.fmt === "solid"
          ? `${g.bodies.length} solid parts at ride height: every link at its tube size, a ball at each joint and the tires. Each imports as its own named part.`
          : o.fmt === "stl"
            ? `${g.lines.filter(l => l.od).length} tubes at ride height.`
            : `${g.points.length} named points and ${g.lines.length} lines in ${g.layers.length} layers.`;
    $("#cadGo").disabled = false;
  } catch (e) {
    $("#cadInfo").textContent = e.message;
    $("#cadGo").disabled = true;
  }
  $$(".cadposes input").forEach(b => (b.disabled = CAD_RIDE_ONLY.has(o.fmt)));
  store.set("susp.cad", JSON.stringify(o));
}
function openCad(fmt = null) {
  $("#cadFrame").innerHTML = Object.entries(CADX.FRAMES)
    .map(([k, f]) => `<option value="${attr(k)}">${esc(f.label)}</option>`)
    .join("");
  let saved = {};
  try {
    saved = JSON.parse(store.get("susp.cad") || "{}") || {};
  } catch (e) {
    saved = {};
  }
  for (const [k, id] of [
    ["fmt", "#cadFmt"],
    ["frame", "#cadFrame"],
    ["origin", "#cadOrigin"],
    ["units", "#cadUnits"],
  ])
    if (saved[k] && $(id).querySelector(`option[value="${cssq(saved[k])}"]`)) $(id).value = saved[k];
  if (Array.isArray(saved.poses))
    [
      ["bump", "#cadBump"],
      ["droop", "#cadDroop"],
      ["steer", "#cadSteer"],
    ].forEach(([p, id]) => ($(id).checked = saved.poses.includes(p)));
  if (fmt) $("#cadFmt").value = fmt;
  $("#cadTitle").textContent = $("#cadFmt").value === "fea" ? "Part loads for FEA" : "3D for CAD";
  $("#cadDlg").hidden = false;
  cadRefresh();
  setTimeout(() => $("#cadGo").focus(), 0);
}
function closeCad() {
  $("#cadDlg").hidden = true;
}
function wireCad() {
  $("#xCad").addEventListener("click", () => {
    $("#exMenu").open = false;
    openCad($("#cadFmt").value === "fea" ? "solid" : null);
  });
  $("#xFea").addEventListener("click", () => {
    $("#exMenu").open = false;
    openCad("fea");
  });
  $("#cadClose").addEventListener("click", closeCad);
  $("#cadDlg").addEventListener("click", e => {
    if (e.target.id === "cadDlg") closeCad();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("#cadDlg").hidden) closeCad();
  });
  $$("#cadDlg select, #cadDlg input").forEach(el =>
    el.addEventListener("change", () => {
      $("#cadTitle").textContent = $("#cadFmt").value === "fea" ? "Part loads for FEA" : "3D for CAD";
      cadRefresh();
    })
  );
  $("#cadGo").addEventListener("click", () => {
    const o = cadOpts();
    try {
      const [X, g] = cadGeometry(o),
        meta = { name: X.name };
      const text =
        o.fmt === "fea"
          ? CADX.toFEACSV(X.corners, { frame: o.frame, origin: o.origin, units: o.units, wheelbase: wbOf(X) })
          : o.fmt === "solid"
            ? CADX.toSTEPSolid(g, meta)
            : o.fmt === "igs"
              ? CADX.toIGES(g, meta)
              : o.fmt === "step"
                ? CADX.toSTEP(g, meta)
                : o.fmt === "csv"
                  ? CADX.toCSV(g)
                  : CADX.toSTL(g, meta);
      download(
        fileBase(X.name) + CAD_EXT[o.fmt],
        new Blob([text], { type: o.fmt === "csv" || o.fmt === "fea" ? "text/csv" : "application/octet-stream" })
      );
      flash(
        `Saved ${fileBase(X.name) + CAD_EXT[o.fmt]} (${o.units}, ${o.frame === "sw" ? "SolidWorks axes" : CADX.FRAMES[o.frame].label.split(":")[0]})`
      );
    } catch (e) {
      $("#cadInfo").textContent = "Export failed: " + e.message;
    }
  });
}
