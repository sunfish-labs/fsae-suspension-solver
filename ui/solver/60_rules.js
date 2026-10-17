/* 60_rules.js: the car against a rulebook (Python: rules.py). Rule numbers and paraphrases live in schema/rules/. */
const RULESETS = SCHEMA.rules || {};
function usableTravel(cfg, ev) {
  const sc = cfg.spring || {},
    e2e = sc.damper_eye_to_eye,
    stroke = sc.damper_stroke;
  if (!(ev.ride && e2e && stroke)) return null;
  const rows = ev.rows.slice().sort((a, b) => a.dz - b.dz),
    z = rows.map(r => r.dz),
    L = rows.map(r => r.damper_len);
  const at = Lt => {
    for (let i = 0; i < z.length - 1; i++) {
      const a = L[i],
        b = L[i + 1];
      if ((a - Lt) * (b - Lt) <= 0 && a !== b) return z[i] + ((Lt - a) * (z[i + 1] - z[i])) / (b - a);
    }
    const lo = (L[1] - L[0]) / (z[1] - z[0]),
      hi = (L[L.length - 1] - L[L.length - 2]) / (z[z.length - 1] - z[z.length - 2]);
    if (Lt < Math.min(...L) === L[L.length - 1] < L[0]) return hi ? z[z.length - 1] + (Lt - L[L.length - 1]) / hi : NaN;
    return lo ? z[0] + (Lt - L[0]) / lo : NaN;
  };
  const zb = at(+e2e - +stroke),
    zd = at(+e2e);
  return { total: Math.abs(zb - zd), bump: zb, droop: zd };
}
function tiltAngle(fcfg, fev, rcfg, rev, bal) {
  const veh = fcfg.vehicle,
    h = +veh.cg_height,
    WB = +veh.wheelbase,
    a = (1 - veh.weight_front) * WB,
    tf = fev.susp.track,
    tr = rev.susp.track,
    half = tf / 2 + ((tr / 2 - tf / 2) * a) / WB;
  let shift = 0;
  if (bal) {
    const phi = (bal.grad * Math.sin((60 * Math.PI) / 180) * Math.PI) / 180;
    shift = (bal.ms / veh.mass) * bal.arm * Math.sin(phi);
  }
  return [(Math.atan2(half - shift, h) * 180) / Math.PI, { half_track: half, cg_height: h, lean: shift }];
}
function keepoutHits(lay, fcfg, rcfg, wheelbase) {
  if (!lay) return null;
  const hits = [],
    xf0 = fcfg.hardpoints.contact_patch[0];
  for (const [c0, ax] of [
    [fcfg, "front"],
    [rcfg, "rear"],
  ]) {
    const R = +(c0.wheel.tire_radius || 254),
      w = +(c0.wheel.tire_width || 190),
      yc = +c0.hardpoints.contact_patch[1],
      xc = xf0 - (ax === "rear" ? wheelbase : 0);
    for (const c of lay.components || []) {
      if (c.solid === false || !c.size) continue;
      const x = +c.at[0],
        y = +c.at[1],
        hx = c.size[0] / 2,
        hy = c.size[1] / 2;
      if (x + hx < xc - R - 75 || x - hx > xc + R + 75) continue;
      for (const side of [1, -1]) {
        const lo = side * yc - w / 2,
          hi = side * yc + w / 2;
        if (y + hy > lo && y - hy < hi) hits.push([c.name || "part", `${ax} ${side > 0 ? "right" : "left"}`]);
      }
    }
  }
  return hits;
}
// ---- driver template and roll hoops in side view (mirrors cockpit.py); points [x, z] in the car frame
function cockpitTemplate(ck) {
  const [hx, hz] = ck.hip,
    b = (+ck.back_angle * Math.PI) / 180,
    n = b + (+(ck.neck_angle || 0) * Math.PI) / 180,
    sx = hx - 490 * Math.sin(b),
    sz = hz + 490 * Math.cos(b);
  return [
    [hx, hz],
    [sx, sz],
    [sx - 280 * Math.sin(n), sz + 280 * Math.cos(n)],
  ];
}
function sideDist(p, a, b) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    L = Math.hypot(dx, dz),
    s = ((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / L,
    mx = (a[0] + b[0]) / 2,
    mz = (a[1] + b[1]) / 2 - 1000,
    ref = (mx - a[0]) * dz - (mz - a[1]) * dx;
  return ref > 0 ? s : -s;
}
function xOnLine(a, b, z) {
  if (Math.abs(b[1] - a[1]) < 1e-9) return Math.min(a[0], b[0]);
  return a[0] + ((z - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
}
function cockpitValues(ck) {
  if (!ck) return {};
  const mh = ck.main_hoop_top,
    fh = ck.front_hoop_top,
    driver = ck.hip != null && ck.back_angle != null,
    tpl = driver ? cockpitTemplate(ck) : null,
    v = { _template: tpl ? { hip: tpl[0], shoulder: tpl[1], head: tpl[2] } : null };
  if (driver) {
    const [hip, , head] = tpl;
    v.helmet_front_line = sideDist(head, mh, fh) - 150;
    const bl = ck.brace_lower;
    if (bl) {
      if (bl[0] < mh[0]) {
        const d = sideDist(head, mh, bl);
        v.helmet_brace_line = (head[0] > xOnLine(mh, bl, head[1]) ? Math.abs(d) : -Math.abs(d)) - 150;
        v.helmet_behind_hoop = { na: "braces extend rearwards" };
      } else {
        v.helmet_brace_line = { na: "braces extend forwards" };
        v.helmet_behind_hoop = head[0] - 150 - mh[0];
      }
    }
    if (ck.pedal_face_x != null) v.hip_to_pedals = +ck.pedal_face_x - hip[0];
  }
  if (ck.wheel_top_z != null) v.front_hoop_over_wheel = fh[1] - +ck.wheel_top_z;
  if (ck.wheel_front_x != null) v.front_hoop_ahead_of_wheel = fh[0] - +ck.wheel_front_x;
  if (ck.brace_upper) v.brace_drop = mh[1] - ck.brace_upper[1];
  Object.assign(v, frameValues(ck, tpl));
  return v;
}
// optional frame and harness points (mirrors cockpit.frame_values)
const COCKPIT_OPT = [
  "sis_upper_front",
  "sis_upper_rear",
  "sis_lower_low",
  "front_hoop_at_sis",
  "main_hoop_at_sis",
  "main_hoop_bottom",
  "lap_belt_mount",
  "shoulder_belt_mount",
];
function inclineDeg(lo, hi) {
  return deg(Math.atan2(-(hi[0] - lo[0]), hi[1] - lo[1]));
}
function frameValues(ck, tpl) {
  const v = {},
    fh = ck.front_hoop_top,
    mh = ck.main_hoop_top;
  if (ck.sis_lower_low) {
    const h = +ck.sis_lower_low[1];
    v.lsis_height = { v: h, note: h > 75 ? "should be 75 mm or less" : "" };
    const tops = ["sis_upper_front", "sis_upper_rear"].filter(k => ck[k]).map(k => ck[k][1] - h);
    if (tops.length) [v.upper_sis_low, v.upper_sis_high] = [Math.min(...tops), Math.max(...tops)];
  }
  if (ck.front_hoop_at_sis) {
    const inc = inclineDeg(ck.front_hoop_at_sis, fh);
    v.front_hoop_incline = Math.abs(inc);
    v.front_hoop_rear_lean =
      inc <= 10
        ? { na: inc > 0 ? `leans rearward ${inc.toFixed(1)} deg, 10 or less` : `leans forward ${(-inc).toFixed(1)} deg` }
        : { manual: `leans rearward ${inc.toFixed(1)} deg: needs rearward Front Hoop Braces to a triangulated node` };
  }
  if (ck.main_hoop_at_sis) {
    const inc = inclineDeg(ck.main_hoop_at_sis, mh);
    v.main_hoop_incline_above = Math.abs(inc);
    if (ck.main_hoop_bottom) v.main_hoop_rear_lean_below = Math.max(0, inclineDeg(ck.main_hoop_bottom, ck.main_hoop_at_sis));
    const bu = ck.brace_upper,
      bl = ck.brace_lower;
    if (bu && bl) {
      const a = [mh[0] - ck.main_hoop_at_sis[0], mh[1] - ck.main_hoop_at_sis[1]],
        b = [bl[0] - bu[0], bl[1] - bu[1]],
        ang = deg(Math.acos(Math.abs(a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b))));
      v.brace_angle = ang;
      const lean = Math.abs(inc) < 0.5 ? "vertical" : inc > 0 ? "rearward" : "forward",
        side = bl[0] < bu[0] ? "rearward" : "forward";
      v.brace_side = {
        v: lean === "vertical" || lean === side,
        note: `hoop ${lean !== "vertical" ? "leans " + lean : "vertical"}, braces ${side}`,
      };
    }
  }
  if (!tpl) {
    // no driver template: no belt angles
    if (ck.shoulder_belt_spacing != null) v.shoulder_belt_spacing = +ck.shoulder_belt_spacing;
    return v;
  }
  const [hip, sh] = tpl,
    upright = +ck.back_angle <= 30;
  if (ck.lap_belt_mount) {
    const m = ck.lap_belt_mount,
      ang = deg(Math.atan2(Math.abs(hip[1] - m[1]), Math.abs(hip[0] - m[0])));
    v.lap_belt_upright = upright ? ang : { na: "reclined seat: back over 30 deg" };
    v.lap_belt_reclined = !upright ? ang : { na: "upright seat: back 30 deg or less" };
  }
  if (ck.shoulder_belt_mount) {
    const m = ck.shoulder_belt_mount,
      top = [sh[0], sh[1] + 100];
    v.shoulder_belt_angle = deg(Math.atan2(top[1] - m[1], Math.abs(top[0] - m[0])));
  }
  if (ck.shoulder_belt_spacing != null) v.shoulder_belt_spacing = +ck.shoulder_belt_spacing;
  return v;
}
function checkCockpit(ck) {
  if (!ck || typeof ck !== "object") throw new SolveError("cockpit must be an object of side-view points");
  for (const k of ["main_hoop_top", "front_hoop_top", "brace_lower", "brace_upper", "hip"]) {
    const p = ck[k];
    if (p == null && (k === "brace_lower" || k === "brace_upper" || k === "hip")) continue;
    if (!(Array.isArray(p) && p.length === 2 && p.every(q => typeof q === "number" && Number.isFinite(q))))
      throw new SolveError(`cockpit.${k} needs [x, z] in mm`);
  }
  for (const k of COCKPIT_OPT) {
    const p = ck[k];
    if (p != null && !(Array.isArray(p) && p.length === 2 && p.every(q => typeof q === "number" && Number.isFinite(q))))
      throw new SolveError(`cockpit.${k} needs [x, z] in mm`);
  }
  if (ck.shoulder_belt_spacing != null && typeof ck.shoulder_belt_spacing !== "number")
    throw new SolveError("cockpit.shoulder_belt_spacing must be a number (mm)");
  if ((ck.hip == null) !== (ck.back_angle == null))
    throw new SolveError("cockpit needs both hip and back_angle for the driver template, or neither");
  if (ck.back_angle != null && !(typeof ck.back_angle === "number" && ck.back_angle >= 0 && ck.back_angle < 80))
    throw new SolveError("cockpit.back_angle is the seat back's angle from vertical, 0 to 80 deg");
}
// ---- ground clearance (mirrors rules.corner_limits / ground_planes / ground_clearance)
function cornerLimits(cfg, ev) {
  const t = usableTravel(cfg, ev);
  let bump, droop;
  if (t) [bump, droop] = [Math.max(t.bump, t.droop), Math.min(t.bump, t.droop)];
  else {
    const [D, B] = travelRange(cfg);
    [bump, droop] = [B, -D];
  }
  const kw = ev.ride ? ev.metrics.wheel_rate : null,
    kt = (cfg.spring || {}).tire_rate,
    squash = kw && kt ? (+kw * bump) / +kt : 0;
  return { bump: +bump, droop: +droop, squash: +squash };
}
function groundPlanes(fcfg, fev, rcfg, rev, wheelbase) {
  const xf = +fcfg.hardpoints.contact_patch[0],
    corners = [];
  for (const [cfg, ev, x, ax] of [
    [fcfg, fev, xf, "front"],
    [rcfg, rev, xf - +wheelbase, "rear"],
  ]) {
    const lim = cornerLimits(cfg, ev),
      y = +cfg.hardpoints.contact_patch[1];
    for (const [side, yy] of [
      ["right", y],
      ["left", -y],
    ])
      corners.push({ name: `${ax} ${side}`, x, y: yy, lo: lim.droop, hi: lim.bump + lim.squash });
  }
  const planes = [],
    tris = [
      [0, 1, 2],
      [0, 1, 3],
      [0, 2, 3],
      [1, 2, 3],
    ];
  for (const tri of tris) {
    const other = [0, 1, 2, 3].find(i => !tri.includes(i)),
      A = tri.map(i => [1, corners[i].x, corners[i].y]);
    for (let m = 0; m < 8; m++) {
      const lims = [0, 1, 2].map(j => ((m >> (2 - j)) & 1 ? "hi" : "lo")),
        sol = solveLinear(
          A,
          tri.map((i, j) => corners[i][lims[j]])
        );
      if (!sol) continue;
      const [a, b, c] = sol,
        o = corners[other],
        d4 = a + b * o.x + c * o.y;
      if (d4 >= o.lo - 1e-6 && d4 <= o.hi + 1e-6) {
        const state = {};
        tri.forEach((i, j) => (state[corners[i].name] = lims[j] === "hi" ? "full bump" : "full droop"));
        planes.push({ a, b, c, state });
      }
    }
  }
  return [planes, corners];
}
function groundClearance(points, planes) {
  let best = null;
  for (const p of points || []) {
    const [x, y, z] = p.at.map(Number);
    for (const pl of planes) {
      const dr = pl.a + pl.b * x + pl.c * y,
        cl = z - dr;
      if (!best || cl < best.value) best = { value: cl, point: p.name || "point", at: [x, y, z], drop: dr, state: pl.state };
    }
  }
  return best;
}
function checkGroundPoints(gp) {
  if (!Array.isArray(gp)) throw new SolveError("ground_points must be a list of {name, at: [x, y, z]}");
  gp.forEach((p, i) => {
    const at = p && p.at;
    if (!(Array.isArray(at) && at.length === 3 && at.every(v => typeof v === "number" && Number.isFinite(v))))
      throw new SolveError(`ground_points[${i}] needs at: [x, y, z] in mm`);
  });
}
function ruleValues(fcfg, fev, rcfg, rev, bal = null, layout = null, cockpit = null, ground = null, brakes = null) {
  const veh = fcfg.vehicle,
    tf = fev.susp.track,
    tr = rev.susp.track;
  const v = { wheelbase: +veh.wheelbase, track_ratio: Math.min(tf, tr) / Math.max(tf, tr) };
  [v.tilt_angle, v._tilt] = tiltAngle(fcfg, fev, rcfg, rev, bal);
  for (const [c, e, ax] of [
    [fcfg, fev, "front"],
    [rcfg, rev, "rear"],
  ]) {
    const t = usableTravel(c, e);
    v[`travel_${ax}`] = t ? t.total : null;
    v[`_travel_${ax}`] = t;
    v[`wheel_${ax}`] = +(c.wheel.rim_diameter_in || 0) * 25.4;
  }
  v.bolt_grades = [fcfg, rcfg].map(c => String(c.members.bolt_grade));
  v.shear_planes = [fcfg, rcfg].map(c => +(c.members.bolt_shear_planes || 2));
  const st = fev.steer || [],
    rk = +(fcfg.sweep.rack_travel || 0);
  v.steer_solves = st.length > 0 && Math.max(...st.map(s => Math.abs(s.rack))) >= rk - 1e-6;
  const rm = [fev, rev].map(e => e.metrics.rim_margin);
  v.rim_margin = rm.every(x => x != null) ? Math.min(...rm) : null;
  v.keepout_hits = keepoutHits(layout, fcfg, rcfg, +veh.wheelbase);
  if (cockpit) Object.assign(v, cockpitValues(cockpit));
  const g = ground && ground.length ? groundClearance(ground, groundPlanes(fcfg, fev, rcfg, rev, +veh.wheelbase)[0]) : null;
  v.ground_clearance = g ? g.value : null;
  v._ground = g;
  Object.assign(v, brakeRuleValues(brakes, fcfg, rcfg));
  return v;
}
function checkRules(ruleset, values) {
  return ruleset.checks.map(c => {
    const k = c.kind,
      raw = values[c.value || ""],
      row = {
        id: c.id,
        rule: c.rule,
        summary: c.summary,
        kind: k,
        value: raw ?? null,
        limit: c.limit ?? null,
        unit: c.unit || "",
        estimate: !!c.estimate,
        note: "",
      };
    let val = raw;
    if (val && typeof val === "object" && !Array.isArray(val) && "v" in val) {
      row.note = val.note || "";
      val = val.v;
      row.value = val;
    }
    if (k === "manual") row.status = "manual";
    else if (val && typeof val === "object" && !Array.isArray(val) && "manual" in val) {
      row.status = "manual";
      row.note = val.manual;
      row.value = null;
    } else if (val && typeof val === "object" && !Array.isArray(val) && "na" in val) {
      row.status = "na";
      row.note = val.na;
      row.value = null;
    } else if (val == null) row.status = "unknown";
    else if (k === "min") row.status = val >= c.limit ? "pass" : "fail";
    else if (k === "max") row.status = val <= c.limit ? "pass" : "fail";
    else if (k === "between") row.status = val >= c.limit[0] && val <= c.limit[1] ? "pass" : "fail";
    else if (k === "oneof") {
      row.status = val.some(x => !c.allowed.includes(x)) ? "fail" : "pass";
      row.note = [...new Set(val)].sort().join(", ");
    } else if (k === "double_shear") {
      row.status = val.every(n => n >= 2) ? "pass" : "manual";
      row.note = row.status === "pass" ? "double shear" : "single shear: needs a capturing bolt head or washer";
    } else if (k === "true") row.status = val ? "pass" : "fail";
    else if (k === "none") {
      row.status = val.length ? "fail" : "pass";
      row.note = val.map(([p, w]) => `${p} (${w})`).join("; ");
    }
    return row;
  });
}
