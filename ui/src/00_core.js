"use strict";
const S = window.Susp, V = S.vec;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (v, d = 1) => (v == null || Number.isNaN(v)) ? "–" : (!Number.isFinite(v) ? "∞" : (+v).toFixed(d).replace(/^-(0\.?0*)$/, "$1").replace("-", "−"));
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// attr(): any value placed inside an HTML attribute (same escaping as esc; one name so every attribute is easy to audit).
// cssq(): a value placed inside a quoted CSS attribute selector.
const attr = esc;
const cssq = (s) => String(s).replace(/["\\]/g, "\\$&");

const HELP = {
  camber: "Wheel lean at ride height. Negative = top leans in. Set by shims, so it is easy to adjust later.",
  camber_gain: "Camber change per inch of bump. Shorter front-view swing arm = more gain.",
  caster: "Kingpin tilt seen from the side. More caster = more self-centring and steering camber, heavier steering.",
  kpi: "Kingpin inclination seen from the front. Drives scrub radius and steering jacking.",
  scrub: "Steering axis ground point to contact patch, sideways. Large = kickback and heavy steering.",
  trail: "Steering axis ground point to contact patch, fore-aft. Gives self-centring torque.",
  toe: "Static toe, + = toe-in. Set by tie-rod length.",
  roll_center: "Roll center height at ride height. Higher = more load transfer through links, less body roll.",
  antidive: "Share of braking weight transfer taken by the links at the front. Negative = pro-dive.",
  antisquat: "Share of acceleration weight transfer taken by the links at the rear.",
  ackermann: "0 % = parallel steer, 100 % = full Ackermann, negative = anti-Ackermann.",
  bump_steer: "Toe change per inch of bump. Fix the slope with tie-rod height.",
  bump_steer_max: "Largest toe change anywhere in the travel. Catches U-shaped toe curves (fix those with tie-rod length).",
  ride_freq: "Natural frequency of the sprung corner on spring and tire. FSAE cars often run 2.5–4.5 Hz.",
  damper_margin: "Damper stroke left over after the full wheel travel.",
  damper_topout: "Room before the damper fully extends at full droop.",
  damper_bottomout: "Room before the damper fully compresses at full bump.",
  trans_min: "Angle between pushrod or damper and the rocker arm it drives, worst over travel. 90° is best; under 45° the rocker nears a toggle.",
  link_clearance: "Tightest center-line gap between moving links over travel and steer, against tube radii plus margin.",
  rim_margin: "Gap from the farthest outboard joint to the rim radius (radial check only).",
};

// ------------------------------------------------------------------ state
let cfg = null, ev = null, loads = null, err = null, base = null, baseName = "";
let pose = { dz: 0, rack: 0 }, savedSpring = null, savedRocker = null, tab = "checks";
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } } };

function getPath(o, path) { return path.split(".").reduce((a, k) => a == null ? a : a[k], o); }
function setPath(o, path, v) {
  const ks = path.split("."); let a = o;
  for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null) a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[ks[i]]; }
  a[ks[ks.length - 1]] = v;
}

// ------------------------------------------------------------------ input builders
const HP_LABELS = {
  upper_inboard_front: ["Upper inboard front", "smaller-X pivot"], upper_inboard_rear: ["Upper inboard rear", "larger-X pivot"],
  lower_inboard_front: ["Lower inboard front", "smaller-X pivot"], lower_inboard_rear: ["Lower inboard rear", "larger-X pivot"],
  upper_outboard: ["Upper outboard", "upper ball joint"], lower_outboard: ["Lower outboard", "lower ball joint"],
  trackrod_inboard: ["Trackrod inboard", "rack end"], trackrod_outboard: ["Trackrod outboard", "steering arm"],
  contact_patch: ["Tire contact patch", "ground, Z = 0"] };
const SP_LABELS = { rod_outboard: ["Pushrod outboard", "on the arm / upright"], rocker_pivot: ["Rocker pivot", "chassis"],
  rocker_axis: ["Rocker axis", "pivot bolt direction"], rocker_rod: ["Rocker – pushrod point", ""],
  rocker_damper: ["Rocker – damper point", ""], damper_chassis: ["Damper chassis mount", ""] };

function numInput(path, opts = {}) {
  const id = "in_" + path.replace(/\./g, "_");
  return `<input class="num" id="${attr(id)}" type="number" step="${attr(opts.step ?? "any")}" inputmode="decimal" data-path="${attr(path)}" data-type="${attr(opts.type ?? "num")}"${opts.scale ? ` data-scale="${attr(opts.scale)}"` : ""}${opts.opt ? " data-opt=\"1\"" : ""} aria-label="${esc(opts.aria ?? path)}">`;
}
function field(label, unit, path, opts = {}) {
  const id = "in_" + path.replace(/\./g, "_");
  if (opts.options) return `<div class="field"><label for="${attr(id)}">${label}</label><select id="${attr(id)}" data-path="${attr(path)}" data-type="select">${opts.options.map(([v, t]) => `<option value="${attr(v)}">${t}</option>`).join("")}</select></div>`;
  return `<div class="field"><label for="${attr(id)}">${label} <i>${unit}</i></label>${numInput(path, { ...opts, aria: label })}</div>`;
}
function ptRows(tbody, list, prefix, labels) {
  tbody.innerHTML = list.map(k => `<tr data-row="${attr(k)}"><td class="lab"${labels[k][1] ? ` title="${esc(labels[k][1])}"` : ""}>${k === "rocker_axis" ? labels[k][0] : `<button class="lnk hpbtn" type="button" data-hp="${prefix}.${k}" title="${labels[k][1] ? esc(labels[k][1]) + " · " : ""}click: what does moving this point do?">${labels[k][0]}</button>`}</td>` +
    [0, 1, 2].map(i => `<td class="c">${numInput(`${prefix}.${k}.${i}`, { aria: `${labels[k][0]} ${"XYZ"[i]}`, step: k === "rocker_axis" ? "0.1" : "0.1" })}</td>`).join("") + "</tr>").join("");
}
function buildForm() {
  ptRows($("#hpTable tbody"), S.HP_ORDER, "hardpoints", HP_LABELS);
  ptRows($("#spTable tbody"), S.SPRING_POINTS, "spring", SP_LABELS);
  $("#wheelFields").innerHTML = [field("Camber", "deg", "wheel.camber_deg", { step: 0.1 }), field("Toe (+ in)", "deg", "wheel.toe_deg", { step: 0.01 }),
    field("Rim diameter", "in", "wheel.rim_diameter_in"), field("Tire width", "mm", "wheel.tire_width"), field("Tire radius", "mm", "wheel.tire_radius")].join("");
  $("#vehFields").innerHTML = [field("Axle", "", "axle", { options: [["front", "Front axle"], ["rear", "Rear axle"]] }),
    field("Brake balance (front)", "%", "vehicle.front_brake_share", { scale: 100, step: 1 }), field("Wheelbase", "mm", "vehicle.wheelbase"),
    field("CG height", "mm", "vehicle.cg_height"), field("Car mass with driver", "kg", "vehicle.mass"),
    field("Weight on front", "%", "vehicle.weight_front", { scale: 100, step: 0.5 }),
    field("Brakes", "", "vehicle.brakes", { options: [["outboard", "Outboard (at upright)"], ["inboard", "Inboard (on chassis)"]] }),
    field("Drive", "", "vehicle.drive", { options: [["inboard", "Inboard diff / halfshafts"], ["outboard", "Outboard (hub motor)"]] })].join("");
  $("#simFields").innerHTML = [field("Vertical travel ±", "mm", "sweep.travel", { step: 1 }), field("Rack travel ±", "mm", "sweep.rack_travel", { step: 1 }),
    field("Body roll ±", "deg", "sweep.roll_deg", { step: 0.25 }), field("Ackermann at outer wheel", "deg", "sweep.ackermann_at_outer_deg", { step: 1 })].join("");
  $("#spFields").innerHTML = [field("Spring rate", "N/mm", "spring.spring_rate", { step: 1 }), field("Target ride freq", "Hz", "spring.target_freq_hz", { step: 0.1, opt: 1 }),
    field("Damper eye-to-eye (extended)", "mm", "spring.damper_eye_to_eye", { opt: 1 }), field("Damper stroke", "mm", "spring.damper_stroke", { opt: 1 }),
    field("Unsprung mass / corner", "kg", "spring.unsprung_mass", { step: 0.5 }), field("Tire vertical rate", "N/mm", "spring.tire_rate", { step: 5 })].join("");
  $("#dampFields").innerHTML = [field("Bump, low-speed", "N s/m", "spring.damper_bump_low", { step: 50, opt: 1 }), field("Rebound, low-speed", "N s/m", "spring.damper_rebound_low", { step: 50, opt: 1 }),
    field("Bump, high-speed", "N s/m", "spring.damper_bump_high", { step: 50, opt: 1 }), field("Rebound, high-speed", "N s/m", "spring.damper_rebound_high", { step: 50, opt: 1 }),
    field("Knee (low → high speed)", "mm/s", "spring.damper_knee", { step: 5 }), field("Target damping ratio, low-speed", "", "spring.target_zeta_low", { step: 0.05 }),
    field("Target damping ratio, high-speed", "", "spring.target_zeta_high", { step: 0.05 })].join("");
  $("#loadFields").innerHTML = [field("Bump", "g", "loads.bump_g", { step: 0.1 }), field("Cornering", "g", "loads.corner_g", { step: 0.1 }),
    field("Braking", "g", "loads.brake_g", { step: 0.1 }), field("Brake + corner", "g", "loads.combined_g", { step: 0.1 }),
    field("Acceleration (rear)", "g", "loads.accel_g", { step: 0.1 }), field("Pothole impact (vertical)", "g", "loads.pothole_g", { step: 0.5, opt: 1 }),
    field("Kerb strike (sideways)", "g", "loads.kerb_g", { step: 0.5, opt: 1 }),
    field("Braking force split", "", "loads.brake_split", { options: [["bias", "By brake bias (front share)"], ["grip", "Same grip use at every tire"]] }),
    field("Front LLTD override", "", "loads.lltd_front", { step: 0.01, opt: 1 })].join("");
  $("#tubeFields").innerHTML = [field("Wishbone OD", "mm", "members.wishbone.0"), field("Wishbone wall", "mm", "members.wishbone.1"),
    field("Tie rod OD", "mm", "members.tie_rod.0"), field("Tie rod wall", "mm", "members.tie_rod.1"),
    field("Pushrod OD", "mm", "members.pushrod.0"), field("Pushrod wall", "mm", "members.pushrod.1")].join("");
  $("#matFields").innerHTML = [field("Young's modulus E", "MPa", "members.E", { step: 1000 }), field("Yield strength", "MPa", "members.yield", { step: 5 }),
    field("Required FOS", "", "members.sf_target", { step: 0.1 })].join("");
  $("#partFields").innerHTML = [field("Rod-end rating (catalog)", "N", "members.rod_end_rating", { step: 500, opt: 1 }), field("Bolt diameter", "mm", "members.bolt_dia", { step: 0.1 }),
    field("Bolt grade", "", "members.bolt_grade", { options: [["SAE 8", "SAE grade 8"], ["SAE 5", "SAE grade 5"], ["8.8", "Metric 8.8"], ["10.9", "Metric 10.9"], ["12.9", "Metric 12.9"]] }),
    field("Bolt shear", "", "members.bolt_shear_planes", { options: [["2", "Double shear (clevis)"], ["1", "Single shear"]] })].join("");
  $("#compFields").innerHTML = [field("Rod-end stiffness (each)", "N/mm", "members.rod_end_k", { step: 1000, opt: 1 }), field("Chassis tab / bracket stiffness", "N/mm", "members.mount_k", { step: 1000, opt: 1 }),
    field("Toe change limit", "deg", "members.toe_comp_limit", { step: 0.01, opt: 1 }), field("Camber change limit", "deg", "members.camber_comp_limit", { step: 0.01, opt: 1 })].join("");
  $("#clrFields").innerHTML = [field("Wishbone tube OD", "mm", "clearance.wishbone_tube_od"), field("Tie rod OD", "mm", "clearance.tie_rod_od"),
    field("Pushrod OD", "mm", "clearance.pushrod_od"), field("Damper body OD", "mm", "clearance.damper_od"), field("Extra margin", "mm", "clearance.margin")].join("");
  $$("[data-path]").forEach(el => el.addEventListener(el.tagName === "SELECT" ? "change" : "input", onInput));
  $("#in_axle").closest(".field").hidden = true;      // the axle is set by the Front / Rear slot
  $$("[data-hp]").forEach(b => b.addEventListener("click", () => { if (!ev || err) return; openInfluence(b.dataset.hp);
    const vr = $("#vwrap").getBoundingClientRect(); if (vr.bottom < 80 || vr.top > window.innerHeight - 120) $("#vwrap").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }); }));
}

