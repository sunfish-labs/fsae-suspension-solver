// 05_inputs.js - The input forms: hardpoint and spring tables, fields, filling them from the config and reading edits back.
// ------------------------------------------------------------------ input builders
// input-table names for the points (schema/points.json): [label, hint]
const HP_LABELS = Object.fromEntries(S.SCHEMA.points.hardpoints.map(p => [p.key, [p.label, p.hint]]));
const ARB_LABELS = {
  link_outboard: ["Drop link, lower end", "on the part it is mounted on (wishbone, upright or rocker)"],
  arm_tip: ["Drop link, upper end", "= the tip of the bar's arm"],
  bar_pivot: ["Bar axis point", "any point on the bar's axis (the axis runs along Y)"],
};
const SP_LABELS = Object.fromEntries(S.SCHEMA.points.spring_points.map(p => [p.key, [p.label, p.hint]]));

function numInput(path, opts = {}) {
  const id = "in_" + path.replace(/\./g, "_");
  return `<input class="num" id="${attr(id)}" type="number" step="${attr(opts.step ?? "any")}" inputmode="decimal" data-path="${attr(path)}" data-type="${attr(opts.type ?? "num")}"${opts.scale ? ` data-scale="${attr(opts.scale)}"` : ""}${opts.opt ? ' data-opt="1"' : ""} aria-label="${esc(opts.aria ?? path)}">`;
}
function field(label, unit, path, opts = {}) {
  const id = "in_" + path.replace(/\./g, "_");
  if (opts.options)
    return `<div class="field"><label for="${attr(id)}">${label}</label><select id="${attr(id)}" data-path="${attr(path)}" data-type="select">${opts.options.map(([v, t]) => `<option value="${attr(v)}">${t}</option>`).join("")}</select></div>`;
  return `<div class="field"><label for="${attr(id)}">${label} <i>${unit}</i></label>${numInput(path, { ...opts, aria: label })}</div>`;
}
function ptRows(tbody, list, prefix, labels) {
  tbody.innerHTML = list
    .map(
      k =>
        `<tr data-row="${attr(k)}"><td class="lab"${labels[k][1] ? ` title="${esc(labels[k][1])}"` : ""}>${k === "rocker_axis" || prefix === "arb" ? labels[k][0] : `<button class="lnk hpbtn" type="button" data-hp="${prefix}.${k}" title="${labels[k][1] ? esc(labels[k][1]) + " · " : ""}click: what does moving this point do?">${labels[k][0]}</button>`}</td>` +
        [0, 1, 2]
          .map(
            i =>
              `<td class="c">${numInput(`${prefix}.${k}.${i}`, { aria: `${labels[k][0]} ${"XYZ"[i]}`, step: k === "rocker_axis" ? "0.1" : "0.1" })}</td>`
          )
          .join("") +
        "</tr>"
    )
    .join("");
}
function buildForm() {
  ptRows($("#hpTable tbody"), S.HP_ORDER, "hardpoints", HP_LABELS);
  ptRows($("#spTable tbody"), S.SPRING_POINTS, "spring", SP_LABELS);
  $("#wheelFields").innerHTML = [
    field("Camber", "deg", "wheel.camber_deg", { step: 0.1 }),
    field("Toe (+ in)", "deg", "wheel.toe_deg", { step: 0.01 }),
    field("Rim diameter", "in", "wheel.rim_diameter_in"),
    field("Tire width", "mm", "wheel.tire_width"),
    field("Tire radius", "mm", "wheel.tire_radius"),
    field("Rim barrel inner radius", "mm", "wheel.rim_inner_radius", { step: 0.5, opt: 1 }),
    field("Caliper clock angle (0 = front, 90 = top)", "deg", "wheel.caliper.clock_deg", { step: 5, opt: 1 }),
    field("Caliper center radius from axle", "mm", "wheel.caliper.radius", { step: 1, opt: 1 }),
    field("Caliper envelope size", "mm", "wheel.caliper.size", { step: 1, opt: 1 }),
    field("Caliper offset along axle (+ out)", "mm", "wheel.caliper.offset", { step: 1, opt: 1 }),
  ].join("");
  $("#vehFields").innerHTML = [
    field("Axle", "", "axle", {
      options: [
        ["front", "Front axle"],
        ["rear", "Rear axle"],
      ],
    }),
    field("Brake balance (front)", "%", "vehicle.front_brake_share", { scale: 100, step: 1 }),
    field("Wheelbase", "mm", "vehicle.wheelbase"),
    field("CG height", "mm", "vehicle.cg_height"),
    field("Car mass with driver", "kg", "vehicle.mass"),
    field("Weight on front", "%", "vehicle.weight_front", { scale: 100, step: 0.5 }),
    field("Brakes", "", "vehicle.brakes", {
      options: [
        ["outboard", "Outboard (at upright)"],
        ["inboard", "Inboard (on chassis)"],
      ],
    }),
    field("Drive", "", "vehicle.drive", {
      options: [
        ["inboard", "Inboard diff / halfshafts"],
        ["outboard", "Outboard (hub motor)"],
      ],
    }),
    field("Steering ratio (rack per wheel turn)", "mm/rev", "vehicle.rack_c_factor", { step: 1, opt: 1 }),
    field("Aero downforce, front axle", "N", "vehicle.aero_front", { step: 50, opt: 1 }),
    field("Aero downforce, rear axle", "N", "vehicle.aero_rear", { step: 50, opt: 1 }),
    field("Diff output X", "mm", "halfshaft.diff_output.0", { step: 1, opt: 1 }),
    field("Diff output Y", "mm", "halfshaft.diff_output.1", { step: 1, opt: 1 }),
    field("Diff output Z", "mm", "halfshaft.diff_output.2", { step: 1, opt: 1 }),
    field("Outboard CV X", "mm", "halfshaft.cv_outboard.0", { step: 1, opt: 1 }),
    field("Outboard CV Y", "mm", "halfshaft.cv_outboard.1", { step: 1, opt: 1 }),
    field("Outboard CV Z", "mm", "halfshaft.cv_outboard.2", { step: 1, opt: 1 }),
    field("Plunge limit", "mm", "halfshaft.plunge_max", { step: 1, opt: 1 }),
  ].join("");
  $("#simFields").innerHTML = [
    field("Vertical travel ±", "mm", "sweep.travel", { step: 1 }),
    field("Bump travel (if different)", "mm", "sweep.bump_travel", { step: 1, opt: 1 }),
    field("Droop travel (if different)", "mm", "sweep.droop_travel", { step: 1, opt: 1 }),
    field("Rack travel ±", "mm", "sweep.rack_travel", { step: 1 }),
    field("Body roll ±", "deg", "sweep.roll_deg", { step: 0.25 }),
    field("Ackermann at outer wheel", "deg", "sweep.ackermann_at_outer_deg", { step: 1 }),
  ].join("");
  $("#spFields").innerHTML = [
    field("Spring rate", "N/mm", "spring.spring_rate", { step: 1 }),
    field("Target ride freq", "Hz", "spring.target_freq_hz", { step: 0.1, opt: 1 }),
    field("Damper eye-to-eye (extended)", "mm", "spring.damper_eye_to_eye", { opt: 1 }),
    field("Damper stroke", "mm", "spring.damper_stroke", { opt: 1 }),
    field("Unsprung mass / corner", "kg", "spring.unsprung_mass", { step: 0.5 }),
    field("Tire vertical rate", "N/mm", "spring.tire_rate", { step: 5 }),
  ].join("");
  $("#dampFields").innerHTML = [
    field("Bump, low-speed", "N s/m", "spring.damper_bump_low", { step: 50, opt: 1 }),
    field("Rebound, low-speed", "N s/m", "spring.damper_rebound_low", { step: 50, opt: 1 }),
    field("Bump, high-speed", "N s/m", "spring.damper_bump_high", { step: 50, opt: 1 }),
    field("Rebound, high-speed", "N s/m", "spring.damper_rebound_high", { step: 50, opt: 1 }),
    field("Knee (low → high speed)", "mm/s", "spring.damper_knee", { step: 5 }),
    field("Target damping ratio, low-speed", "", "spring.target_zeta_low", { step: 0.05 }),
    field("Target damping ratio, high-speed", "", "spring.target_zeta_high", { step: 0.05 }),
  ].join("");
  $("#progFields").innerHTML = [
    field("Second spring rate", "N/mm", "spring.spring_rate2", { step: 1, opt: 1 }),
    field("…from damper compression", "mm", "spring.spring_breakpoint", { step: 0.5, opt: 1 }),
    field("Bump stop gap", "mm", "spring.bumpstop_gap", { step: 0.5, opt: 1 }),
    field("Bump stop rate at touch", "N/mm", "spring.bumpstop_k", { step: 5, opt: 1 }),
    field("Bump stop progression", "N/mm²", "spring.bumpstop_k2", { step: 0.5, opt: 1 }),
  ].join("");
  ptRows($("#arbTable tbody"), ["link_outboard", "arm_tip", "bar_pivot"], "arb", ARB_LABELS);
  $("#arbFields").innerHTML = [
    field("Bar OD", "mm", "arb.bar_od", { step: 0.1 }),
    field("Bar wall (blank = solid)", "mm", "arb.bar_wall", { step: 0.1, opt: 1 }),
    field("Active length between arms", "mm", "arb.bar_length", { step: 5, opt: 1 }),
    field("Shear modulus G", "MPa", "arb.bar_G", { step: 100, opt: 1 }),
    field("Bar yield strength", "MPa", "arb.bar_yield", { step: 10, opt: 1 }),
  ].join("");
  $("#loadFields").innerHTML = [
    field("Bump", "g", "loads.bump_g", { step: 0.1 }),
    field("Cornering", "g", "loads.corner_g", { step: 0.1 }),
    field("Braking", "g", "loads.brake_g", { step: 0.1 }),
    field("Brake + corner", "g", "loads.combined_g", { step: 0.1 }),
    field("Acceleration (rear)", "g", "loads.accel_g", { step: 0.1 }),
    field("Pothole impact (vertical)", "g", "loads.pothole_g", { step: 0.5, opt: 1 }),
    field("Kerb strike (sideways)", "g", "loads.kerb_g", { step: 0.5, opt: 1 }),
    field("Braking force split", "", "loads.brake_split", {
      options: [
        ["bias", "By brake bias (front share)"],
        ["grip", "Same grip use at every tire"],
      ],
    }),
    field("Front LLTD override", "", "loads.lltd_front", { step: 0.01, opt: 1 }),
  ].join("");
  $("#tubeFields").innerHTML = [
    field("Wishbone OD", "mm", "members.wishbone.0"),
    field("Wishbone wall", "mm", "members.wishbone.1"),
    field("Tie rod OD", "mm", "members.tie_rod.0"),
    field("Tie rod wall", "mm", "members.tie_rod.1"),
    field("Pushrod OD", "mm", "members.pushrod.0"),
    field("Pushrod wall", "mm", "members.pushrod.1"),
  ].join("");
  $("#matFields").innerHTML = [
    field("Young's modulus E", "MPa", "members.E", { step: 1000 }),
    field("Yield strength", "MPa", "members.yield", { step: 5 }),
    field("Required FOS", "", "members.sf_target", { step: 0.1 }),
  ].join("");
  $("#partFields").innerHTML = [
    field("Rod-end rating (catalog)", "N", "members.rod_end_rating", { step: 500, opt: 1 }),
    field("Ball-joint rating (catalog)", "N", "members.ball_joint_rating", { step: 500, opt: 1 }),
    field("Damper eye bearing rating", "N", "members.damper_eye_rating", { step: 500, opt: 1 }),
    field("Rocker pivot bearing rating", "N", "members.rocker_bearing_rating", { step: 500, opt: 1 }),
    field("Rod-end misalignment limit (catalog)", "deg", "members.rod_end_misalign", { step: 0.5 }),
    field("Spherical-bearing misalignment limit", "deg", "members.bearing_misalign", { step: 0.5 }),
    field("Bolt diameter", "mm", "members.bolt_dia", { step: 0.1 }),
    field("Bolt grade", "", "members.bolt_grade", {
      options: [
        ["SAE 8", "SAE grade 8"],
        ["SAE 5", "SAE grade 5"],
        ["8.8", "Metric 8.8"],
        ["10.9", "Metric 10.9"],
        ["12.9", "Metric 12.9"],
      ],
    }),
    field("Bolt shear", "", "members.bolt_shear_planes", {
      options: [
        ["2", "Double shear (clevis)"],
        ["1", "Single shear"],
      ],
    }),
  ].join("");
  $("#gusFields").innerHTML = [
    field("Reinforcement", "", "members.gusset.type", {
      options: [
        ["none", "Bare tube"],
        ["along_leg", "Gusset plate along the leg"],
        ["to_node", "Bracket into the ball-joint node"],
      ],
    }),
    field("Gusset thickness", "mm", "members.gusset.thickness", { step: 0.1 }),
    field("Gusset height at the mount", "mm", "members.gusset.height", { step: 1 }),
    field("Gusset length toward the pivot", "mm", "members.gusset.length_in", { step: 5 }),
    field("Gusset length toward the ball joint", "mm", "members.gusset.length_out", { step: 5 }),
    field("Gusset-end weld class (blank = by length)", "MPa", "members.gusset.fat", { step: 1, opt: 1 }),
  ].join("");
  $("#rkFields").innerHTML = [
    field("Check the rocker", "", "members.rocker.on", {
      options: [
        ["0", "Not checked (FEA with the part loads)"],
        ["1", "Check its plates"],
      ],
    }),
    field("Plate thickness (each)", "mm", "members.rocker.thickness", { step: 0.1 }),
    field("Plates", "", "members.rocker.plates", { step: 1 }),
    field("Pivot bore (bearing or bushing OD)", "mm", "members.rocker.pivot_bore", { step: 0.5 }),
    field("Pivot center to the hub's edge", "mm", "members.rocker.pivot_edge", { step: 0.5 }),
    field("Pin holes (blank = bolt diameter)", "mm", "members.rocker.pin_dia", { step: 0.1, opt: 1 }),
    field("Pin hole center to the edge", "mm", "members.rocker.edge", { step: 0.5 }),
    field("Arm depth (narrowest)", "mm", "members.rocker.width", { step: 0.5 }),
    field("Plate yield (6061-T6 241, 7075-T6 460)", "MPa", "members.rocker.yield", { step: 5, opt: 1 }),
  ].join("");
  $("#tabFields").innerHTML = [
    field("Tab thickness", "mm", "members.tab.thickness", { step: 0.1 }),
    field("Tab width", "mm", "members.tab.width", { step: 0.5 }),
    field("Hole center to tab end", "mm", "members.tab.edge", { step: 0.5 }),
    field("Tabs per link end", "", "members.tab.count", { step: 1 }),
    field("Weld leg", "mm", "members.tab.weld_leg", { step: 0.5 }),
    field("Weld length per tab", "mm", "members.tab.weld_length", { step: 1 }),
    field("Tab yield (blank = tube yield)", "MPa", "members.tab_yield", { step: 5, opt: 1 }),
  ].join("");
  $("#fatFields").innerHTML = [
    field("Tube ultimate strength", "MPa", "members.uts", { step: 5 }),
    field("Tube surface", "", "members.surface", {
      options: [
        ["machined", "Machined / cold-drawn"],
        ["ground", "Ground"],
        ["hot-rolled", "Hot-rolled"],
        ["as-forged", "As-forged"],
      ],
    }),
    field("Weld class at tube ends (IIW FAT)", "MPa", "members.weld_fat_tube", { step: 1 }),
    field("Weld class of tab welds (IIW FAT)", "MPa", "members.weld_fat_tab", { step: 1 }),
    field("Driving cases repeat", "times", "loads.fatigue_cycles", { step: 10000 }),
    field("Bump repeats", "times", "loads.fatigue_bump_cycles", { step: 1000 }),
    field("Required fatigue margin", "", "members.fatigue_sf", { step: 0.1 }),
  ].join("");
  $("#compFields").innerHTML = [
    field("Rod-end stiffness (each)", "N/mm", "members.rod_end_k", { step: 1000, opt: 1 }),
    field("Chassis tab / bracket stiffness", "N/mm", "members.mount_k", { step: 1000, opt: 1 }),
    field("Toe change limit", "deg", "members.toe_comp_limit", { step: 0.01, opt: 1 }),
    field("Camber change limit", "deg", "members.camber_comp_limit", { step: 0.01, opt: 1 }),
    field("Rack + mounts stiffness", "N/mm", "members.rack_k", { step: 1000, opt: 1 }),
    field("Steering column torsion", "N m/deg", "members.column_k", { step: 1, opt: 1 }),
  ].join("");
  $("#clrFields").innerHTML = [
    field("Wishbone tube OD", "mm", "clearance.wishbone_tube_od"),
    field("Tie rod OD", "mm", "clearance.tie_rod_od"),
    field("Pushrod OD", "mm", "clearance.pushrod_od"),
    field("Damper body OD", "mm", "clearance.damper_od"),
    field("Extra margin", "mm", "clearance.margin"),
    field("Halfshaft OD", "mm", "clearance.halfshaft_od"),
    field("Caliper margin to links / rim", "mm", "clearance.caliper_margin"),
  ].join("");
  $$("[data-path]").forEach(el => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", onInput));
  $("#in_axle").closest(".field").hidden = true; // the axle is set by the Front / Rear slot
  $$("[data-hp]").forEach(b =>
    b.addEventListener("click", () => {
      if (!ev || err) return;
      openInfluence(b.dataset.hp);
      const vr = $("#vwrap").getBoundingClientRect();
      if (vr.bottom < 80 || vr.top > window.innerHeight - 120)
        $("#vwrap").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    })
  );
}

// label the four inboard pivots by where they physically are (larger X = front), whatever their KineSolver key says
function syncLegLabels() {
  const hp = cfg && cfg.hardpoints;
  if (!hp) return;
  for (const arm of ["upper", "lower"]) {
    const a = hp[`${arm}_inboard_front`],
      b = hp[`${arm}_inboard_rear`];
    if (!a || !b) continue;
    const aFront = a[0] >= b[0];
    for (const [key, isFront] of [
      [`${arm}_inboard_front`, aFront],
      [`${arm}_inboard_rear`, !aFront],
    ]) {
      const btn = $(`#hpTable [data-hp="hardpoints.${key}"]`);
      if (!btn) continue;
      btn.textContent = `${arm === "upper" ? "Upper" : "Lower"} ${isFront ? "front" : "rear"} pivot`;
      btn.dataset.leg = isFront ? "front" : "rear";
      btn.title = `JSON key: ${key} (KineSolver "${key.endsWith("front") ? "front" : "rear"}" = ${key.endsWith("front") ? "smaller" : "larger"} X) · click: what does moving this point do?`;
    }
  }
}
function fillForm() {
  $$("[data-path]").forEach(el => {
    const path = el.dataset.path;
    if (path.startsWith("arb.") && !cfg.arb) {
      el.value = "";
      return;
    }
    if (path.startsWith("spring.") && !cfg.spring) {
      const v = getPath({ spring: savedSpring || S.DEFAULTS.spring || {} }, path);
      el.value = v == null ? "" : v;
      return;
    }
    const fp = framePath(path);
    if (fp && !frameIsDefault()) {
      const base = getPath(cfg, fp.base);
      if (Array.isArray(base) && base.length === 3) {
        const d = fp.kind === "pt" ? dispPt(base, cfg.axle) : dispDir(base);
        el.value = +d[fp.j].toFixed(6);
        return;
      }
    }
    if (path.startsWith("members.gusset.")) {
      const g = cfg.members.gusset;
      el.value =
        path === "members.gusset.type" ? (g ? g.type || "along_leg" : "none") : g && g[path.slice(15)] != null ? g[path.slice(15)] : "";
      return;
    }
    if (path.startsWith("members.rocker.")) {
      const r = cfg.members.rocker,
        k = path.slice(15);
      el.value = k === "on" ? (r ? "1" : "0") : r && r[k] != null ? r[k] : "";
      return;
    }
    let v = getPath(cfg, path);
    if (v == null) v = getPath(S.DEFAULTS, path);
    if (el.dataset.scale && v != null) v = +(v * +el.dataset.scale).toFixed(6);
    el.value = v == null ? "" : v;
  });
  $("#springOn").checked = !!cfg.spring;
  $("#arbOn").checked = !!cfg.arb;
  $("#arbOn").disabled = !cfg.spring;
  $("#arbBody").hidden = !cfg.arb;
  $("#springBody").hidden = !cfg.spring;
  $("#rockerOn").value = cfg.spring && cfg.spring.rocker_pivot == null ? "0" : "1";
  syncRockerRows();
  syncGusset();
  syncRockerPlates();
  syncAxle();
  syncLegLabels();
}
// gusset dimensions only for a gusset along the leg; the whole block only when the rod sits on a wishbone
function syncGusset() {
  const g = cfg.members.gusset,
    along = g && (g.type || "along_leg") === "along_leg",
    onArm = cfg.spring && (cfg.spring.rod_on === "lower" || cfg.spring.rod_on === "upper");
  $$('[data-path^="members.gusset."]').forEach(el => {
    el.closest(".field").hidden = !onArm || (el.dataset.path !== "members.gusset.type" && !along);
  });
}
const GUSSET_START = { type: "along_leg", thickness: 3.0, height: 30.0, length_in: 60.0, length_out: 40.0 };
// the rocker's plates: only with a rocker; the sizes only once the check is on (a typical pair of 1/4 in 6061-T6 plates)
const ROCKER_START = { thickness: 6.35, plates: 2, pivot_bore: 22.0, pivot_edge: 20.0, edge: 12.0, width: 30.0, yield: 241.0 };
function syncRockerPlates() {
  const rocker = cfg.spring && cfg.spring.rocker_pivot != null,
    on = !!cfg.members.rocker;
  $("#rkHead").hidden = !rocker;
  $$('[data-path^="members.rocker."]').forEach(el => {
    el.closest(".field").hidden = !rocker || (el.dataset.path !== "members.rocker.on" && !on);
  });
}
function syncRockerRows() {
  const direct = cfg.spring && cfg.spring.rocker_pivot == null;
  ["rocker_pivot", "rocker_axis", "rocker_rod", "rocker_damper"].forEach(k => {
    const r = $(`#spTable tr[data-row="${cssq(k)}"]`);
    if (r) r.hidden = !!direct;
  });
}
function syncAxle() {
  const rear = cfg.axle === "rear";
  $("#poseR").disabled = rear;
  $("#poseRo").disabled = rear;
  $("#poseR0").disabled = rear;
  $("#in_vehicle_drive").closest(".field").hidden = !rear;
  $("#in_sweep_rack_travel").closest(".field").hidden = rear;
  $("#in_sweep_ackermann_at_outer_deg").closest(".field").hidden = rear;
  $("#in_loads_accel_g").closest(".field").hidden = !rear;
  for (const id of ["vehicle_rack_c_factor", "vehicle_aero_front", "members_rack_k", "members_column_k"])
    $("#in_" + id).closest(".field").hidden = rear;
  $("#in_vehicle_aero_rear").closest(".field").hidden = !rear;
  $$('[data-path^="halfshaft."]').forEach(el => (el.closest(".field").hidden = !rear));
  $("#springHint").textContent = cfg.spring ? (cfg.spring.rocker_pivot == null ? "direct-acting" : "rocker") : "off";
}

function onInput(e) {
  const el = e.target,
    path = el.dataset.path;
  let v;
  if (el.dataset.type === "select" || el.dataset.type === "text") v = el.value;
  else {
    if (el.value === "") {
      if (el.dataset.opt) v = null;
      else return;
    } else {
      v = +el.value;
      if (!Number.isFinite(v)) return;
      if (el.dataset.scale) v /= +el.dataset.scale;
    }
  }
  if (path.startsWith("spring.") && !cfg.spring) return;
  if (path.startsWith("arb.") && !cfg.arb) return;
  if (path.startsWith("members.gusset.")) {
    const k = path.slice(15);
    if (k === "type") cfg.members.gusset = v === "none" ? null : v === "to_node" ? { type: "to_node" } : { ...GUSSET_START };
    else {
      const g = cfg.members.gusset && cfg.members.gusset.type !== "to_node" ? { ...cfg.members.gusset } : { ...GUSSET_START };
      if (v == null) delete g[k];
      else g[k] = v;
      cfg.members.gusset = g;
    }
    fillForm();
    schedule();
    return;
  }
  if (path.startsWith("members.rocker.")) {
    const k = path.slice(15);
    if (k === "on") cfg.members.rocker = v === "1" ? { ...ROCKER_START } : null;
    else {
      const r = { ...(cfg.members.rocker || ROCKER_START) };
      if (v == null) delete r[k];
      else r[k] = v;
      cfg.members.rocker = r;
    }
    fillForm();
    schedule();
    return;
  }
  const blk = path.startsWith("wheel.caliper.") ? "caliper" : path.startsWith("halfshaft.") ? "halfshaft" : null;
  if (blk && v == null && !path.endsWith("plunge_max")) {
    if (blk === "caliper") cfg.wheel.caliper = null;
    else cfg.halfshaft = null;
    fillForm();
    schedule();
    return;
  }
  if (blk === "caliper" && !cfg.wheel.caliper) cfg.wheel.caliper = { clock_deg: 135, radius: 100, size: 55, offset: -15 };
  if (blk === "halfshaft" && !cfg.halfshaft) {
    const cp = cfg.hardpoints.contact_patch,
      R = cfg.wheel.tire_radius;
    cfg.halfshaft = { diff_output: [cp[0], 150, R], cv_outboard: [cp[0], cp[1] - 60, R] };
  }
  const fp = framePath(path);
  if (fp && !frameIsDefault() && v != null) {
    // a coordinate typed in the shown frame: change that one shown axis and store the point back in the solver frame
    const base = getPath(cfg, fp.base);
    if (Array.isArray(base) && base.length === 3) {
      const d = fp.kind === "pt" ? dispPt(base, cfg.axle) : dispDir(base);
      d[fp.j] = v;
      setPath(
        cfg,
        fp.base,
        (fp.kind === "pt" ? undispPt(d, cfg.axle) : undispDir(d)).map(q => +q.toFixed(9))
      );
      if (blk) fillForm();
      if (path === "axle") syncAxle();
      schedule();
      return;
    }
  }
  setPath(cfg, path, v);
  if (blk) fillForm();
  if (path === "axle") syncAxle();
  if (path === "spring.rod_on") syncGusset();
  schedule();
}

$("#springOn").addEventListener("change", e => {
  if (e.target.checked) cfg.spring = savedSpring || JSON.parse(JSON.stringify(springTemplate()));
  else {
    savedSpring = cfg.spring;
    cfg.spring = null;
  }
  fillForm();
  schedule();
});
// a starting bar for this axle: a vertical drop link from halfway along the lower wishbone, bar arm 100 mm forward
function arbTemplate() {
  const h = cfg.hardpoints,
    mid = [0, 1, 2].map(i => (h.lower_inboard_front[i] + h.lower_inboard_rear[i]) / 2),
    lo = [0, 1, 2].map(i => +(mid[i] + 0.5 * (h.lower_outboard[i] - mid[i])).toFixed(1));
  lo[0] += 40;
  const tip = [lo[0], lo[1] - 40, lo[2] + 180];
  return {
    link_on: "lower",
    link_outboard: lo,
    arm_tip: tip,
    bar_pivot: [tip[0] + 100, tip[1], tip[2]],
    bar_axis: [0, 1, 0],
    bar_od: 12.7,
    bar_wall: null,
    bar_length: null,
  };
}
let savedArb = null;
$("#arbOn").addEventListener("change", e => {
  pushHistory();
  if (e.target.checked) cfg.arb = savedArb || arbTemplate();
  else {
    savedArb = cfg.arb;
    cfg.arb = null;
  }
  fillForm();
  schedule();
});
$("#rockerOn").addEventListener("change", e => {
  if (!cfg.spring) return;
  const keys = ["rocker_pivot", "rocker_axis", "rocker_rod", "rocker_damper"];
  if (e.target.value === "0") {
    savedRocker = Object.fromEntries(keys.map(k => [k, cfg.spring[k]]));
    keys.forEach(k => (cfg.spring[k] = null));
  } else {
    const src = savedRocker || springTemplate();
    keys.forEach(k => (cfg.spring[k] = JSON.parse(JSON.stringify(src[k]))));
  }
  fillForm();
  schedule();
});
