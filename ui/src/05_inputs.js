// 05_inputs.js - The input forms: hardpoint and spring tables, fields, filling them from the config and reading edits back.
// ------------------------------------------------------------------ input builders
// input-table names for the points (schema/points.json): [label, hint]
const HP_LABELS = Object.fromEntries(S.SCHEMA.points.hardpoints.map(p => [p.key, [p.label, p.hint]]));
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
        `<tr data-row="${attr(k)}"><td class="lab"${labels[k][1] ? ` title="${esc(labels[k][1])}"` : ""}>${k === "rocker_axis" ? labels[k][0] : `<button class="lnk hpbtn" type="button" data-hp="${prefix}.${k}" title="${labels[k][1] ? esc(labels[k][1]) + " · " : ""}click: what does moving this point do?">${labels[k][0]}</button>`}</td>` +
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
  ].join("");
  $("#simFields").innerHTML = [
    field("Vertical travel ±", "mm", "sweep.travel", { step: 1 }),
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
  $("#compFields").innerHTML = [
    field("Rod-end stiffness (each)", "N/mm", "members.rod_end_k", { step: 1000, opt: 1 }),
    field("Chassis tab / bracket stiffness", "N/mm", "members.mount_k", { step: 1000, opt: 1 }),
    field("Toe change limit", "deg", "members.toe_comp_limit", { step: 0.01, opt: 1 }),
    field("Camber change limit", "deg", "members.camber_comp_limit", { step: 0.01, opt: 1 }),
  ].join("");
  $("#clrFields").innerHTML = [
    field("Wishbone tube OD", "mm", "clearance.wishbone_tube_od"),
    field("Tie rod OD", "mm", "clearance.tie_rod_od"),
    field("Pushrod OD", "mm", "clearance.pushrod_od"),
    field("Damper body OD", "mm", "clearance.damper_od"),
    field("Extra margin", "mm", "clearance.margin"),
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
    if (path.startsWith("spring.") && !cfg.spring) {
      const v = getPath({ spring: savedSpring || S.DEFAULTS.spring || {} }, path);
      el.value = v == null ? "" : v;
      return;
    }
    let v = getPath(cfg, path);
    if (v == null) v = getPath(S.DEFAULTS, path);
    if (el.dataset.scale && v != null) v = +(v * +el.dataset.scale).toFixed(6);
    el.value = v == null ? "" : v;
  });
  $("#springOn").checked = !!cfg.spring;
  $("#springBody").hidden = !cfg.spring;
  $("#rockerOn").value = cfg.spring && cfg.spring.rocker_pivot == null ? "0" : "1";
  syncRockerRows();
  syncAxle();
  syncLegLabels();
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
  setPath(cfg, path, v);
  if (path === "axle") syncAxle();
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