// label the four inboard pivots by where they physically are (larger X = front), whatever their KineSolver key says
function syncLegLabels() {
  const hp = cfg && cfg.hardpoints; if (!hp) return;
  for (const arm of ["upper", "lower"]) {
    const a = hp[`${arm}_inboard_front`], b = hp[`${arm}_inboard_rear`]; if (!a || !b) continue;
    const aFront = a[0] >= b[0];
    for (const [key, isFront] of [[`${arm}_inboard_front`, aFront], [`${arm}_inboard_rear`, !aFront]]) {
      const btn = $(`#hpTable [data-hp="hardpoints.${key}"]`); if (!btn) continue;
      btn.textContent = `${arm === "upper" ? "Upper" : "Lower"} ${isFront ? "front" : "rear"} pivot`;
      btn.dataset.leg = isFront ? "front" : "rear";
      btn.title = `JSON key: ${key} (KineSolver "${key.endsWith("front") ? "front" : "rear"}" = ${key.endsWith("front") ? "smaller" : "larger"} X) · click: what does moving this point do?`;
    }
  }
}
function fillForm() {
  $$("[data-path]").forEach(el => {
    const path = el.dataset.path;
    if (path.startsWith("spring.") && !cfg.spring) { const v = getPath({ spring: savedSpring || S.DEFAULTS.spring || {} }, path); el.value = v == null ? "" : v; return; }
    let v = getPath(cfg, path);
    if (v == null) v = getPath(S.DEFAULTS, path);
    if (el.dataset.scale && v != null) v = +(v * +el.dataset.scale).toFixed(6);
    el.value = v == null ? "" : v;
  });
  $("#springOn").checked = !!cfg.spring;
  $("#springBody").hidden = !cfg.spring;
  $("#rockerOn").value = cfg.spring && cfg.spring.rocker_pivot == null ? "0" : "1";
  syncRockerRows();
  syncAxle(); syncLegLabels();
}
function syncRockerRows() {
  const direct = cfg.spring && cfg.spring.rocker_pivot == null;
  ["rocker_pivot", "rocker_axis", "rocker_rod", "rocker_damper"].forEach(k => { const r = $(`#spTable tr[data-row="${cssq(k)}"]`); if (r) r.hidden = !!direct; });
}
function syncAxle() {
  const rear = cfg.axle === "rear";
  $("#poseR").disabled = rear; $("#poseRo").disabled = rear; $("#poseR0").disabled = rear;
  $("#in_vehicle_drive").closest(".field").hidden = !rear;
  $("#in_sweep_rack_travel").closest(".field").hidden = rear;
  $("#in_sweep_ackermann_at_outer_deg").closest(".field").hidden = rear;
  $("#in_loads_accel_g").closest(".field").hidden = !rear;
  $("#springHint").textContent = cfg.spring ? (cfg.spring.rocker_pivot == null ? "direct-acting" : "rocker") : "off";
}

function onInput(e) {
  const el = e.target, path = el.dataset.path;
  let v;
  if (el.dataset.type === "select" || el.dataset.type === "text") v = el.value;
  else {
    if (el.value === "") { if (el.dataset.opt) v = null; else return; }
    else { v = +el.value; if (!Number.isFinite(v)) return; if (el.dataset.scale) v /= +el.dataset.scale; }
  }
  if (path.startsWith("spring.") && !cfg.spring) return;
  setPath(cfg, path, v);
  if (path === "axle") syncAxle();
  schedule();
}

$("#springOn").addEventListener("change", (e) => {
  if (e.target.checked) cfg.spring = savedSpring || JSON.parse(JSON.stringify(springTemplate()));
  else { savedSpring = cfg.spring; cfg.spring = null; }
  fillForm(); schedule();
});
$("#rockerOn").addEventListener("change", (e) => {
  if (!cfg.spring) return;
  const keys = ["rocker_pivot", "rocker_axis", "rocker_rod", "rocker_damper"];
  if (e.target.value === "0") { savedRocker = Object.fromEntries(keys.map(k => [k, cfg.spring[k]])); keys.forEach(k => cfg.spring[k] = null); }
  else { const src = savedRocker || springTemplate(); keys.forEach(k => cfg.spring[k] = JSON.parse(JSON.stringify(src[k]))); }
  fillForm(); schedule();
});

