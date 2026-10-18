// ---------------------------------------------------------------- brake sizing (mirrors susp/brakes.py)
const BRAKE_DEFAULTS = { bias: 0.5, bias_range: [0.35, 0.65], rear_calipers: 2, pad_mu: 0.4, driver_force: 450 };
const PEDAL_RULE_FORCE = 2000; // T.3.2.2
function checkBrakes(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new SolveError("brake_system must be an object (see the README)");
  for (const k of ["pedal_ratio", "mc_front", "mc_rear", "rotor_front", "rotor_rear"])
    if (!(typeof b[k] === "number" && b[k] > 0)) throw new SolveError(`brake_system.${k} must be a positive number`);
  for (const k of ["caliper_front", "caliper_rear"])
    if (!(Array.isArray(b[k]) && b[k].length && b[k].every(d => typeof d === "number" && d > 0)))
      throw new SolveError(`brake_system.${k} must list the piston diameters on one side of the rotor (mm)`);
  for (const k of ["pad_mu", "tire_mu", "driver_force", "max_pressure", "mc_stroke", "bar_width", "bar_max_angle", "pedal_max_travel"])
    if (b[k] != null && !(typeof b[k] === "number" && b[k] > 0)) throw new SolveError(`brake_system.${k} must be a positive number`);
  if (b.bias != null && !(typeof b.bias === "number" && b.bias > 0 && b.bias < 1))
    throw new SolveError("brake_system.bias is the front share of the pedal force, between 0 and 1");
  const rg = b.bias_range;
  if (
    rg != null &&
    !(Array.isArray(rg) && rg.length === 2 && rg.every(x => typeof x === "number") && rg[0] > 0 && rg[0] < rg[1] && rg[1] < 1)
  )
    throw new SolveError("brake_system.bias_range must be [lo, hi] with 0 < lo < hi < 1");
  if (b.rear_calipers != null && ![1, 2].includes(b.rear_calipers))
    throw new SolveError("brake_system.rear_calipers must be 2 (one per wheel) or 1 (on the differential)");
}
const pistonArea = d => (Math.PI / 4) * d * d;
function brakeSizing(b0, veh, tireRadius, wheelbase) {
  const b = { ...BRAKE_DEFAULTS };
  for (const [k, v] of Object.entries(b0)) if (v != null) b[k] = v;
  const m = +veh.mass,
    wf = +veh.weight_front,
    h = +veh.cg_height,
    L = +wheelbase,
    mu = +(b.tire_mu || veh.tire_mu || 1.5),
    W = m * 9.81,
    fzF = W * wf + (m * mu * 9.81 * h) / L,
    fzR = W - fzF,
    R = +tireRadius,
    ratio = +b.pedal_ratio;
  const out = { tire_mu: mu, decel_g: mu, fz_front: fzF, fz_rear: fzR, ideal_front_share: fzF / W },
    push = {},
    kAx = {},
    padClearance = 0.15,
    caliperCompliance = 0.0025,
    sDead = 1.0;
  for (const [ax, n] of [
    ["front", 2],
    ["rear", +b.rear_calipers],
  ]) {
    const aP = b[`caliper_${ax}`].reduce((s, d) => s + pistonArea(d), 0),
      k = 2 * +b.pad_mu * aP * +b[`rotor_${ax}`],
      p = (mu * (ax === "front" ? fzF : fzR) * R) / (n * k),
      aMc = pistonArea(+b[`mc_${ax}`]);
    push[ax] = p * aMc;
    kAx[ax] = (n * k) / aMc / R;
    const pBar = p * 10;
    out[`p_lock_${ax}`] = pBar;
    const vFluid = n * aP * (padClearance + caliperCompliance * pBar);
    out[`stroke_${ax}`] = vFluid / aMc + sDead;
  }
  const bias = +b.bias,
    fF = push.front / (bias * ratio),
    fR = push.rear / ((1 - bias) * ratio);
  Object.assign(out, {
    bias,
    pedal_lock_front: fF,
    pedal_lock_rear: fR,
    pedal_lock: Math.max(fF, fR),
    first_lock: fF < fR ? "front" : fR < fF ? "rear" : "both",
  });
  const bi = push.front / (push.front + push.rear),
    [lo, hi] = b.bias_range;
  Object.assign(out, { bias_ideal: bi, bias_range: [lo, hi], bias_ok: lo <= bi && bi <= hi, pedal_lock_ideal: push.front / (bi * ratio) });
  const bf = bias * kAx.front,
    br = (1 - bias) * kAx.rear;
  out.installed_front_share = bf / (bf + br);
  out.driver_force = +b.driver_force;
  out.lock_margin = out.driver_force - out.pedal_lock;
  const mcStroke = b.mc_stroke ? +b.mc_stroke : 25.4,
    barW = b.bar_width ? +b.bar_width : 63.5,
    barMaxDeg = b.bar_max_angle ? +b.bar_max_angle : 10.0,
    pedalMaxTr = b.pedal_max_travel ? +b.pedal_max_travel : 75.0,
    sf = out.stroke_front,
    sr = out.stroke_rear,
    sUsed = Math.max(sf, sr),
    tiltDeg = (Math.atan(Math.abs(sf - sr) / barW) * 180) / Math.PI,
    pedTravel = ratio * (bias * sf + (1 - bias) * sr);
  Object.assign(out, {
    stroke_max: mcStroke,
    stroke_margin: mcStroke - sUsed,
    stroke_ok: sUsed <= mcStroke,
    bar_width: barW,
    bar_tilt_deg: tiltDeg,
    bar_max_angle: barMaxDeg,
    bar_tilt_margin: barMaxDeg - tiltDeg,
    bar_tilt_ok: tiltDeg <= barMaxDeg,
    pedal_travel: pedTravel,
    pedal_max_travel: pedalMaxTr,
    pedal_travel_margin: pedalMaxTr - pedTravel,
    pedal_travel_ok: pedTravel <= pedalMaxTr,
  });
  out.p_2000 = Math.max(bias / pistonArea(+b.mc_front), (1 - bias) / pistonArea(+b.mc_rear)) * PEDAL_RULE_FORCE * ratio * 10;
  out.max_pressure = b.max_pressure ? +b.max_pressure : null;
  out.pressure_margin = out.max_pressure ? out.max_pressure - out.p_2000 : null;
  return out;
}
function brakeRuleValues(b, fcfg, rcfg) {
  if (!b)
    return {
      brake_lock_margin: null,
      brake_bias_ok: null,
      brake_circuits: null,
      brake_pressure_margin: null,
      brake_stroke_margin: null,
      brake_bar_tilt_ok: null,
      brake_pedal_travel: null,
      _brakes: null,
    };
  const veh = fcfg.vehicle,
    r = brakeSizing(b, veh, +rcfg.wheel.tire_radius, +veh.wheelbase),
    pct = x => (x * 100).toFixed(0);
  return {
    brake_lock_margin: {
      v: r.lock_margin,
      note: `${r.pedal_lock.toFixed(0)} N on the pedal locks all four at mu ${+r.tire_mu.toPrecision(6)} (${r.first_lock} first), against ${r.driver_force.toFixed(0)} N`,
    },
    brake_bias_ok: {
      v: r.bias_ok,
      note: `locks both axles together at ${pct(r.bias_ideal)} % front; the bar reaches ${pct(r.bias_range[0])}-${pct(r.bias_range[1])} %`,
    },
    brake_circuits: { v: true, note: "a front and a rear master cylinder" },
    brake_stroke_margin: {
      v: r.stroke_margin,
      note: `front ${r.stroke_front.toFixed(1)} mm, rear ${r.stroke_rear.toFixed(1)} mm (limit ${r.stroke_max.toFixed(1)} mm)`,
    },
    brake_bar_tilt_ok: {
      v: r.bar_tilt_ok,
      note: `${r.bar_tilt_deg.toFixed(1)}° tilt (limit ${r.bar_max_angle.toFixed(1)}°)`,
    },
    brake_pedal_travel: {
      v: r.pedal_travel_margin,
      note: `${r.pedal_travel.toFixed(0)} mm at the pedal pad (room ${r.pedal_max_travel.toFixed(0)} mm)`,
    },
    brake_pressure_margin: r.max_pressure
      ? { v: r.pressure_margin, note: `${r.p_2000.toFixed(0)} bar at 2000 N, parts take ${r.max_pressure.toFixed(0)} bar` }
      : {
          manual: `${r.p_2000.toFixed(0)} bar in the lines at 2000 N on the pedal: enter brake_system.max_pressure, the lowest proof or burst pressure of the master cylinders, calipers and lines`,
        },
    _brakes: r,
  };
}
