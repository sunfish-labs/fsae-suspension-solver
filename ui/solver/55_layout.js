/* 55_layout.js: vehicle layout (mass, CG, inertia) and the drivetrain's straight-line run (Python: layout.py). */
const DRIVE_DEFAULTS = {
  primary: 1.0,
  efficiency: 0.9,
  shift_time: 0.08,
  mass_factor: 1.05,
  drag_area: 0.9,
  rolling: 0.015,
  air_density: 1.2,
  distance: 75.0,
};
const isNum = (v, pos = true) => typeof v === "number" && Number.isFinite(v) && (pos ? v > 0 : true);
// mirrors layout.check_layout / check_drivetrain
function checkLayout(lay) {
  if (!lay || typeof lay !== "object" || !Array.isArray(lay.components)) throw new SolveError("layout needs a components list");
  lay.components.forEach((c, i) => {
    const nm = c.name || `#${i + 1}`;
    if (!isNum(c.mass)) throw new SolveError(`layout component ${nm} needs a positive mass (kg)`);
    if (!(Array.isArray(c.at) && c.at.length === 3 && c.at.every(v => isNum(v, false))))
      throw new SolveError(`layout component ${nm} needs at: [x, y, z] (mm)`);
    if (c.solid != null && typeof c.solid !== "boolean") throw new SolveError(`layout component ${nm}: solid must be true or false`);
    if (c.size != null && !(Array.isArray(c.size) && c.size.length === 3 && c.size.every(v => isNum(v))))
      throw new SolveError(`layout component ${nm}: size must be [length, width, height] in mm, all positive`);
  });
}
function checkDrivetrain(d) {
  const tc = d.torque_curve;
  if (
    !(
      Array.isArray(tc) &&
      tc.length >= 2 &&
      tc.every(p => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1], false) && p[1] >= 0)
    )
  )
    throw new SolveError("drivetrain.torque_curve needs at least two [rpm, N m] points");
  if (tc.some((p, i) => i && p[0] <= tc[i - 1][0])) throw new SolveError("drivetrain.torque_curve rpm must increase");
  if (!(Array.isArray(d.gears) && d.gears.length && d.gears.every(g => isNum(g))))
    throw new SolveError("drivetrain.gears needs one or more positive ratios");
  if (!isNum(d.final)) throw new SolveError("drivetrain.final needs a positive ratio (rear sprocket / front sprocket)");
  for (const k of [
    "primary",
    "efficiency",
    "shift_time",
    "mass_factor",
    "drag_area",
    "rolling",
    "redline",
    "launch_rpm",
    "distance",
    "top_speed_need",
  ]) {
    const v = d[k];
    if (v == null) continue;
    const strict = ["primary", "efficiency", "mass_factor", "redline", "launch_rpm", "distance", "top_speed_need"].includes(k);
    if (!isNum(v, false) || v < 0 || (strict && v === 0))
      throw new SolveError(`drivetrain.${k} must be a ${strict ? "positive" : "non-negative"} number`);
  }
  if (d.efficiency != null && d.efficiency > 1) throw new SolveError("drivetrain.efficiency is a fraction (0.9 = 90 %)");
}
// the four wheel assemblies as point masses at the wheel centers (mirrors layout.wheels)
function layoutWheels(fcfg, rcfg, wheelbase) {
  const out = [];
  for (const [c, ax] of [
    [fcfg, "front"],
    [rcfg, "rear"],
  ]) {
    const cp = c.hardpoints.contact_patch,
      x = fcfg.hardpoints.contact_patch[0] - (ax === "rear" ? wheelbase : 0),
      R = +(c.wheel.tire_radius || 254),
      m = +((c.spring || {}).unsprung_mass || 0);
    for (const [side, s] of [
      ["right", 1],
      ["left", -1],
    ])
      out.push([`${ax} ${side} wheel`, m, [x, s * cp[1], R]]);
  }
  return out;
}
function layoutMass(lay, fcfg, rcfg, wheelbase) {
  const items = lay.components
    .map(c => [c.name || "", +c.mass, c.at.map(Number), c.size || null])
    .concat(
      layoutWheels(fcfg, rcfg, wheelbase)
        .filter(w => w[1] > 0)
        .map(([n, m, p]) => [n, m, p, null])
    );
  const M = items.reduce((s, it) => s + it[1], 0);
  if (!(M > 0)) throw new SolveError("layout: the total mass is zero");
  const cg = [0, 1, 2].map(j => items.reduce((s, it) => s + it[1] * it[2][j], 0) / M);
  const xf = fcfg.hardpoints.contact_patch[0],
    yf = fcfg.hardpoints.contact_patch[1],
    wf = 1 - (xf - cg[0]) / wheelbase,
    left = yf ? 0.5 - cg[1] / (2 * yf) : 0.5;
  let Ixx = 0,
    Iyy = 0,
    Izz = 0;
  for (const [, m, p, size] of items) {
    const d = p.map((v, j) => (v - cg[j]) / 1000),
      [lx, ly, lz] = size ? size.map(v => v / 1000) : [0, 0, 0];
    Ixx += (m * (ly * ly + lz * lz)) / 12 + m * (d[1] ** 2 + d[2] ** 2);
    Iyy += (m * (lx * lx + lz * lz)) / 12 + m * (d[0] ** 2 + d[2] ** 2);
    Izz += (m * (lx * lx + ly * ly)) / 12 + m * (d[0] ** 2 + d[1] ** 2);
  }
  const unsprung = items.filter(it => it[0].endsWith(" wheel")).reduce((s, it) => s + it[1], 0),
    groups = {};
  for (const c of lay.components) groups[c.group || "other"] = (groups[c.group || "other"] || 0) + +c.mass;
  return {
    mass: M,
    cg,
    weight_front: wf,
    weight_left: left,
    cg_height: cg[2],
    Ixx,
    Iyy,
    Izz,
    sprung: M - unsprung,
    unsprung,
    n: lay.components.length,
    groups,
  };
}
function applyLayout(veh, res) {
  return Object.assign({}, veh, {
    mass: +res.mass.toFixed(6),
    weight_front: +res.weight_front.toFixed(9),
    cg_height: +res.cg_height.toFixed(6),
  });
}
function torqueAt(tc, rpm) {
  if (rpm <= tc[0][0]) return tc[0][1];
  if (rpm >= tc[tc.length - 1][0]) return rpm > tc[tc.length - 1][0] ? 0 : tc[tc.length - 1][1];
  for (let i = 1; i < tc.length; i++)
    if (rpm <= tc[i][0]) {
      const [r0, t0] = tc[i - 1],
        [r1, t1] = tc[i];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  return 0;
}
// the straight-line run from rest (mirrors layout.accel_run)
function accelRun(dIn, veh, tireRadius, wheelbase, dt = 1e-3) {
  const d = Object.assign({}, DRIVE_DEFAULTS);
  for (const [k, v] of Object.entries(dIn)) if (v != null) d[k] = v;
  const tc = d.torque_curve,
    red = +(d.redline || tc[tc.length - 1][0]),
    launch = +(d.launch_rpm || tc[0][0]);
  const m = +veh.mass,
    wf = +veh.weight_front,
    h = veh.cg_height / 1000,
    L = wheelbase / 1000,
    mu = +(veh.tire_mu || 1.5),
    R = tireRadius / 1000,
    me = m * d.mass_factor,
    G = 9.81;
  const ratio = d.gears.map(g => d.primary * g * d.final),
    top = ratio.map(r => ((red * 2 * Math.PI) / 60 / r) * R);
  const resist = v => 0.5 * d.air_density * d.drag_area * v * v + d.rolling * m * G;
  const drive = (v, gi) => {
    const rpm = Math.max((v / R) * ratio[gi] * (60 / (2 * Math.PI)), launch);
    return (torqueAt(tc, Math.min(rpm, red)) * ratio[gi] * d.efficiency) / R;
  };
  const capDen = me - (mu * m * h) / L;
  const accel = (v, gi) => {
    const F = drive(v, gi),
      D = resist(v),
      a = (F - D) / me,
      aGrip = capDen > 0 ? (mu * m * G * (1 - wf) - D) / capDen : Infinity;
    return a > aGrip ? [aGrip, true] : [a, false];
  };
  let t = 0,
    x = 0,
    v = 0,
    gi = 0,
    shiftLeft = 0,
    step = 0,
    gripUntil = 0;
  const trace = [[0, 0, 0, 1]],
    shifts = [],
    dist = d.distance;
  while (x < dist && t < 60) {
    let a, lim;
    if (shiftLeft > 0) {
      a = -resist(v) / me;
      lim = false;
      shiftLeft -= dt;
    } else {
      const rpm = (v / R) * ratio[gi] * (60 / (2 * Math.PI));
      if (rpm >= red && gi < ratio.length - 1) {
        gi += 1;
        shifts.push({ gear: gi + 1, t, x, v });
        shiftLeft = d.shift_time;
        continue;
      }
      [a, lim] = accel(v, gi);
      if (rpm >= red) a = Math.min(a, 0);
      if (lim) gripUntil = x;
    }
    const v2 = Math.max(0, v + a * dt),
      x2 = x + ((v + v2) / 2) * dt;
    if (x2 >= dist) {
      const f = x2 > x ? (dist - x) / (x2 - x) : 1;
      t += f * dt;
      v = v + (v2 - v) * f;
      x = dist;
      break;
    }
    t += dt;
    x = x2;
    v = v2;
    step += 1;
    if (step % 20 === 0) trace.push([+t.toFixed(3), +x.toFixed(3), +v.toFixed(4), gi + 1]);
  }
  trace.push([t, x, v, gi + 1]);
  const vmax = ratio.map((r, i) => {
    if (drive(top[i], i) >= resist(top[i])) return top[i];
    let lo = 0,
      hi = top[i];
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (drive(mid, i) > resist(mid)) lo = mid;
      else hi = mid;
    }
    return lo;
  });
  return {
    time: t,
    speed: v,
    distance: dist,
    grip_limited_to: gripUntil,
    shifts,
    gears: ratio.map((r, i) => ({ gear: i + 1, ratio: r, top_speed: top[i], max_speed: vmax[i] })),
    top_speed: Math.max(...vmax),
    trace,
    mass: m,
    mu,
    launch_accel: accel(0, 0)[0] / G,
    grip_accel: capDen > 0 ? (mu * m * G * (1 - wf) - resist(0)) / capDen / G : Infinity,
  };
}
// mirrors layout.gearing_sweep: the acceleration run over a range of final drives
const TOP_SPEED_NEED = 105; // km/h, D.12.2.2
function gearingSweep(d, veh, tireRadius, wheelbase, finals = null, needKph = null) {
  const base = +d.final;
  finals = finals || Array.from({ length: 11 }, (_, i) => base * (0.75 + 0.05 * i));
  const need = +(needKph || d.top_speed_need || TOP_SPEED_NEED);
  const rows = finals.map(f => {
    const r = accelRun({ ...d, final: f }, veh, tireRadius, wheelbase);
    return {
      final: f,
      time: r.time,
      speed: r.speed,
      top_speed: r.top_speed,
      shifts: r.shifts.length,
      reaches: r.top_speed * 3.6 >= need - 1e-9,
    };
  });
  const ok = rows.filter(r => r.reaches),
    best = (ok.length ? ok : rows).reduce((a, r) => (r.time < a.time ? r : a)),
    cur = accelRun(d, veh, tireRadius, wheelbase);
  return { rows, need_kph: need, best, current: { final: base, time: cur.time, top_speed: cur.top_speed }, gain: cur.time - best.time };
}