// ------------------------------------------------------------------ run
let timer = null;
function schedule() { clearTimeout(timer); timer = setTimeout(run, 160); }
function run() {
  const t0 = performance.now();
  syncCar();
  try {
    ev = S.evaluate(cfg);
    loads = ev.spring ? S.runLoads(ev.cfg, ev.susp, ev.spring, carLltdFor(ev)) : null;
    err = null;
  } catch (e) { err = e; console.warn(e); }
  const ms = performance.now() - t0;
  if (!chal) store.set("susp.cfg", JSON.stringify(cfg));
  if (car && !chal) { store.set("susp.car", JSON.stringify(exportCar(true))); carRes = axleView === "car" ? evalCar() : null; }
  $("#jsonBox").value = JSON.stringify(exportCfg(), null, 2);
  const T = cfg.sweep?.travel ?? 30, Rk = cfg.sweep?.rack_travel ?? 35;
  const pz = $("#poseZ"), pr = $("#poseR");
  pz.min = -T; pz.max = T; pr.min = -Rk; pr.max = Rk;
  pose.dz = Math.max(-T, Math.min(T, pose.dz)); pose.rack = cfg.axle === "rear" ? 0 : Math.max(-Rk, Math.min(Rk, pose.rack));
  pz.value = pose.dz; pr.value = pose.rack;
  renderAll(ms); showCurName(); syncLegLabels();
  if (car && axleView === "car" && !chal) { renderCarIn(); renderCarBox(); }
  updateScene();
}
function showCurName() { const el = $("#curName"); if (!el || !cfg) return; el.innerHTML = chal ? `Challenge: <b>${esc(chal.def.title)}</b>` : car && axleView === "car" ? `<b>${esc(car.name || "Car")}</b>` : `${cfg.axle === "rear" ? "Rear" : "Front"}: <b>${esc(cfg.name || "untitled")}</b>`; }
const exportCurrent = () => (car && axleView === "car" && !chal) ? exportCar() : exportCfg();
function exportCfg() {
  const keys = ["name", "axle", "targets_file", "hardpoints", "wheel", "vehicle", "sweep", "clearance", "rack_direction", "targets", "spring", "loads", "members"];
  const o = {}; for (const k of keys) if (cfg[k] != null) o[k] = cfg[k];
  return o;
}

// ------------------------------------------------------------------ charts
function niceTicks(lo, hi, n = 5) {
  if (!(hi > lo)) { const c = Number.isFinite(lo) ? lo : 0, d = Math.abs(c) * 0.05 || 1; lo = c - d; hi = c + d; }
  const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0)), r = step0 / mag;
  const step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
  const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, t = [];
  for (let v = a; v <= b + step * 1e-6; v += step) t.push(+v.toFixed(10));
  return { lo: a, hi: b, ticks: t, step };
}
function tickLabel(v, step) { const d = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step))); return fmt(v, d); }
function chart({ title, cap = "", series, xlabel = "", marker = null, band = null, h = 170 }) {
  const W = 320, H = h, l = 46, r = 10, t = 10, b = 30;
  const pts = series.flatMap(s => s.x.map((x, i) => [x, s.y[i]])).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!pts.length) return `<div class="chart"><h3>${esc(title)}</h3><p class="cap">No data.</p></div>`;
  let ylo = Math.min(...pts.map(p => p[1])), yhi = Math.max(...pts.map(p => p[1]));
  if (band) { if (band[0] != null) ylo = Math.min(ylo, band[0]); if (band[1] != null) yhi = Math.max(yhi, band[1]); }
  const pad = (yhi - ylo) * 0.08; const yt = niceTicks(ylo - pad, yhi + pad, 4);
  const xlo = Math.min(...pts.map(p => p[0])), xhi = Math.max(...pts.map(p => p[0])), xt = niceTicks(xlo, xhi, 5);
  const X = (x) => l + (x - xt.lo) / (xt.hi - xt.lo) * (W - l - r), Y = (y) => H - b - (y - yt.lo) / (yt.hi - yt.lo) * (H - t - b);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">`;
  if (band) {
    const y1 = Y(band[1] ?? yt.hi), y0 = Y(band[0] ?? yt.lo);
    s += `<rect x="${attr(l)}" y="${attr(Math.min(y0, y1))}" width="${attr(W - l - r)}" height="${attr(Math.abs(y0 - y1))}" fill="var(--ok)" opacity=".10"/>`;
  }
  for (const v of yt.ticks) s += `<line x1="${attr(l)}" x2="${attr(W - r)}" y1="${attr(Y(v))}" y2="${attr(Y(v))}" stroke="var(--line)" stroke-width="1"/><text x="${attr(l - 5)}" y="${attr(Y(v) + 3.5)}" font-size="10" text-anchor="end" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${tickLabel(v, yt.step)}</text>`;
  for (const v of xt.ticks) s += `<text x="${attr(X(v))}" y="${attr(H - b + 13)}" font-size="10" text-anchor="middle" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${tickLabel(v, xt.step)}</text>`;
  if (xt.lo < 0 && xt.hi > 0) s += `<line x1="${attr(X(0))}" x2="${attr(X(0))}" y1="${attr(t)}" y2="${attr(H - b)}" stroke="var(--muted)" stroke-width=".7" opacity=".6"/>`;
  s += `<text x="${attr((l + W - r) / 2)}" y="${attr(H - 3)}" font-size="10" text-anchor="middle" fill="var(--muted)">${esc(xlabel)}</text>`;
  series.forEach((sr) => {
    const d = sr.x.map((x, i) => Number.isFinite(sr.y[i]) ? `${X(x).toFixed(1)},${Y(sr.y[i]).toFixed(1)}` : null).filter(Boolean);
    if (d.length) s += `<polyline points="${attr(d.join(" "))}" fill="none" stroke="${attr(sr.color)}" stroke-width="${attr(sr.w ?? 2)}" ${sr.dash ? `stroke-dasharray="${attr(sr.dash)}"` : ""} stroke-linejoin="round"/>`;
  });
  if (marker != null && marker >= xt.lo && marker <= xt.hi) {
    s += `<line x1="${attr(X(marker))}" x2="${attr(X(marker))}" y1="${attr(t)}" y2="${attr(H - b)}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 3"/>`;
    const sr = series[series.length - 1]; const yi = interp(sr.x, sr.y, marker);
    if (Number.isFinite(yi)) s += `<circle cx="${attr(X(marker))}" cy="${attr(Y(yi))}" r="3.5" fill="var(--accent)"/>`;
  }
  const named = series.filter(sr => sr.name);
  if (named.length > 1) named.forEach((sr, i) => {
    s += `<line x1="${attr(l + 6 + i * 92)}" x2="${attr(l + 20 + i * 92)}" y1="${attr(t + 6)}" y2="${attr(t + 6)}" stroke="${attr(sr.color)}" stroke-width="2" ${sr.dash ? `stroke-dasharray="${attr(sr.dash)}"` : ""}/><text x="${attr(l + 24 + i * 92)}" y="${attr(t + 9.5)}" font-size="10" fill="var(--ink)">${esc(sr.name)}</text>`;
  });
  return `<div class="chart"><h3>${esc(title)}</h3>${cap ? `<p class="cap">${cap}</p>` : ""}${s}</svg></div>`;
}
function interp(xs, ys, x) {
  for (let i = 1; i < xs.length; i++) if ((xs[i - 1] - x) * (xs[i] - x) <= 0) { const f = (x - xs[i - 1]) / ((xs[i] - xs[i - 1]) || 1); return ys[i - 1] + f * (ys[i] - ys[i - 1]); }
  return NaN;
}

// ------------------------------------------------------------------ results
const MOTION = ["heave", "roll", "steer"];
let lastMotion = "heave";
const TAB_BAR = [["checks", "Targets"], ["motion", "Motion"], ["spring", "Spring & damper"], ["loads", "Loads"], ["pack", "Packaging"], ["compare", "Compare"]];
const TABS = [["checks", "Targets"], ["heave", "Heave"], ["roll", "Roll"], ["steer", "Steering"], ["spring", "Spring & damper"],
  ["loads", "Loads"], ["pack", "Packaging"], ["compare", "Compare"], ["learn", "Learn"]];
function renderTabs() {
  const fails = ev && !err ? ev.checks.filter(c => c.status === "FAIL").length : 0, cur = MOTION.includes(tab) ? "motion" : tab;
  if (MOTION.includes(tab)) lastMotion = tab;
  const bar = TAB_BAR.concat(tab === "learn" ? [["learn", "Learn"]] : []);
  $("#tabs").innerHTML = bar.map(([k, t]) => `<button role="tab" type="button" id="tab_${k}" aria-selected="${attr(cur === k)}" aria-controls="pn_${k === "motion" ? lastMotion : k}" data-tab="${attr(k)}">${t}${k === "checks" && fails ? `<span class="dot" aria-label="${fails} failing"></span>` : ""}</button>`).join("");
  $$("#tabs button").forEach(b => b.addEventListener("click", () => { tab = b.dataset.tab === "motion" ? lastMotion : b.dataset.tab; store.set("susp.tab", tab); renderTabs(); showPanel(); }));
}
function motionSeg(k) {
  const items = [["heave", "Heave"], ["roll", "Roll"]].concat(cfg && cfg.axle === "rear" ? [] : [["steer", "Steering"]]);
  return `<div class="seg msub" role="group" aria-label="Motion">${items.map(([v, t]) => `<button type="button" data-msub="${attr(v)}" aria-pressed="${attr(v === k)}">${t}</button>`).join("")}</div>`;
}
function showPanel() { $$("#panels > .panel").forEach(p => p.hidden = p.dataset.tab !== tab); }

function renderAll(ms) {
  renderTabs();
  syncUndoButtons();
  const P = $("#panels");
  if (err) {
    $("#status").innerHTML = `<span class="pill bad">No solution</span>`;
    $("#errBox").innerHTML = `<div class="banner bad"><b>The solver could not finish.</b> ${esc(err.message)}</div>`;
    return;
  }
  const issues = S.validate(ev.cfg);
  if (cfg.targets_file && !cfg._team_targets) issues.push(["warn", `This design uses the team targets file "${cfg.targets_file}". The browser can't read files by path: click Open JSON and choose that file to apply your team's target ranges.`]);
  $("#errBox").innerHTML = issues.length ? `<div class="banner ${issues.some(i => i[0] === "error") ? "bad" : "warn"}"><b>Input checks</b><ul>${issues.map(i => `<li>${i[0] === "error" ? "<b>Error:</b> " : ""}${esc(i[1])}</li>`).join("")}</ul></div>` : "";
  const n = ev.checks.filter(c => c.status !== "n/a"), np = n.filter(c => c.status === "PASS").length;
  const m = ev.metrics;
  const minFos = loads ? Math.min(...loads.checks.map(c => Math.min(c.sf_buckle, c.sf_yield))) : null;
  $("#status").innerHTML = `<span class="pill ${np === n.length ? "ok" : "bad"}"><span class="big">${np}/${n.length}</span> targets met</span>` +
    (m.ride_freq != null ? `<span class="pill neutral">Ride ${fmt(m.ride_freq, 2)} Hz</span>` : "") +
    (m.motion_ratio != null ? `<span class="pill neutral">MR ${fmt(m.motion_ratio, 3)}</span>` : "") +
    (minFos != null ? `<span class="pill ${minFos >= ev.cfg.members.sf_target ? "ok" : "bad"}">Min FOS ${fmt(minFos, 2)}</span>` : "") +
    (loads && loads.bending_check ? `<span class="pill ${loads.bending_check.sf >= ev.cfg.members.sf_target ? "ok" : "warn"}" title="The pushrod mount bending the wishbone leg (Loads tab)">Mount bending FOS ${fmt(loads.bending_check.sf, 2)}</span>` : "") +
    (loads && loads.compliance ? (() => { const c = loads.compliance, ok = c.toe_ok && c.camber_ok;
      return `<span class="pill ${ok ? "ok" : "warn"}" title="Toe change from links and mounts flexing, worst cornering / braking case (Loads tab)">Compliance toe ${fmt(c.worst_toe.toe, 2)}°</span>`; })() : "") +
    (base ? `<span class="pill neutral">Baseline: ${esc(baseName)} <button class="btn small" id="btnClearBase" type="button" style="margin-left:4px">Clear</button></span>`
      : `<button class="btn small pinbtn" id="btnBase" type="button" title="Freeze these results; your next edits then show as changes and dashed curves">Pin as baseline</button>`);
  const pb = $("#btnBase"); if (pb) pb.addEventListener("click", () => { if (!ev || err) return; base = ev; baseName = cfg.name || "pinned design"; renderAll(0); });
  const cb = $("#btnClearBase"); if (cb) cb.addEventListener("click", () => { base = null; renderAll(0); });
  P.innerHTML = TABS.map(([k]) => `<div class="panel" role="tabpanel" id="pn_${k}" aria-labelledby="tab_${k}" data-tab="${attr(k)}"></div>`).join("");
  $("#pn_checks").innerHTML = panelChecks();
  $("#pn_heave").innerHTML = motionSeg("heave") + panelHeave();
  $("#pn_roll").innerHTML = motionSeg("roll") + panelRoll();
  $("#pn_steer").innerHTML = motionSeg("steer") + panelSteer();
  $("#pn_spring").innerHTML = panelSpring();
  $("#pn_loads").innerHTML = panelLoads();
  $("#pn_pack").innerHTML = panelPack();
  $("#pn_compare").innerHTML = panelCompare();
  $("#pn_learn").innerHTML = panelLearn();
  wireChecks(); wireLearn(); wireCompare(); updateRail();
  showPanel();
}

function metricLabel(k) { return (S.METRICS[k] || [k, "", 2]); }
const fixRows = new Set();
function checkHelp(key) { const t = TERM_BY_METRIC[key]; return t ? t.def : (HELP[key] || ""); }
function panelChecks() {
  const bm = base ? base.metrics : null, ncol = bm ? 6 : 4;
  let rows = "";
  for (const c of ev.checks) {
    const [lab, unit, dec] = c.label ? [c.label, c.unit, c.dec] : metricLabel(c.key);
    const editable = !c.label, open = openRows.has(c.key);
    const st = c.status === "PASS" ? `<span class="pill ok">Met</span>` : c.status === "FAIL" ? `<span class="pill bad">Not met</span>` : `<span class="pill neutral">n/a</span>`;
    const rng = editable ? `<span class="rng"><input class="num" type="number" step="any" data-tkey="${attr(c.key)}" data-i="0" value="${attr(c.lo == null ? "" : +(+c.lo).toFixed(3))}" aria-label="${esc(lab)} minimum" placeholder="–"> to <input class="num" type="number" step="any" data-tkey="${attr(c.key)}" data-i="1" value="${attr(c.hi == null ? "" : +(+c.hi).toFixed(3))}" aria-label="${esc(lab)} maximum" placeholder="–"></span>`
      : `≥ ${fmt(c.lo, 1)}`;
    let bcol = "";
    if (bm) {
      const bv = c.key === "link_clearance" ? base.metrics.clearance_min : bm[c.key];
      const d = (c.value != null && bv != null) ? c.value - bv : null;
      bcol = `<td class="n">${fmt(bv, dec)}</td><td class="n ${d > 0 ? "delta-up" : d < 0 ? "delta-dn" : ""}">${d == null || Math.abs(d) < 10 ** -(dec + 1) ? "–" : (d > 0 ? "+" : "") + fmt(d, dec)}</td>`;
    }
    const fixBtn = c.status === "n/a" || chal ? "" : `<button class="btn small ${c.status === "FAIL" ? "primary" : ""}" type="button" data-fixgo="${attr(c.key)}">${c.status === "FAIL" ? "Fix: what moves this?" : "What moves this?"}</button>`;
    rows += `<tr class="clickable${open ? " open" : ""}" data-help="${attr(c.key)}" aria-expanded="${attr(open)}"><td><span class="caret" aria-hidden="true">${open ? "▾" : "▸"}</span> ${esc(lab)}</td><td class="n">${fmt(c.value, dec)} <span class="muted">${unit}</span></td><td>${rng}</td>${bcol}<td>${st}</td></tr>`;
    const t = TERM_BY_METRIC[c.key], show = t && t.show;
    rows += `<tr class="help" data-helprow="${attr(c.key)}"${open ? "" : " hidden"}><td colspan="${attr(ncol)}">
      <p class="hdef">${esc(checkHelp(c.key))}</p>
      <div class="tact">${show ? `<button class="btn small" type="button" data-show="${attr(show)}">Show me</button>` : ""}${t ? `<button class="lnk" type="button" data-term="${attr(t.id)}">More in Learn</button>` : ""}${fixBtn}</div>
      <div class="fixbox" data-fixbox="${attr(c.key)}"></div></td></tr>`;
  }
  return `<div class="tbl-wrap"><table class="data"><thead><tr><th>Target</th><th class="n">Value</th><th>Allowed range</th>${bm ? `<th class="n">Baseline</th><th class="n">Change</th>` : ""}<th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note">Click a row to see what the number means, draw it on the 3D view, or find which hardpoint moves fix it. Edit a range to change the target for this design (saved in the JSON under <span class="mono">targets</span>).</p>`;
}
function wireChecks() {
  $$("#pn_checks tr.clickable").forEach(tr => tr.addEventListener("click", (e) => {
    if (e.target.tagName === "INPUT") return;
    const k = tr.dataset.help, h = $(`#pn_checks tr[data-helprow="${cssq(k)}"]`); if (!h) return;
    h.hidden = !h.hidden; if (h.hidden) { openRows.delete(k); fixRows.delete(k); } else openRows.add(k);
    tr.classList.toggle("open", !h.hidden); tr.setAttribute("aria-expanded", String(!h.hidden)); $(".caret", tr).textContent = h.hidden ? "▸" : "▾";
  }));
  $$("#pn_checks input[data-tkey]").forEach(inp => inp.addEventListener("change", () => {
    const k = inp.dataset.tkey, cur = S.defaultTargets(ev.cfg)[k] || [null, null];
    const v = inp.value === "" ? null : +inp.value; const nv = cur.slice(); nv[+inp.dataset.i] = v;
    cfg.targets = cfg.targets || {}; cfg.targets[k] = nv; schedule();
  }));
  $$("#pn_checks [data-show]").forEach(b => b.addEventListener("click", () => showMe(b.dataset.show)));
  $$("#pn_checks [data-term]").forEach(b => b.addEventListener("click", () => openTerm(b.dataset.term)));
  $$("#pn_checks [data-fixgo]").forEach(b => b.addEventListener("click", () => { const k = b.dataset.fixgo; fixRows.add(k); b.hidden = true; whatMoves(k, $(`#pn_checks [data-fixbox="${cssq(k)}"]`)); }));
  // keep "What moves this?" results open across re-solves
  for (const k of fixRows) { const box = $(`#pn_checks [data-fixbox="${cssq(k)}"]`); if (box && ev.checks.some(c => c.key === k && c.status !== "n/a")) { const b = $(`#pn_checks [data-fixgo="${cssq(k)}"]`); if (b) b.hidden = true; whatMoves(k, box); } else fixRows.delete(k); }
}

const C = { s1: "var(--s1)", s2: "var(--s2)", s3: "var(--s3)", base: "var(--base)" };
function panelHeave() {
  const rows = ev.rows, br = base ? base.rows : null, m = ev.metrics, T = ev.cfg.sweep.travel;
  const r0 = (rs) => rs.reduce((a, r) => Math.abs(r.dz) < Math.abs(a.dz) ? r : a);
  const toe0 = r0(rows).toe, cpy0 = r0(rows).cp_y, btoe0 = br ? r0(br).toe : 0, bcpy0 = br ? r0(br).cp_y : 0;
  const nm = !!br;
  const mk = (title, cap, get, bget) => chart({ title, cap, xlabel: "wheel travel, mm (+ bump)", marker: pose.dz,
    series: [...(br ? [{ name: nm ? "baseline" : null, x: br.map(r => r.dz), y: br.map(bget || get), color: C.base, dash: "4 3", w: 1.5 }] : []),
      { name: nm ? "current" : null, x: rows.map(r => r.dz), y: rows.map(get), color: C.s1 }] });
  const anti = ev.cfg.axle === "front" ? mk("Anti-dive, %", `${fmt(m.antidive, 1)} % at ride height`, r => r.antidive)
    : chart({ title: "Anti-squat / anti-lift, %", cap: `${fmt(m.antisquat, 1)} / ${fmt(m.antilift, 1)} % at ride height`, xlabel: "wheel travel, mm", marker: pose.dz,
      series: [{ name: "anti-squat", x: rows.map(r => r.dz), y: rows.map(r => r.antisquat), color: C.s1 }, { name: "anti-lift", x: rows.map(r => r.dz), y: rows.map(r => r.antilift), color: C.s2, dash: "5 3" }] });
  return `<div class="kv">
    <div><span>Camber gain</span><b>${fmt(m.camber_gain, 3)} <small>deg/in</small></b></div>
    <div><span>Bump steer slope</span><b>${fmt(m.bump_steer, 3)} <small>deg/in</small></b></div>
    <div><span>Max toe change</span><b>${fmt(m.bump_steer_max, 3)} <small>deg</small></b></div>
    <div><span>Front-view swing arm</span><b>${fmt(m.fvsa, 0)} <small>mm</small></b></div>
    <div><span>Roll center range</span><b>${fmt(m.rc_min, 0)}…${fmt(m.rc_max, 0)} <small>mm</small></b></div>
    <div><span>Track change</span><b>${fmt(m.track_change, 2)} <small>mm</small></b></div></div>
  <div class="charts">
    ${mk("Camber, deg", `gain ${fmt(m.camber_gain, 3)} deg/in`, r => r.camber)}
    ${mk("Toe change, deg (+ in)", `max ${fmt(m.bump_steer_max, 3)} deg over ±${T} mm`, r => r.toe - toe0, r => r.toe - btoe0)}
    ${mk("Roll center height, mm", "above ground", r => r.roll_center)}
    ${mk("Caster, deg", "", r => r.caster)}
    ${mk("KPI, deg", "", r => r.kpi)}
    ${mk("Scrub radius, mm", "", r => r.scrub)}
    ${mk("Mechanical trail, mm", "from the current contact patch", r => r.trail)}
    ${anti}
    ${mk("Contact patch sideways shift, mm", `total ${fmt(m.track_change, 2)} mm`, r => r.cp_y - cpy0, r => r.cp_y - bcpy0)}
  </div>`;
}
function panelRoll() {
  const R = ev.roll, m = ev.metrics, bR = base ? base.roll : null;
  const x = R.map(r => r.roll);
  const bser = (get) => bR ? [{ name: "baseline", x: bR.map(r => r.roll), y: bR.map(get), color: C.base, dash: "4 3", w: 1.5 }] : [];
  return `<div class="kv">
    <div><span>Roll camber (outer, to ground)</span><b>${fmt(m.roll_camber, 3)} <small>deg/deg</small></b></div>
    <div><span>Outer camber at ${fmt(m.roll_max_deg, 1)}° roll</span><b>${fmt(m.roll_camber_max, 2)} <small>deg</small></b></div>
    <div><span>Roll center sideways shift</span><b>${fmt(m.rc_lat, 1)} <small>mm/deg</small></b></div>
    <div><span>Roll center height at max roll</span><b>${fmt(m.rc_height_roll, 1)} <small>mm</small></b></div>
    <div><span>Roll steer (outer)</span><b>${fmt(m.roll_steer, 3)} <small>deg/deg</small></b></div></div>
  <div class="charts">
    ${chart({ title: "Camber to ground, deg", cap: "1.0 deg/deg roll camber = wheel leans with the body", xlabel: "body roll, deg (+ right wheel outer)",
      series: [...bser(r => r.camber_outer), { name: "outer", x, y: R.map(r => r.camber_outer), color: C.s1 }, { name: "inner", x, y: R.map(r => r.camber_inner), color: C.s2, dash: "5 3" }] })}
    ${chart({ title: "Roll center height, mm", cap: "kinematic, above the ground line", xlabel: "body roll, deg",
      series: [...bser(r => r.rc_height), { name: bR ? "current" : null, x, y: R.map(r => r.rc_height), color: C.s1 }] })}
    ${chart({ title: "Roll center sideways position, mm", cap: "+ = toward the outer wheel", xlabel: "body roll, deg",
      series: [...bser(r => r.rc_lateral), { name: bR ? "current" : null, x, y: R.map(r => r.rc_lateral), color: C.s1 }] })}
  </div>
  <p class="note">Roll is modeled as equal and opposite wheel travel with the left wheel mirrored. The force-based roll center moves once the tires are loaded unevenly.</p>`;
}
function panelSteer() {
  if (!ev.steer) return `<p class="note">Steering applies to the front axle. On the rear axle the toe link is fixed, so there is no steering sweep.</p>`;
  const st = ev.steer, m = ev.metrics, x = st.map(r => r.rack);
  const r25i = S.rackForAngle(st, "inner", 25), r25o = S.rackForAngle(st, "outer", 25);
  const ack = st.filter(r => Number.isFinite(r.ackermann));
  const cf = ev.cfg.vehicle.rack_c_factor;
  return `<div class="kv">
    <div><span>Ackermann at ${fmt(ev.cfg.sweep.ackermann_at_outer_deg, 0)}° outer</span><b>${fmt(m.ackermann, 0)} <small>%</small></b></div>
    <div><span>Turning radius, outer wheel</span><b>${fmt(m.turn_radius, 2)} <small>m</small></b></div>
    <div><span>Inner / outer at full rack</span><b>${fmt(st[st.length - 1].inner, 1)} / ${fmt(st[st.length - 1].outer, 1)} <small>deg</small></b></div>
    <div><span>Rack for 25° inner</span><b>${r25i == null ? "> range" : fmt(r25i, 1)} <small>${r25i == null ? "" : "mm"}</small></b></div>
    <div><span>Rack for 25° outer</span><b>${r25o == null ? "> range" : fmt(r25o, 1)} <small>${r25o == null ? "" : "mm"}</small></b></div>
    <div><span>Steering arm</span><b>${fmt(m.steer_arm, 1)} <small>mm</small></b></div>
    ${cf ? `<div><span>Steering wheel, center to lock</span><b>${fmt(ev.cfg.sweep.rack_travel / cf * 360, 0)} <small>deg</small></b></div>` : ""}</div>
  <div class="charts">
    ${chart({ title: "Wheel steer angle, deg", xlabel: "rack travel, mm", marker: Math.abs(pose.rack),
      series: [{ name: "inner", x, y: st.map(r => r.inner), color: C.s1 }, { name: "outer", x, y: st.map(r => r.outer), color: C.s2, dash: "5 3" }] })}
    ${chart({ title: "Ackermann, %", cap: "target band shaded", xlabel: "outer wheel angle, deg", band: S.defaultTargets(ev.cfg).ackermann,
      series: [{ x: ack.map(r => r.outer), y: ack.map(r => r.ackermann), color: C.s1 }] })}
    ${chart({ title: "Camber while steering, deg", xlabel: "rack travel, mm",
      series: [{ name: "inner", x, y: st.map(r => r.camber_inner), color: C.s1 }, { name: "outer", x, y: st.map(r => r.camber_outer), color: C.s2, dash: "5 3" }] })}
  </div>
  <p class="note">Turning radius is the outer front wheel's path at full rack, with no tire slip. Compare its diameter with the tightest hairpin in the current FSAE rules.</p>`;
}
function rockerSvg() {
  const sp = ev.spring, rows = ev.rows;
  if (!sp) return "";
  let k = sp.direct ? [1, 0, 0] : sp.k.slice(), c = sp.direct ? sp.dch : sp.c;
  let v = V.sub([0, 0, 1], V.mul(k, k[2])); if (V.norm(v) < 1e-6) v = V.sub([0, 1, 0], V.mul(k, k[1])); v = V.unit(v);
  let u = V.cross(v, k); if (u[1] < 0) { u = V.mul(u, -1); k = V.mul(k, -1); }
  const P = (q) => [V.dot(V.sub(q, c), u), V.dot(V.sub(q, c), v)];
  const picks = [[0, "full droop", "2 3"], [Math.floor(rows.length / 2), "ride height", ""], [rows.length - 1, "full bump", "6 3"]];
  const sts = picks.map(([i]) => rows[i]._spring);
  const allp = sts.flatMap(st => [P(st.rod_in), P(st.damper_out)]).concat([P(sp.dch), [0, 0]]);
  const xs = allp.map(p => p[0]), ys = allp.map(p => p[1]);
  const pad = 45, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const W = x1 - x0, H = y1 - y0, X = (p) => (p[0] - x0).toFixed(1), Y = (p) => (y1 - p[1]).toFixed(1);
  let s = `<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="Rocker at droop, ride height and bump" style="max-height:340px;min-height:220px">`;
  picks.forEach(([, lab, dash], j) => {
    const st = sts[j], ro = P(st.rod_out), ri = P(st.rod_in), dout = P(st.damper_out), dc = P(sp.dch);
    s += `<line x1="${attr(X(ri))}" y1="${attr(Y(ri))}" x2="${attr(X(ro))}" y2="${attr(Y(ro))}" stroke="var(--bad)" stroke-width="2.5" ${dash ? `stroke-dasharray="${attr(dash)}"` : ""}/>`;
    s += `<line x1="${attr(X(dout))}" y1="${attr(Y(dout))}" x2="${attr(X(dc))}" y2="${attr(Y(dc))}" stroke="var(--s3)" stroke-width="${attr(j === 1 ? 7 : 4)}" opacity="${attr(j === 1 ? .7 : .45)}" ${dash ? `stroke-dasharray="${attr(dash)}"` : ""}/>`;
    if (!sp.direct) s += `<polygon points="${X([0, 0])},${Y([0, 0])} ${X(ri)},${Y(ri)} ${X(dout)},${Y(dout)}" fill="var(--accent)" fill-opacity="${attr(j === 1 ? .35 : .1)}" stroke="var(--accent)" stroke-width="2" ${dash ? `stroke-dasharray="${attr(dash)}"` : ""}/>`;
  });
  if (!sp.direct) s += `<circle cx="${attr(X([0, 0]))}" cy="${attr(Y([0, 0]))}" r="4.5" fill="var(--ink)"/>`;
  s += `</svg>`;
  return `<div class="chart"><h3>Rocker plane, looking along the pivot bolt</h3><p class="cap">Solid = ride height, dotted = full droop, dashed = full bump. Red = pushrod, green = damper, gold = rocker.</p>${s}</div>`;
}
// damper force against shaft speed: low-speed slope up to the knee, high-speed slope above (bilinear)
function damperForce(cl, ch, knee, v) { const a = Math.min(v, knee); return (cl * a + ch * Math.max(0, v - knee)) / 1000; }
function dampingBlock() {
  const rd = ev.ride, sc = ev.cfg.spring, knee = +sc.damper_knee || 50;
  const z = (k) => rd[k] == null ? `<span class="muted">–</span>` : fmt(rd[k], 2);
  const has = sc.damper_bump_low || sc.damper_rebound_low || sc.damper_bump_high || sc.damper_rebound_high;
  const v = Array.from({ length: 31 }, (_, i) => i * 10), tl = rd.damper_c_low_target, th = rd.damper_c_high_target;
  const series = [{ name: "target", x: v, y: v.map(q => damperForce(tl, th, knee, q)), color: "var(--base)", dash: "4 3", w: 1.5 }];
  if (sc.damper_bump_low) series.push({ name: "bump", x: v, y: v.map(q => damperForce(+sc.damper_bump_low, +(sc.damper_bump_high || sc.damper_bump_low), knee, q)), color: "var(--s1)" });
  if (sc.damper_rebound_low) series.push({ name: "rebound", x: v, y: v.map(q => damperForce(+sc.damper_rebound_low, +(sc.damper_rebound_high || sc.damper_rebound_low), knee, q)), color: "var(--s2)", dash: "6 3" });
  return `<h3 class="sub-h">Damping</h3>
  <div class="kv">
    <div><span>Critical damping at the wheel (body)</span><b>${fmt(rd.c_crit, 0)} <small>N s/m</small></b></div>
    <div><span>Critical damping at the wheel (wheel hop)</span><b>${fmt(rd.c_crit_hop, 0)} <small>N s/m</small></b></div>
    <div><span>Damper rate for ζ ${fmt(+sc.target_zeta_low || 0.7, 2)} (low-speed)</span><b>${fmt(tl, 0)} <small>N s/m</small></b></div>
    <div><span>Damper rate for ζ ${fmt(+sc.target_zeta_high || 0.35, 2)} (high-speed)</span><b>${fmt(th, 0)} <small>N s/m</small></b></div></div>
  ${has ? `<div class="tbl-wrap"><table class="data"><thead><tr><th>Damping ratio</th><th class="n">Low-speed (body)</th><th class="n">High-speed</th></tr></thead><tbody>
    <tr><td>Bump</td><td class="n">${z("zeta_bump_low")}</td><td class="n">${z("zeta_bump_high")}</td></tr>
    <tr><td>Rebound</td><td class="n">${z("zeta_rebound_low")}</td><td class="n">${z("zeta_rebound_high")}</td></tr>
    <tr><td>Wheel hop (bump, high-speed)</td><td class="n"></td><td class="n">${z("zeta_hop")}</td></tr></tbody></table></div>` :
    `<p class="note">Enter the damper's bump and rebound slopes (inputs → Pushrod, rocker &amp; damper → Damping) to see its damping ratios. The rates above are what would hit the targets.</p>`}
  <div class="charts">${chart({ title: "Damper force vs shaft speed, N", cap: `dashed = rates for the damping-ratio targets; knee at ${fmt(knee, 0)} mm/s`, xlabel: "shaft speed, mm/s", series })}</div>
  <p class="note">ζ = damper rate × MR² ÷ critical damping. Common starting points: about 0.6–0.8 at low speed (body control), 0.3–0.4 at high speed (bumps), with rebound stiffer than bump.
  Critical damping uses the ride rate (spring and tire in series) and the sprung mass of this corner; wheel hop uses the unsprung mass on spring + tire.</p>`;
}
function panelSpring() {
  if (!ev.spring) return `<p class="note">Turn on "Model the spring and damper" in the inputs to get motion ratio, ride frequency, damper stroke checks and member loads.</p>`;
  const rd = ev.ride, m = ev.metrics, sc = ev.cfg.spring, rows = ev.rows, x = rows.map(r => r.dz);
  const [lo, mid, hi] = rd._damper_len_range;
  const e2e = sc.damper_eye_to_eye, stroke = sc.damper_stroke;
  const kv = (lab, k, unit, dec) => m[k] == null ? "" : `<div><span>${lab}</span><b>${fmt(m[k], dec)} <small>${unit}</small></b></div>`;
  const bRows = base && base.ride ? base.rows : null;
  return `<div class="kv">
    ${kv("Motion ratio (damper/wheel)", "motion_ratio", "", 3)}${kv("MR change over travel", "mr_progression", "%", 1)}
    ${kv("Wheel rate", "wheel_rate", "N/mm", 1)}${kv("Ride rate with tire", "ride_rate", "N/mm", 1)}
    ${kv("Ride frequency", "ride_freq", "Hz", 2)}${kv(`Spring for ${fmt(sc.target_freq_hz, 1)} Hz`, "spring_for_target", "N/mm", 1)}
    ${kv("Spring force at ride height", "static_spring_force", "N", 0)}${kv("Damper stroke used", "damper_used", "mm", 1)}
    ${kv("Damper at ride height", "damper_static_pos", "% of stroke", 0)}${kv("Room to full extension", "damper_topout", "mm", 1)}
    ${kv("Room to full compression", "damper_bottomout", "mm", 1)}${kv("Rocker rotation", "rocker_rot", "deg", 1)}
    ${kv("Worst transmission angle", "trans_min", "deg", 0)}${kv("Pushrod angle", "rod_angle", "deg", 0)}
    <div><span>Wheel-hop frequency</span><b>${fmt(rd.hop_freq, 1)} <small>Hz</small></b></div></div>
  <p class="note">Damper length ${fmt(hi, 1)} / ${fmt(mid, 1)} / ${fmt(lo, 1)} mm at full droop / ride height / full bump${e2e && stroke ? `; the damper is ${fmt(e2e, 0)} mm extended and ${fmt(e2e - stroke, 0)} mm closed` : ". Add the damper's eye-to-eye length and stroke to check top-out and bottom-out"}.
  ${rd._arm_rod ? `Rocker arms ${fmt(rd._arm_rod, 1)} mm (pushrod side) and ${fmt(rd._arm_damper, 1)} mm (damper side).` : ""}</p>
  ${dampingBlock()}
  <div class="charts">
    ${rockerSvg()}
    ${chart({ title: "Motion ratio", cap: "damper travel per wheel travel", xlabel: "wheel travel, mm", marker: pose.dz,
      series: [...(bRows ? [{ name: "baseline", x: bRows.map(r => r.dz), y: bRows.map(r => r.motion_ratio), color: C.base, dash: "4 3", w: 1.5 }] : []), { name: bRows ? "current" : null, x, y: rows.map(r => r.motion_ratio), color: C.s1 }] })}
    ${chart({ title: "Damper length, mm", cap: e2e && stroke ? "shaded = usable stroke" : "", xlabel: "wheel travel, mm", marker: pose.dz,
      band: e2e && stroke ? [e2e - stroke, e2e] : null, series: [{ x, y: rows.map(r => r.damper_len), color: C.s3 }] })}
    ${rows[0].trans_rod != null ? chart({ title: "Rocker transmission angles, deg", cap: "90 = best leverage, keep above 45", xlabel: "wheel travel, mm", marker: pose.dz, band: [45, 90],
      series: [{ name: "pushrod", x, y: rows.map(r => r.trans_rod), color: C.s2 }, { name: "damper", x, y: rows.map(r => r.trans_damper), color: C.s3, dash: "5 3" }] }) : ""}
  </div>`;
}
function panelLoads() {
  if (!loads) return `<p class="note">Loads need the pushrod and damper (they carry the vertical load). Turn on "Model the spring and damper".</p>`;
  const L = loads, I = L.info, mem = ev.cfg.members, names = Object.keys(L.results);
  // legs named by where they physically are (larger X = front), matching the blue / gold legs in 3D
  const label = (k) => { const h = ev.susp.h, fr = (a, b) => a[0] >= b[0] ? "front" : "rear";
    return { upper_front: `Upper ${fr(h.uif, h.uir)} leg`, upper_rear: `Upper ${fr(h.uir, h.uif)} leg`, lower_front: `Lower ${fr(h.lif, h.lir)} leg`, lower_rear: `Lower ${fr(h.lir, h.lif)} leg`,
      tie_rod: ev.cfg.axle === "rear" ? "Toe link" : "Tie rod", pushrod: "Pushrod" }[k]; };
  const ty = names.map(n => `<tr><td>${esc(n)}</td><td class="n">${fmt(L.tire[n][0], 0)}</td><td class="n">${fmt(L.tire[n][1], 0)}</td><td class="n">${fmt(L.tire[n][2], 0)}</td><td class="mono" style="font-size:12px">${esc(L.fz_parts[n])}</td></tr>`).join("");
  const mrow = (lab, get) => `<tr><td>${lab}</td>${names.map(n => { const v = get(L.results[n]); return `<td class="n">${v > 0 ? "+" : ""}${fmt(v, 0)}</td>`; }).join("")}</tr>`;
  const mr = S.MEMBERS.map(k => mrow(label(k), r => r[k])).join("") + mrow("Damper / spring", r => r.damper) +
    (ev.spring.direct ? "" : `<tr><td>Rocker pivot (resultant)</td>${names.map(n => `<td class="n">${fmt(L.results[n].rocker_pivot, 0)}</td>`).join("")}</tr>`) +
    (ev.spring.on !== "upright" ? `<tr><td class="muted">Pushrod-arm bending load</td>${names.map(n => `<td class="n muted">${fmt(L.results[n].bending, 0)}</td>`).join("")}</tr>` : "");
  const ck = L.checks.map(r => { const fos = Math.min(r.sf_buckle, r.sf_yield), ok = fos >= mem.sf_target;
    return `<tr><td>${label(r.member)}</td><td class="n">${fmt(r.od, 2)} × ${fmt(r.wall, 3)}</td><td class="n">${fmt(r.length, 0)}</td>
      <td class="n">${fmt(r.compression, 0)}${r.compression ? ` <span class="muted">(${esc(r.c_case)})</span>` : ""}</td><td class="n">${fmt(r.Pcr, 0)}</td><td class="n">${fmt(r.sf_buckle, 1)}</td>
      <td class="n">${fmt(r.peak, 0)} <span class="muted">(${esc(r.p_case)})</span></td><td class="n">${fmt(r.Py, 0)}</td><td class="n">${fmt(r.sf_yield, 1)}</td>
      <td>${ok ? `<span class="pill ok">OK</span>` : `<span class="pill bad">Below FOS</span>`}</td></tr>`; }).join("");
  return `<p class="note">One config covers both corners of this axle. The solved wheel is the outer wheel in a left turn and the inner wheel in a right turn, so both are checked.
  Static wheel load ${fmt(I.Fz0, 0)} N; longitudinal transfer ${fmt(I.long_per_g, 0)} N/g; lateral transfer ${fmt(I.lat_per_g, 0)} N/g per wheel
  (front LLTD ${fmt(I.lltd * 100, 1)} %, ${ev.cfg.loads.lltd_front ? "your override" : I.lltd_from_car ? "from the car's roll balance" : "the front weight share: open a car file to use its roll balance"}).
  Side force = g level × that wheel's load; brake force ${I.brake_split === "bias" ? `= g × car weight × brake share (${fmt(I.brake_share * 100, 0)} % on this axle) / 2` : "= g level × that wheel's load"}.
  ${Object.keys(L.deflect || {}).length ? `Bump and pothole are also solved where the wheel actually is under that load, (load − static) ÷ wheel rate (${fmt(I.wheel_rate, 1)} N/mm), capped at full bump: ${Object.entries(L.deflect).map(([n, z]) => `${esc(n)} at +${fmt(z, 1)} mm`).join(", ")}.` : ""}</p>
  <h3 class="sub-h">Tire forces on the wheel, N</h3>
  <div class="tbl-wrap"><table class="data"><thead><tr><th>Case</th><th class="n">Fx</th><th class="n">Fy</th><th class="n">Fz</th><th>Fz built from</th></tr></thead><tbody>${ty}</tbody></table></div>
  <h3 class="sub-h">Member axial forces, N (+ tension, − compression)</h3>
  <div class="tbl-wrap"><table class="data"><thead><tr><th>Member</th>${names.map(n => `<th class="n">${esc(n)}</th>`).join("")}</tr></thead><tbody>${mr}</tbody></table></div>
  <h3 class="sub-h">Strength check · ${esc(mem.material || "steel")} · E ${fmt(mem.E, 0)} MPa · yield ${fmt(mem.yield, 0)} MPa · required FOS ${fmt(mem.sf_target, 1)}</h3>
  <div class="tbl-wrap"><table class="data"><thead><tr><th>Member</th><th class="n">Tube, mm</th><th class="n">Length</th><th class="n">Worst compression, N</th><th class="n">Buckling load, N</th><th class="n">FOS buckling</th><th class="n">Worst |force|, N</th><th class="n">Yield force, N</th><th class="n">FOS yield</th><th></th></tr></thead><tbody>${ck}</tbody></table></div>
  <p class="note">Buckling load = π²EI/L² with pinned ends. Yield force = yield stress × tube area. Tabs, welds, inserts and fatigue are not checked here.</p>
  ${partsHtml(L, label, mem)}`;
}
function partsHtml(L, label, mem) {
  let h = "";
  const b = L.bending_check;
  if (b) {
    const ok = b.sf >= mem.sf_target, legName = label(b.leg).toLowerCase();
    h += `<h3 class="sub-h">Pushrod mount bending the wishbone</h3>
    <div class="kv"><div><span>Leg carrying the mount</span><b style="font-size:15px">${esc(label(b.leg))}</b></div>
      <div><span>Mount position along the leg</span><b>${fmt(b.a, 0)} <small>of ${fmt(b.length, 0)} mm</small></b></div>
      <div><span>Mount offset from the leg's centerline</span><b>${fmt(b.offset, 0)} <small>mm</small></b></div>
      <div><span>Worst case (${esc(b.case)})</span><b>${fmt(b.moment / 1000, 1)} <small>N m</small> · ${fmt(b.stress, 0)} <small>MPa</small></b></div>
      <div><span>FOS (bending + axial vs yield)</span><b class="${attr(ok ? "ok-t" : "bad-t")}">${fmt(b.sf, 2)}</b></div></div>
    <p class="note">The ${esc(legName)} treated as a beam pinned at its inboard pivot and the ball joint, loaded across by the pushrod at the mount: M = P·a·(L−a)/L, stress = M·c/I + axial/A.
    ${ok ? "" : `<b>A bare tube is overloaded here.</b> Mount the pushrod on a gusset or bracket at the ball-joint node, move it closer to the ball joint, or use a stiffer leg; this check is conservative if a gusset carries the load. `}
    ${b.offset > 5 ? `The mount sits ${fmt(b.offset, 0)} mm off the leg's centerline, so its bracket also twists the leg (not modeled).` : ""}</p>`;
  }
  const P = L.parts || [];
  if (P.length) {
    const cap = P[0].bolt_capacity, need = mem.sf_target;
    const cell = (v) => v == null ? `<td class="n muted">–</td>` : `<td class="n ${v >= need ? "" : "bad-t"}">${fmt(v, 1)}</td>`;
    h += `<h3 class="sub-h">Rod ends and bolts · ${esc(String(mem.bolt_dia))} mm grade ${esc(String(mem.bolt_grade))} bolt, ${mem.bolt_shear_planes == 1 ? "single" : "double"} shear${cap ? ` (capacity ${fmt(cap, 0)} N)` : ""}</h3>
    <div class="tbl-wrap"><table class="data"><thead><tr><th>Member</th><th class="n">Worst |force|, N</th><th class="n">Bolt FOS</th><th class="n">Rod-end FOS</th></tr></thead><tbody>
    ${P.map(r => `<tr><td>${esc(label(r.member))}</td><td class="n">${fmt(r.peak, 0)} <span class="muted">(${esc(r.p_case)})</span></td>${cell(r.sf_bolt)}${r.sf_rod_end == null ? `<td class="n muted">enter rating</td>` : cell(r.sf_rod_end)}</tr>`).join("")}</tbody></table></div>
    <p class="note">Bolt shear capacity = shear planes × bolt area × 0.6 × tensile strength. Enter your rod end's catalog radial rating (inputs → Loads &amp; materials → Rod ends and bolts) to check it.</p>`;
  }
  const C = L.compliance;
  if (C) {
    const lim = (v, l) => l == null ? "" : Math.abs(v) <= l ? "" : "bad-t";
    h += `<h3 class="sub-h">Compliance · how far the wheel moves when the links and mounts flex</h3>
    <div class="kv"><div><span>Worst toe change, cornering / braking</span><b class="${attr(C.toe_ok ? "ok-t" : "bad-t")}">${fmt(C.worst_toe.toe, 3)}° <small>${esc(C.worst_toe.case)}${C.toe_limit != null ? ` · limit ${fmt(C.toe_limit, 2)}` : ""}</small></b></div>
      <div><span>Worst camber change, cornering / braking</span><b class="${attr(C.camber_ok ? "ok-t" : "bad-t")}">${fmt(C.worst_camber.camber, 3)}° <small>${esc(C.worst_camber.case)}${C.camber_limit != null ? ` · limit ${fmt(C.camber_limit, 2)}` : ""}</small></b></div>
      <div><span>Link stiffness (two rod ends + tube + mount)</span><b>${fmt(Math.min(...Object.values(C.stiffness)), 0)}–${fmt(Math.max(...Object.values(C.stiffness)), 0)} <small>N/mm</small></b></div></div>
    <div class="tbl-wrap"><table class="data"><thead><tr><th>Case</th><th class="n">Camber change, °</th><th class="n">Toe-in change, °</th><th class="n">Contact patch moves sideways, mm</th><th class="n">Largest link stretch, mm</th></tr></thead><tbody>
    ${C.cases.map(x => `<tr${x.driving ? "" : ` class="muted"`}><td>${esc(x.case)}${x.driving ? "" : " *"}</td><td class="n ${x.driving ? lim(x.camber, C.camber_limit) : ""}">${x.camber > 0 ? "+" : ""}${fmt(x.camber, 3)}</td>
      <td class="n ${x.driving ? lim(x.toe, C.toe_limit) : ""}">${x.toe > 0 ? "+" : ""}${fmt(x.toe, 3)}</td><td class="n">${x.cp_y > 0 ? "+" : ""}${fmt(x.cp_y, 2)}</td><td class="n">${fmt(x.worst_stretch, 2)}</td></tr>`).join("")}</tbody></table></div>
    <p class="note">These changes come on top of the kinematic curves. Each link is a spring: two rod ends, the tube (E·A/L) and the chassis tab in series, with the rack and damper held. Toe-in +, camber − = top in.
    * Bump and impact cases are shown but not held to the limits. The rod-end and tab stiffnesses are estimates (inputs → Loads &amp; materials → Compliance); a stiffer tab or rod end helps most.</p>`;
  }
  return h;
}
function panelPack() {
  const p = ev.pack, rear = ev.cfg.axle === "rear";
  const rows = Object.entries(p.pairs).sort((a, b) => (a[1][0] - a[1][3]) - (b[1][0] - b[1][3])).map(([n, [d, hz, rk, need]]) =>
    `<tr><td>${esc(n)}</td><td class="n">${fmt(d, 1)}</td><td class="n">${fmt(need, 1)}</td><td class="n">${fmt(hz, 0)}</td>${rear ? "" : `<td class="n">${fmt(rk, 0)}</td>`}<td>${d >= need ? `<span class="pill ok">Clear</span>` : `<span class="pill bad">Too close</span>`}</td></tr>`).join("");
  return `<div class="tbl-wrap"><table class="data"><thead><tr><th>Link pair</th><th class="n">Min gap, mm</th><th class="n">Needs</th><th class="n">At travel</th>${rear ? "" : `<th class="n">At rack</th>`}<th></th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note">Center-line distances, checked at full droop, ride height and full bump${rear ? "" : " with full left and right rack"}. "Needs" = half of each tube's OD plus ${fmt(ev.cfg.clearance.margin, 0)} mm margin.
  Rim: the farthest joint is ${fmt(p.rim_max, 1)} mm from the wheel axis against a ${fmt(p.rim_radius, 1)} mm rim radius, leaving ${fmt(p.rim_margin, 1)} mm (radial check only).</p>`;
}

