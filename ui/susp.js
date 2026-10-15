/* susp.js - FSAE double-wishbone solver (browser port of the Python `susp` package).
   Same conventions: X forward, Y outboard, Z up, mm, deg, N; right-hand wheel; ground at Z = 0.
   Every function mirrors a Python function of the same name; selftest compares the two. */
(function (root) {
  "use strict";
  // ------------------------------------------------------------------ vector helpers
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => mul(a, 1 / norm(a));
  const perp = (v, k) => sub(v, mul(k, dot(v, k)));
  const deg = (r) => r * 180 / Math.PI, rad = (d) => d * Math.PI / 180;
  const matvec = (M, v) => [dot(M[0], v), dot(M[1], v), dot(M[2], v)];
  const clone = (o) => JSON.parse(JSON.stringify(o));

  class SolveError extends Error {}

  function rodrigues(rv) {
    const th = norm(rv);
    const k = th < 1e-12 ? rv : mul(rv, 1 / th);
    const K = [[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]];
    const K2 = [0, 1, 2].map(i => [0, 1, 2].map(j => K[i][0] * K[0][j] + K[i][1] * K[1][j] + K[i][2] * K[2][j]));
    const s = th < 1e-12 ? 1 : Math.sin(th), c = th < 1e-12 ? 0.5 : (1 - Math.cos(th));
    return [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) + s * K[i][j] + c * K2[i][j]));
  }

  function solveLinear(A, b) { // Gaussian elimination with partial pivoting
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-14) return null;
      [M[c], M[p]] = [M[p], M[c]];
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }

  function segDist(p1, q1, p2, q2) {
    const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
    const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), c = dot(d1, r), b = dot(d1, d2);
    const den = a * e - b * b;
    const clamp = (v) => Math.min(1, Math.max(0, v));
    let s = den > 1e-12 ? clamp((b * f - c * e) / den) : 0;
    let t = (b * s + f) / e;
    if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
    return norm(sub(add(p1, mul(d1, s)), add(p2, mul(d2, t))));
  }

  function plane(p1, p2, p3) {
    const n = unit(cross(sub(p2, p1), sub(p3, p1)));
    return [n, dot(n, p1)];
  }

  function lineIntersect2d(p1, d1, p2, d2) {
    const det = d1[0] * (-d2[1]) - (-d2[0]) * d1[1];
    if (Math.abs(det) < 1e-12) return null;
    const bx = p2[0] - p1[0], by = p2[1] - p1[1];
    const t = (bx * (-d2[1]) - (-d2[0]) * by) / det;
    return [p1[0] + t * d1[0], p1[1] + t * d1[1]];
  }

  // ------------------------------------------------------------------ config
  const HP = {
    upper_inboard_front: "uif", upper_inboard_rear: "uir", lower_inboard_front: "lif", lower_inboard_rear: "lir",
    upper_outboard: "ubj", lower_outboard: "lbj", trackrod_inboard: "tri", trackrod_outboard: "tro",
    contact_patch: "cp",
  };
  const HP_ORDER = Object.keys(HP);
  const SPRING_POINTS = ["rod_outboard", "rocker_pivot", "rocker_axis", "rocker_rod", "rocker_damper", "damper_chassis"];

  const DEFAULTS = {
    name: "untitled", axle: "front",
    wheel: { camber_deg: -1.0, toe_deg: 0.0, tire_radius: 254.0, tire_width: 190.5, rim_diameter_in: 13.0 },
    vehicle: { wheelbase: 1700.0, track: null, cg_height: 300.0, front_brake_share: 0.5, brakes: "outboard",
      drive: "inboard", mass: 280.0, weight_front: 0.46, rack_c_factor: null },
    sweep: { travel: 30.0, steps: 41, rack_travel: 35.0, rack_steps: 14, ackermann_at_outer_deg: 15.0,
      roll_deg: 2.0, roll_steps: 9 },
    clearance: { wishbone_tube_od: 25.4, tie_rod_od: 16.0, pushrod_od: 15.9, damper_od: 55.0, margin: 5.0 },
    rack_direction: [0.0, 1.0, 0.0],
    targets: {},
    spring: null,
    loads: { bump_g: 3.0, corner_g: 1.6, brake_g: 1.6, combined_g: 1.2, accel_g: 1.0, lltd_front: null },
    members: { material: "4130 chromoly steel, normalized (yield is lower next to welds)",
      wishbone: [15.875, 0.889], tie_rod: [15.875, 0.889], pushrod: [15.875, 0.889],
      E: 205000.0, yield: 435.0, sf_target: 2.0 },
  };
  const SPRING_DEFAULTS = {
    rod_on: "lower", rod_outboard: null, rocker_pivot: null, rocker_axis: null, rocker_rod: null,
    rocker_damper: null, damper_chassis: null, spring_rate: 35.0, damper_stroke: null, damper_eye_to_eye: null,
    unsprung_mass: 11.0, tire_rate: 110.0, target_freq_hz: null,
  };

  const METRICS = {
    camber: ["Static camber", "deg", 2], toe: ["Static toe (+ = in)", "deg", 3], caster: ["Caster", "deg", 2],
    kpi: ["KPI", "deg", 2], scrub: ["Scrub radius", "mm", 1], trail: ["Mechanical trail", "mm", 1],
    roll_center: ["Roll centre height", "mm", 1], fvsa: ["Front-view swing arm", "mm", 0],
    camber_gain: ["Camber gain", "deg/in", 3], bump_steer: ["Bump steer (+ = in)", "deg/in", 3],
    bump_steer_max: ["Max |toe change|", "deg", 3], bump_steer_curve: ["Toe curvature (+ = in)", "deg", 3],
    track_change: ["Track change", "mm", 2], antidive: ["Anti-dive", "%", 1], antisquat: ["Anti-squat", "%", 1],
    antilift: ["Anti-lift", "%", 1], ackermann: ["Ackermann", "%", 0],
    clearance_min: ["Min link clearance", "mm", 1], clearance_margin: ["Clearance margin", "mm", 1],
    rim_margin: ["Rim radial margin", "mm", 1],
    roll_camber: ["Roll camber (outer, to ground)", "deg/deg", 3],
    roll_camber_max: ["Outer camber to ground at max roll", "deg", 2],
    rc_lat: ["Roll centre lateral shift", "mm/deg", 1], rc_height_roll: ["Roll centre height at max roll", "mm", 1],
    roll_steer: ["Roll steer (outer, + = in)", "deg/deg", 3],
    turn_radius: ["Turning radius (outer front wheel)", "m", 2], steer_arm: ["Steering arm length", "mm", 1],
    motion_ratio: ["Motion ratio (damper/wheel)", "", 3], mr_progression: ["Motion ratio change over travel", "%", 1],
    wheel_rate: ["Wheel rate", "N/mm", 1], ride_rate: ["Ride rate (with tyre)", "N/mm", 1],
    ride_freq: ["Ride frequency", "Hz", 2], spring_for_target: ["Spring rate for target freq", "N/mm", 1],
    damper_used: ["Damper stroke used", "mm", 1], damper_margin: ["Damper stroke left", "mm", 1],
    rocker_rot: ["Rocker rotation over travel", "deg", 1], static_spring_force: ["Spring force at ride height", "N", 0],
    damper_topout: ["Damper room to full extension", "mm", 1],
    damper_bottomout: ["Damper room to full compression", "mm", 1],
    damper_static_pos: ["Damper compressed at ride height", "% stroke", 0],
    trans_min: ["Worst rocker transmission angle", "deg", 0], rod_angle: ["Pushrod angle from horizontal", "deg", 0],
    hop_freq: ["Wheel-hop frequency", "Hz", 1],
  };

  function deepMerge(base, over) {
    const out = clone(base);
    for (const [k, v] of Object.entries(over || {})) {
      if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]))
        out[k] = deepMerge(out[k], v);
      else out[k] = clone(v === undefined ? null : v);
    }
    return out;
  }

  function finishConfig(raw) {
    const cfg = deepMerge(DEFAULTS, raw);
    const hp = cfg.hardpoints || {};
    const missing = HP_ORDER.filter(k => !hp[k]);
    if (missing.length) throw new SolveError("Missing hardpoints: " + missing.join(", "));
    cfg.hardpoints = Object.fromEntries(HP_ORDER.map(k => [k, hp[k].map(Number)]));
    if (!["front", "rear"].includes(cfg.axle)) throw new SolveError("axle must be 'front' or 'rear'");
    if (cfg.spring) {
      const sp = deepMerge(SPRING_DEFAULTS, cfg.spring);
      if (!["lower", "upper", "upright"].includes(sp.rod_on)) throw new SolveError("spring.rod_on must be lower, upper or upright");
      const rk = ["rocker_pivot", "rocker_axis", "rocker_rod", "rocker_damper"].filter(k => sp[k] != null);
      if (rk.length && rk.length < 4) throw new SolveError("Spring needs all four rocker points, or none for a direct-acting damper");
      for (const k of ["rod_outboard", "damper_chassis"]) if (sp[k] == null) throw new SolveError("Spring block is missing " + k);
      cfg.spring = sp;
    }
    return cfg;
  }

  // Broad starting ranges that suit most FSAE cars; narrow them per design ("targets") or with a team targets file.
  const GENERAL_TARGETS = {
    front: { camber: [-3.0, -0.5], camber_gain: [0.2, 1.0], caster: [3, 8], kpi: [0, 9], scrub: [0, 30], trail: [5, 30],
      toe: [-0.5, 0.25], roll_center: [0, 75], antidive: [0, 40], ackermann: [0, 100], bump_steer: [-0.05, 0.05], bump_steer_max: [null, 0.10] },
    rear: { camber: [-3.0, -0.5], camber_gain: [0.2, 1.0], toe: [0.0, 0.5], roll_center: [0, 100], antisquat: [0, 60],
      bump_steer: [-0.05, 0.05], bump_steer_max: [null, 0.10] },
  };
  function defaultTargets(cfg) {
    const t = clone(GENERAL_TARGETS[cfg.axle]);
    if (cfg.spring) {
      t.ride_freq = [2.5, 4.5];
      if (cfg.spring.damper_stroke) {
        t.damper_margin = [0.0, null];
        if (cfg.spring.damper_eye_to_eye) { t.damper_topout = [2.0, null]; t.damper_bottomout = [2.0, null]; }
      }
      if (cfg.spring.rocker_pivot != null) t.trans_min = [45.0, null];
    }
    Object.assign(t, cfg.targets || {});
    for (const k of Object.keys(t)) if (t[k] == null) delete t[k];
    return t;
  }
  // team targets file: {"front": {...}, "rear": {...}} or a flat {metric: [lo, hi]} table
  function targetsFromFile(data, axle) {
    if (data.front || data.rear) return clone(data[axle] || {});
    return clone(data.targets || data);
  }

  // ------------------------------------------------------------------ input checks
  function validate(cfg) {
    const h = {}; for (const k of HP_ORDER) h[HP[k]] = cfg.hardpoints[k];
    const out = [], W = (m) => out.push(["warn", m]), E = (m) => out.push(["error", m]);
    const R = cfg.wheel.tire_radius;
    if (Math.abs(h.cp[2]) > 1) W(`Contact patch Z is ${h.cp[2].toFixed(1)} mm. The ground should be Z = 0 (Z up); check the CAD axis mapping.`);
    if (h.cp[1] <= 0) E("Contact patch Y must be positive (right-hand wheel, Y outboard). Your Y axis may be flipped.");
    if (h.ubj[2] <= h.lbj[2]) E("Upper ball joint is not above the lower one. They may be swapped, or Z is not up.");
    for (const [arm, pts] of [["upper", ["uif", "uir", "ubj"]], ["lower", ["lif", "lir", "lbj"]]]) {
      const [a, b, bj] = pts.map(p => h[p]);
      if (Math.max(a[1], b[1]) >= bj[1]) W(`${arm} wishbone: an inboard pivot is not inboard of the ball joint (Y). Check for swapped axes.`);
      const u = mul(sub(b, a), 1 / Math.max(norm(sub(b, a)), 1e-9));
      if (norm(perp(sub(bj, a), u)) < 50) E(`${arm} wishbone: the ball joint is almost on the pivot axis, so the arm cannot control the wheel.`);
      if (Math.abs(u[0]) < 0.5) W(`${arm} wishbone pivot axis is ${deg(Math.acos(Math.min(1, Math.abs(u[0])))).toFixed(0)} deg off fore-aft. Check the pivot coordinates.`);
    }
    for (const [nm, p] of [["Upper ball joint", "ubj"], ["Lower ball joint", "lbj"], ["Trackrod outboard", "tro"]]) {
      if (h[p][1] > h.cp[1] + 5) W(`${nm} is outboard of the tyre centre plane (Y ${h[p][1].toFixed(0)} > ${h.cp[1].toFixed(0)}). Check it fits inside the rim.`);
      if (h[p][2] > 2 * R) W(`${nm} is above the top of the tyre. Check units (mm) and Z.`);
    }
    if (Math.abs(h.tro[1] - h.tri[1]) < 100) W("Tie rod is under 100 mm long laterally. Bump steer will be hard to control.");
    const k = unit(sub(h.ubj, h.lbj)), arm = norm(perp(sub(h.tro, h.lbj), k));
    if (cfg.axle === "front" && arm < 50) W(`Steering arm is only ${arm.toFixed(0)} mm. Rack forces will be high and steering very quick.`);
    const veh = cfg.vehicle;
    if (veh.wheelbase < 1525) W(`Wheelbase ${veh.wheelbase.toFixed(0)} mm is below the FSAE minimum (1525 mm in recent rules).`);
    if (!(veh.weight_front >= 0.3 && veh.weight_front <= 0.7)) W("Front weight should be a fraction such as 0.46, not a percentage.");
    const sp = cfg.spring;
    if (sp) {
      const p = sp.rod_outboard;
      if (sp.rod_on !== "upright") {
        const [a, b, bj] = (sp.rod_on === "lower" ? ["lif", "lir", "lbj"] : ["uif", "uir", "ubj"]).map(q => h[q]);
        const u = unit(sub(b, a)), dbj = norm(perp(sub(bj, a), u)), dp = norm(perp(sub(p, a), u));
        if (dp < 0.6 * dbj) W(`Pushrod mounts ${dp.toFixed(0)} mm from the ${sp.rod_on} arm axis vs ${dbj.toFixed(0)} mm for the ball joint, which bends the arm.`);
      }
      const inner = sp.rocker_pivot != null ? sp.rocker_rod : sp.damper_chassis;
      const e = sub(inner, p), L = norm(e), ang = deg(Math.asin(Math.min(1, Math.abs(e[2]) / L)));
      if (ang < 20) W(`Pushrod is only ${ang.toFixed(0)} deg from horizontal: low motion ratio and high rod forces (30-60 deg is typical).`);
      if (sp.rocker_axis != null) {
        if (norm(sp.rocker_axis) < 1e-9) E("Rocker axis is zero. Give the direction of the rocker pivot bolt, e.g. 1, 0, 0.");
        else {
          const ax = unit(sp.rocker_axis), r = sub(sp.rocker_rod, sp.rocker_pivot);
          if (Math.abs(dot(cross(r, mul(e, 1 / L)), ax)) < 0.2 * norm(perp(r, ax)))
            W("The pushrod points almost through the rocker pivot: tiny lever arm, near a toggle position.");
        }
      }
    }
    return out.sort((a, b) => (a[0] === "error" ? 0 : 1) - (b[0] === "error" ? 0 : 1));
  }

  // ------------------------------------------------------------------ kinematics
  class Suspension {
    constructor(cfg) {
      this.cfg = cfg;
      const h = {}; for (const k of HP_ORDER) h[HP[k]] = cfg.hardpoints[k].slice();
      this.h = h;
      const w = cfg.wheel, veh = cfg.vehicle;
      this.R = +w.tire_radius; this.WB = +veh.wheelbase; this.CG = +veh.cg_height;
      this.frontShare = +veh.front_brake_share;
      this.track = veh.track ? +veh.track : 2 * h.cp[1];
      this.axle = cfg.axle;
      this.rackDir = unit(cfg.rack_direction);
      const g = rad(w.camber_deg), toe = rad(w.toe_deg);
      this.a0 = unit([Math.sin(toe) * Math.cos(g), Math.cos(toe) * Math.cos(g), -Math.sin(g)]);
      const up = unit(sub([0, 0, 1], mul(this.a0, this.a0[2])));
      this.cpz0 = h.cp[2];
      this.c0 = add(h.cp, mul(up, this.R));
      this.P0 = [h.ubj, h.lbj, h.tro, this.c0];
      this.ref = this.c0.slice();
      this.tri0 = h.tri;
      this.L = [norm(sub(h.ubj, h.uif)), norm(sub(h.ubj, h.uir)), norm(sub(h.lbj, h.lif)),
        norm(sub(h.lbj, h.lir)), norm(sub(h.tro, h.tri))];
      this.cache = new Map();
    }
    move(x, p) {
      const Rm = rodrigues(x.slice(3));
      return add(add(matvec(Rm, sub(p, this.ref)), this.ref), x.slice(0, 3));
    }
    unpack(x) {
      const Rm = rodrigues(x.slice(3)), t = x.slice(0, 3);
      const P = this.P0.map(p => add(add(matvec(Rm, sub(p, this.ref)), this.ref), t));
      return [P, matvec(Rm, this.a0)];
    }
    contact(P, a) {
      const up = unit(sub([0, 0, 1], mul(a, a[2])));
      return sub(P[3], mul(up, this.R));
    }
    res(x, dz, rack) {
      const [P, a] = this.unpack(x), h = this.h;
      const tri = add(this.tri0, mul(this.rackDir, rack)), cp = this.contact(P, a);
      return [norm(sub(P[0], h.uif)) - this.L[0], norm(sub(P[0], h.uir)) - this.L[1],
        norm(sub(P[1], h.lif)) - this.L[2], norm(sub(P[1], h.lir)) - this.L[3],
        norm(sub(P[2], tri)) - this.L[4], cp[2] - (this.cpz0 + dz)];
    }
    newton(x0, dz, rack, tol = 1e-9, maxit = 40) {
      let x = x0.slice(), r = this.res(x, dz, rack);
      const mx = (v) => Math.max(...v.map(Math.abs)), nrm = (v) => Math.hypot(...v);
      for (let it = 0; it < maxit; it++) {
        if (mx(r) < tol) return [x, true];
        const J = [[], [], [], [], [], []];
        for (let i = 0; i < 6; i++) {
          const xp = x.slice(); xp[i] += 1e-6;
          const rp = this.res(xp, dz, rack);
          for (let j = 0; j < 6; j++) J[j][i] = (rp[j] - r[j]) / 1e-6;
        }
        const dx = solveLinear(J, r.map(v => -v));
        if (!dx) return [x, false];
        let t = 1, xn, rn, ok = false;
        while (t > 1e-4) {
          xn = x.map((v, i) => v + t * dx[i]);
          rn = this.res(xn, dz, rack);
          if (nrm(rn) < nrm(r) * (1 - 1e-4 * t) || mx(rn) < tol) { ok = true; break; }
          t *= 0.5;
        }
        if (!ok) return [x, mx(r) < 1e-6];
        x = xn; r = rn;
      }
      return [x, mx(r) < 1e-6];
    }
    ramp(x, s0, s1, step = 1.5) {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(s1[0] - s0[0]), Math.abs(s1[1] - s0[1])) / step));
      for (let k = 1; k <= n; k++) {
        const f = k / n, dz = s0[0] + (s1[0] - s0[0]) * f, rk = s0[1] + (s1[1] - s0[1]) * f;
        const [xn, ok] = this.newton(x, dz, rk);
        if (!ok) throw new SolveError(`No valid position at ${dz.toFixed(1)} mm travel, ${rk.toFixed(1)} mm rack. The links cannot reach it: check the hardpoints or reduce the travel/rack range.`);
        x = xn;
      }
      return x;
    }
    // pose at any (heave, rack) for the viewer
    pose(dz, rack) {
      const xh = this.states([dz]).get(dz);
      return rack ? this.ramp(xh, [dz, 0], [dz, rack]) : xh;
    }
    states(dzs) {
      const out = new Map(), todo = [...new Set(dzs.map(Number))].sort((a, b) => a - b);
      for (const side of [1, -1]) {
        const seq = todo.filter(d => d * side > 0).sort((a, b) => Math.abs(a) - Math.abs(b));
        let x = [0, 0, 0, 0, 0, 0], z = 0;
        for (const d of seq) {
          if (this.cache.has(d)) { x = this.cache.get(d); z = d; }
          else { x = this.ramp(x, [z, 0], [d, 0]); z = d; this.cache.set(d, x); }
          out.set(d, x);
        }
      }
      if (todo.includes(0)) out.set(0, [0, 0, 0, 0, 0, 0]);
      return out;
    }
    observe(x, dz, rack = 0) {
      const [P, a] = this.unpack(x), [ub, lb, tro, c] = P, cp = this.contact(P, a), h = this.h;
      const d = sub(ub, lb), o = { dz, rack };
      o.camber = -deg(Math.asin(Math.min(1, Math.max(-1, a[2]))));
      o.toe = deg(Math.atan2(a[0], a[1]));
      o.caster = deg(Math.atan((lb[0] - ub[0]) / d[2]));
      o.kpi = deg(Math.atan((lb[1] - ub[1]) / d[2]));
      const f = (lb[2] - cp[2]) / d[2];
      o.scrub = cp[1] - (lb[1] + (lb[1] - ub[1]) * f);
      o.trail = (lb[0] + (lb[0] - ub[0]) * f) - cp[0];
      [o.cp_x, o.cp_y, o.cp_z] = cp;
      const [n1, d1] = plane(h.uif, h.uir, ub), [n2, d2] = plane(h.lif, h.lir, lb);
      const dv = cross(n1, n2);
      let pt = null, dvf = dv, dvs = dv;
      if (norm(dv) < 1e-9) { dvf = cross(n1, [1, 0, 0]); dvs = cross(n1, [0, 1, 0]); }
      else pt = solveLinear([n1, n2, dv], [d1, d2, 0]);
      let dy, dzz;
      if (pt && Math.abs(dv[0]) > 1e-9) {
        const q = add(pt, mul(dv, (cp[0] - pt[0]) / dv[0]));
        dy = q[1] - cp[1]; dzz = q[2] - cp[2];
        o.fv_ic = [q[1], q[2]]; o.fvsa = Math.abs(dy);
      } else { dy = dvf[1]; dzz = dvf[2]; o.fv_ic = null; o.fvsa = Infinity; }
      o.fv_line = [cp[1], cp[2], dy, dzz];
      const rc = Math.abs(dy) > 1e-12 ? -cp[1] * dzz / dy : NaN;
      o.roll_center = rc; o.roll_center_chassis = rc + cp[2];
      let sv = null;
      if (pt && Math.abs(dv[1]) > 1e-9) { sv = add(pt, mul(dv, (cp[1] - pt[1]) / dv[1])); o.sv_ic = [sv[0], sv[2]]; }
      else o.sv_ic = null;
      const slopeRear = (ref) => sv ? (sv[2] - ref[2]) / (ref[0] - sv[0])
        : (Math.abs(dvs[0]) > 1e-12 ? -dvs[2] / dvs[0] : 0);
      const veh = this.cfg.vehicle, k = this.WB / this.CG * 100;
      const refBrake = veh.brakes === "inboard" ? c : cp;
      if (this.axle === "front") o.antidive = slopeRear(refBrake) * k * this.frontShare;
      else {
        const refDrive = veh.drive === "inboard" ? c : cp;
        o.antisquat = -slopeRear(refDrive) * k;
        o.antilift = -slopeRear(refBrake) * k * (1 - this.frontShare);
      }
      o._pts = { ub, lb, tro, c, a, cp, tri: add(this.tri0, mul(this.rackDir, rack)) };
      o._x = x;
      return o;
    }
    heaveSweep(steps, travel) {
      const sw = this.cfg.sweep, T = +(travel ?? sw.travel);
      let n = +(steps ?? sw.steps); if (n % 2 === 0) n++;
      const zs = Array.from({ length: n }, (_, i) => -T + 2 * T * i / (n - 1)); zs[(n - 1) / 2] = 0;
      const xs = this.states(zs);
      return zs.map(z => this.observe(xs.get(z), z));
    }
    rollSweep(maxDeg, steps) {
      const sw = this.cfg.sweep, m = +(maxDeg ?? sw.roll_deg);
      let n = +(steps ?? sw.roll_steps); if (n % 2 === 0) n++;
      const phis = Array.from({ length: n }, (_, i) => -m + 2 * m * i / (n - 1));
      const t = this.h.cp[1];
      const ss = phis.map(p => t * Math.tan(rad(p))); ss[(n - 1) / 2] = 0;
      const xs = this.states(ss.concat(ss.map(s => -s)));
      return phis.map((phi, i) => {
        const s = ss[i], oo = this.observe(xs.get(s), s), oi = this.observe(xs.get(s ? -s : 0), -s);
        const [yR, zR, dyR, dzR] = oo.fv_line, [yL, zL, dyL, dzL] = oi.fv_line;
        const pR = [yR, zR], pL = [-yL, zL];
        const rc = lineIntersect2d(pR, [dyR, dzR], pL, [-dyL, dzL]);
        const gl = Math.hypot(pR[0] - pL[0], pR[1] - pL[1]), g = [(pR[0] - pL[0]) / gl, (pR[1] - pL[1]) / gl];
        const mid = [(pR[0] + pL[0]) / 2, (pR[1] + pL[1]) / 2];
        let hrc = NaN, yrc = NaN;
        if (rc) { const v = [rc[0] - mid[0], rc[1] - mid[1]]; hrc = g[0] * v[1] - g[1] * v[0]; yrc = g[0] * v[0] + g[1] * v[1]; }
        return { roll: phi, dz_outer: s, camber_outer: oo.camber + phi, camber_inner: oi.camber - phi,
          toe_outer: oo.toe, toe_inner: oi.toe, rc_height: hrc, rc_lateral: yrc };
      });
    }
    steerSweep(rackMax, steps) {
      const sw = this.cfg.sweep, Rm = +(rackMax ?? sw.rack_travel), n = +(steps ?? sw.rack_steps);
      const rs = Array.from({ length: n + 1 }, (_, i) => Rm * i / n);
      const base = this.observe([0, 0, 0, 0, 0, 0], 0, 0), cols = { 1: [base], "-1": [base] };
      for (const sgn of [1, -1]) {
        let x = [0, 0, 0, 0, 0, 0];
        for (let i = 1; i <= n; i++) {
          x = this.ramp(x, [0, sgn * rs[i - 1]], [0, sgn * rs[i]]);
          cols[sgn].push(this.observe(x, 0, sgn * rs[i]));
        }
      }
      const cot = (t) => 1 / Math.tan(rad(t));
      return rs.map((r, i) => {
        const a = cols[1][i], b = cols["-1"][i], fa = a.toe - base.toe, fb = b.toe - base.toe;
        let inner, outer, ci, co;
        if (fa < 0) { inner = -fa; outer = fb; ci = a.camber; co = b.camber; }
        else { inner = -fb; outer = fa; ci = b.camber; co = a.camber; }
        const ack = (outer > 1 && inner > 0.5) ? (cot(outer) - cot(inner)) * this.WB / this.track * 100 : NaN;
        return { rack: r, inner, outer, ackermann: ack, camber_inner: ci, camber_outer: co };
      });
    }
    grid(heaves, racks) {
      const xs = this.states(heaves), out = [];
      for (const hz of heaves) {
        const xh = xs.get(Number(hz));
        for (const rk of racks) out.push([hz, rk, rk ? this.ramp(xh, [hz, 0], [hz, rk]) : xh]);
      }
      return out;
    }
    steerArm() {
      const h = this.h, k = unit(sub(h.ubj, h.lbj));
      return norm(perp(sub(h.tro, h.lbj), k));
    }
    packaging(spring) {
      const sw = this.cfg.sweep, T = sw.travel, Rk = sw.rack_travel;
      const heaves = [-T, 0, T], racks = this.axle === "front" ? [-Rk, 0, Rk] : [0];
      const h = this.h, rimR = this.cfg.wheel.rim_diameter_in * 25.4 / 2, cl = this.cfg.clearance;
      const od = { "tie rod": cl.tie_rod_od, pushrod: cl.pushrod_od ?? 15.9, arm: cl.wishbone_tube_od };
      const res = { rim_radius: rimR, pairs: {}, rim_max: 0, rim_where: null };
      const rod = this.axle === "rear" ? "toe link" : "tie rod";
      const need = (a, b) => (od[a] + od[b]) / 2 + cl.margin;
      for (const [hz, rk, x] of this.grid(heaves, racks)) {
        const p = this.observe(x, hz, rk)._pts;
        const legs = [
          [`lower arm leg to pivot X=${h.lif[0].toFixed(0)}`, "lower", h.lif, p.lb],
          [`lower arm leg to pivot X=${h.lir[0].toFixed(0)}`, "lower", h.lir, p.lb],
          [`upper arm leg to pivot X=${h.uif[0].toFixed(0)}`, "upper", h.uif, p.ub],
          [`upper arm leg to pivot X=${h.uir[0].toFixed(0)}`, "upper", h.uir, p.ub]];
        const checks = legs.map(([n, , s0, s1]) => [`${rod} – ${n}`, [p.tri, p.tro], [s0, s1], need("tie rod", "arm")]);
        if (spring) {
          const st = spring.state(x), pr = [st.rod_out, st.rod_in];
          for (const [n, arm, s0, s1] of legs) if (arm !== spring.on) checks.push([`pushrod – ${n}`, pr, [s0, s1], need("pushrod", "arm")]);
          checks.push([`pushrod – ${rod}`, pr, [p.tri, p.tro], need("pushrod", "tie rod")]);
          const mir = (q) => [q[0], -q[1], q[2]];
          checks.push(["damper – other side's damper", [st.damper_out, spring.dch], [mir(st.damper_out), mir(spring.dch)],
            (cl.damper_od ?? 55) + cl.margin]);
        }
        for (const [name, [a0, a1], [b0, b1], req] of checks) {
          const dist = segDist(a0, a1, b0, b1), cur = res.pairs[name];
          if (!cur || dist - req < cur[0] - cur[3]) res.pairs[name] = [dist, hz, rk, req];
        }
        for (const nm of ["ub", "lb", "tro"]) {
          const radial = norm(perp(sub(p[nm], p.c), p.a));
          if (radial > res.rim_max) { res.rim_max = radial; res.rim_where = [nm, hz, rk]; }
        }
      }
      const wd = Object.entries(res.pairs).reduce((m, kv) => (!m || kv[1][0] - kv[1][3] < m[1][0] - m[1][3]) ? kv : m, null);
      res.min_clearance = wd[1][0]; res.required = wd[1][3]; res.min_pair = wd; res.ok = wd[1][0] >= wd[1][3];
      res.rim_margin = rimR - res.rim_max;
      return res;
    }
  }

  function summarize(rows, roll) {
    let i0 = 0; rows.forEach((r, i) => { if (Math.abs(r.dz) < Math.abs(rows[i0].dz)) i0 = i; });
    const r0 = rows[i0], lo = rows[0], hi = rows[rows.length - 1], span = (hi.dz - lo.dz) / 25.4;
    const m = {};
    for (const k of ["camber", "toe", "caster", "kpi", "scrub", "trail", "roll_center", "fvsa"]) m[k] = r0[k];
    m.camber_gain = -(hi.camber - lo.camber) / span;
    m.bump_steer = (hi.toe - lo.toe) / span;
    m.bump_steer_max = Math.max(...rows.map(r => Math.abs(r.toe - r0.toe)));
    m.bump_steer_curve = (hi.toe + lo.toe) / 2 - r0.toe;
    const cpy = rows.map(r => r.cp_y);
    m.track_change = Math.max(...cpy) - Math.min(...cpy);
    m.rc_min = Math.min(...rows.map(r => r.roll_center)); m.rc_max = Math.max(...rows.map(r => r.roll_center));
    for (const k of ["antidive", "antisquat", "antilift"]) if (k in r0) m[k] = r0[k];
    if (roll && roll.length) {
      const j0 = (roll.length - 1) / 2, a = roll[j0 - 1], b = roll[j0 + 1], dp = b.roll - a.roll;
      m.roll_camber = (b.camber_outer - a.camber_outer) / dp;
      m.roll_steer = (b.toe_outer - a.toe_outer) / dp;
      m.rc_lat = (b.rc_lateral - a.rc_lateral) / dp;
      const top = roll[roll.length - 1];
      m.roll_camber_max = top.camber_outer; m.rc_height_roll = top.rc_height; m.roll_max_deg = top.roll;
    }
    return m;
  }

  function ackermannAt(rows, outerDeg) {
    let prev = null;
    for (const r of rows) {
      if (r.outer >= outerDeg && prev) {
        const f = (outerDeg - prev.outer) / Math.max(1e-9, r.outer - prev.outer);
        if (!isNaN(prev.ackermann) && !isNaN(r.ackermann)) return [prev.ackermann + f * (r.ackermann - prev.ackermann), true];
        return [r.ackermann, true];
      }
      prev = r;
    }
    return [rows[rows.length - 1].ackermann, false];
  }

  function rackForAngle(rows, key, d) {
    let prev = null;
    for (const r of rows) {
      if (r[key] >= d && prev) {
        const f = (d - prev[key]) / Math.max(1e-9, r[key] - prev[key]);
        return prev.rack + f * (r.rack - prev.rack);
      }
      prev = r;
    }
    return null;
  }

  // ------------------------------------------------------------------ spring / rocker / damper
  const G = 9.81;
  class Spring {
    constructor(susp, sc) {
      this.s = susp; this.sc = sc; const h = susp.h;
      this.on = sc.rod_on; this.p0 = sc.rod_outboard.slice(); this.dch = sc.damper_chassis.slice();
      this.direct = sc.rocker_pivot == null;
      if (this.on === "lower") { this.piv = [h.lif, h.lir]; this.bj_i = 1; }
      else if (this.on === "upper") { this.piv = [h.uif, h.uir]; this.bj_i = 0; }
      if (!this.direct) {
        this.c = sc.rocker_pivot.slice(); this.k = unit(sc.rocker_axis);
        this.rr0 = sc.rocker_rod.slice(); this.rd0 = sc.rocker_damper.slice();
        this.Lrod = norm(sub(this.rr0, this.p0));
      }
      this.bj0 = this.on !== "upright" ? susp.P0[this.bj_i] : null;
    }
    rodOut(x) {
      if (this.on === "upright") return this.s.move(x, this.p0);
      const [P] = this.s.unpack(x), [a, b] = this.piv, u = unit(sub(b, a));
      const v0 = perp(sub(this.bj0, a), u), v1 = perp(sub(P[this.bj_i], a), u);
      const ang = Math.atan2(dot(u, cross(v0, v1)), dot(v0, v1));
      return add(a, matvec(rodrigues(mul(u, ang)), sub(this.p0, a)));
    }
    rockerAt(th) {
      const Rm = rodrigues(mul(this.k, th));
      return [add(this.c, matvec(Rm, sub(this.rr0, this.c))), add(this.c, matvec(Rm, sub(this.rd0, this.c)))];
    }
    state(x, th0 = 0) {
      const p = this.rodOut(x);
      if (this.direct) return { rod_out: p, rod_in: this.dch, damper_out: p, damper_len: norm(sub(p, this.dch)), rocker_deg: 0 };
      const f = (th) => norm(sub(this.rockerAt(th)[0], p)) - this.Lrod;
      let th = th0, done = false;
      for (let i = 0; i < 50; i++) {
        const r = f(th);
        if (Math.abs(r) < 1e-10) { done = true; break; }
        const d = (f(th + 1e-7) - r) / 1e-7;
        if (Math.abs(d) < 1e-12) throw new SolveError("The rocker is at a toggle point (the rod points through the pivot). Move the rocker's rod point.");
        th -= Math.max(-0.2, Math.min(0.2, r / d));
      }
      if (!done && Math.abs(f(th)) > 1e-6) throw new SolveError("The rocker position could not be solved: the pushrod cannot reach the rocker here.");
      const [rr, rd] = this.rockerAt(th);
      return { rod_out: p, rod_in: rr, damper_out: rd, damper_len: norm(sub(rd, this.dch)), rocker_deg: deg(th) };
    }
  }

  function angleToArm(arm, force, k) {
    const a = perp(arm, k), f = perp(force, k), na = norm(a), nf = norm(f);
    if (na < 1e-9 || nf < 1e-9) return 0;
    return deg(Math.acos(Math.min(1, Math.abs(dot(a, f)) / (na * nf))));
  }
  function transmissionAngles(sp, st) {
    return [angleToArm(sub(st.rod_in, sp.c), sub(st.rod_in, st.rod_out), sp.k),
      angleToArm(sub(st.damper_out, sp.c), sub(sp.dch, st.damper_out), sp.k)];
  }

  function gradient2(L, zs) { // numpy.gradient(L, zs, edge_order=2) for evenly spaced zs
    const n = L.length, h = zs[1] - zs[0], g = new Array(n);
    for (let i = 1; i < n - 1; i++) g[i] = (L[i + 1] - L[i - 1]) / (zs[i + 1] - zs[i - 1]);
    g[0] = (-3 * L[0] + 4 * L[1] - L[2]) / (2 * h);
    g[n - 1] = (3 * L[n - 1] - 4 * L[n - 2] + L[n - 3]) / (2 * h);
    return g;
  }

  function rideMetrics(cfg, susp, sp, rows) {
    const sc = cfg.spring, veh = cfg.vehicle, zs = rows.map(r => r.dz);
    let i0 = 0; zs.forEach((z, i) => { if (Math.abs(z) < Math.abs(zs[i0])) i0 = i; });
    const order = [...Array(rows.length - i0).keys()].map(i => i + i0).concat([...Array(i0).keys()].reverse());
    const sts = new Array(rows.length);
    let th = 0;
    for (const i of order) {
      if (i === i0 - 1) th = rad(sts[i0].rocker_deg);
      const st = sp.state(rows[i]._x, th);
      th = rad(st.rocker_deg); sts[i] = st;
    }
    const L = sts.map(s => s.damper_len), mr = gradient2(L, zs).map(v => -v);
    rows.forEach((r, i) => { r.damper_len = L[i]; r.motion_ratio = mr[i]; r.rocker_deg = sts[i].rocker_deg; r._spring = sts[i]; });
    const MR = mr[i0];
    if (MR < 1e-6) throw new SolveError("The motion ratio is zero: the damper does not move with the wheel. Check the spring geometry.");
    const ks = +sc.spring_rate, kt = +sc.tire_rate;
    const share = cfg.axle === "front" ? veh.weight_front : 1 - veh.weight_front;
    const mc = veh.mass * share / 2, ms = mc - sc.unsprung_mass;
    const kw = ks * MR * MR, kr = kw * kt / (kw + kt);
    const Lmax = Math.max(...L), Lmin = Math.min(...L), rk = sts.map(s => s.rocker_deg);
    const out = { motion_ratio: MR, mr_progression: (mr[mr.length - 1] - mr[0]) / MR * 100, wheel_rate: kw, ride_rate: kr,
      ride_freq: Math.sqrt(kr * 1000 / ms) / (2 * Math.PI), hop_freq: Math.sqrt((kw + kt) * 1000 / sc.unsprung_mass) / (2 * Math.PI),
      damper_used: Lmax - Lmin, rocker_rot: Math.max(...rk) - Math.min(...rk), static_spring_force: mc * G / MR,
      _m_sprung: ms, _m_corner: mc, _damper_len0: L[i0], _damper_len_range: [Lmin, L[i0], Lmax],
      _wheel_travel_per_stroke: sc.damper_stroke ? sc.damper_stroke / MR : null };
    if (sc.damper_stroke) {
      out.damper_margin = +sc.damper_stroke - out.damper_used;
      if (sc.damper_eye_to_eye) {
        const closed = sc.damper_eye_to_eye - sc.damper_stroke;
        out.damper_topout = sc.damper_eye_to_eye - Lmax;
        out.damper_bottomout = Lmin - closed;
        out.damper_static_pos = (sc.damper_eye_to_eye - L[i0]) / sc.damper_stroke * 100;
      }
    }
    const e = sub(sts[i0].rod_in, sts[i0].rod_out);
    out.rod_angle = deg(Math.atan2(Math.abs(e[2]), Math.hypot(e[0], e[1])));
    if (!sp.direct) {
      const ta = sts.map(st => transmissionAngles(sp, st));
      rows.forEach((r, i) => { r.trans_rod = ta[i][0]; r.trans_damper = ta[i][1]; });
      out.trans_min = Math.min(...ta.map(a => Math.min(a[0], a[1])));
      out._arm_rod = norm(perp(sub(sp.rr0, sp.c), sp.k)); out._arm_damper = norm(perp(sub(sp.rd0, sp.c), sp.k));
    }
    if (sc.target_freq_hz) {
      const krt = ms * (2 * Math.PI * sc.target_freq_hz) ** 2 / 1000;
      out.spring_for_target = krt < kt ? (krt * kt / (kt - krt)) / (MR * MR) : NaN;
    }
    return out;
  }

  // ------------------------------------------------------------------ evaluate
  function evaluate(rawCfg, opts = {}) {
    const cfg = finishConfig(rawCfg);
    const full = opts.full !== false;
    const s = new Suspension(cfg);
    const rows = s.heaveSweep(full ? undefined : 3);
    const roll = s.rollSweep(undefined, full ? undefined : 3);
    const out = { cfg, susp: s, rows, roll, metrics: summarize(rows, roll), steer: null, pack: null, spring: null, ride: null };
    const m = out.metrics;
    if (cfg.axle === "front" && opts.steer !== false) {
      out.steer = s.steerSweep(undefined, full ? undefined : 7);
      const [ack, reached] = ackermannAt(out.steer, cfg.sweep.ackermann_at_outer_deg);
      m.ackermann = ack; out.ack_reached = reached;
      const last = out.steer[out.steer.length - 1];
      if (last.outer > 1) m.turn_radius = s.WB / Math.sin(rad(last.outer)) / 1000;
      m.steer_arm = s.steerArm();
    }
    if (cfg.spring) {
      const sp = new Spring(s, cfg.spring);
      out.spring = sp; out.ride = rideMetrics(cfg, s, sp, rows);
      for (const [k, v] of Object.entries(out.ride)) if (!k.startsWith("_")) m[k] = v;
    }
    if (opts.pack !== false) {
      out.pack = s.packaging(out.spring);
      m.clearance_min = out.pack.min_clearance;
      m.clearance_margin = out.pack.min_clearance - out.pack.required;
      m.rim_margin = out.pack.rim_margin;
    }
    out.checks = checkTargets(cfg, m, out.pack);
    return out;
  }

  function checkTargets(cfg, m, pack) {
    const rows = [];
    for (const [k, [lo, hi]] of Object.entries(defaultTargets(cfg))) {
      const v = m[k];
      if (v == null || Number.isNaN(v)) { rows.push({ key: k, value: null, lo, hi, status: "n/a" }); continue; }
      const ok = (lo == null || v >= lo - 1e-9) && (hi == null || v <= hi + 1e-9);
      rows.push({ key: k, value: v, lo, hi, status: ok ? "PASS" : "FAIL" });
    }
    if (pack) {
      const [nm, [d, , , need]] = pack.min_pair;
      rows.push({ key: "link_clearance", label: `Link clearance (${nm})`, value: d, lo: need, hi: null, unit: "mm", dec: 1, status: pack.ok ? "PASS" : "FAIL" });
      rows.push({ key: "rim_margin", label: "Rim radial margin", value: pack.rim_margin, lo: 5, hi: null, unit: "mm", dec: 1, status: pack.rim_margin >= 5 ? "PASS" : "FAIL" });
    }
    return rows;
  }

  // ------------------------------------------------------------------ loads
  const MEMBERS = ["upper_front", "upper_rear", "lower_front", "lower_rear", "tie_rod", "pushrod"];

  function loadCases(cfg, susp) {
    const veh = cfg.vehicle, L = cfg.loads, W = veh.mass * G, wf = veh.weight_front, h = veh.cg_height, WB = veh.wheelbase;
    const front = cfg.axle === "front", share = front ? wf : 1 - wf;
    const lltd = L.lltd_front || wf, latShare = front ? lltd : 1 - lltd, t = susp.track;
    const info = { W, share, Fz0: W * share / 2, long_per_g: W * h / WB / 2, lat_per_g: W * h / t * latShare, lat_share: latShare, h, WB, t };
    const wheel = (ax = 0, ay = 0, side = 1) => {
      const dl = (front ? -1 : 1) * ax * info.long_per_g, dt = side * Math.abs(ay) * info.lat_per_g;
      const Fz = Math.max(0, info.Fz0 + dl + dt);
      let parts = `${info.Fz0.toFixed(0)} static`;
      if (dl) parts += ` ${dl > 0 ? "+" : "−"} ${Math.abs(dl).toFixed(0)} long.`;
      if (dt) parts += ` ${dt > 0 ? "+" : "−"} ${Math.abs(dt).toFixed(0)} lat.`;
      return [Fz, parts];
    };
    const bp = veh.brakes === "inboard" ? "c" : "cp", dp = veh.drive === "inboard" ? "c" : "cp";
    const cases = [];
    cases.push(["bump", [[[0, 0, L.bump_g * info.Fz0], "cp"]], `${L.bump_g} × static wheel load`, `${L.bump_g} × ${info.Fz0.toFixed(0)} static`]);
    for (const [side, nm] of [[1, "outer"], [-1, "inner"]]) {
      const [Fz, parts] = wheel(0, L.corner_g, side);
      cases.push([`corner ${nm}`, [[[0, 0, Fz], "cp"], [[0, -side * L.corner_g * Fz, 0], "cp"]], `${L.corner_g} g lateral, ${nm} wheel`, parts]);
    }
    { const [Fz, parts] = wheel(-L.brake_g);
      cases.push(["braking", [[[0, 0, Fz], "cp"], [[-L.brake_g * Fz, 0, 0], bp]], `${L.brake_g} g braking`, parts]); }
    const g2 = L.combined_g;
    for (const [side, nm] of [[1, "outer"], [-1, "inner"]]) {
      const [Fz, parts] = wheel(-g2, g2, side);
      cases.push([`brake+corner ${nm}`, [[[0, 0, Fz], "cp"], [[0, -side * g2 * Fz, 0], "cp"], [[-g2 * Fz, 0, 0], bp]],
        `${g2} g braking + ${g2} g lateral, ${nm} wheel`, parts]);
    }
    if (!front) {
      const [Fz, parts] = wheel(L.accel_g);
      cases.push(["acceleration", [[[0, 0, Fz], "cp"], [[L.accel_g * W / 2, 0, 0], dp]], `${L.accel_g} g acceleration (rear drive)`, parts]);
    }
    return [cases, info];
  }

  function loadGeometry(susp, sp) {
    const h = susp.h, st = sp.state([0, 0, 0, 0, 0, 0]);
    const pts = { ubj: h.ubj, lbj: h.lbj, tro: h.tro, cp: h.cp, c: susp.c0, rod_out: st.rod_out, rod_in: st.rod_in };
    const inb = { upper_front: h.uif, upper_rear: h.uir, lower_front: h.lif, lower_rear: h.lir, tie_rod: h.tri, pushrod: st.rod_in };
    const outb = { upper_front: h.ubj, upper_rear: h.ubj, lower_front: h.lbj, lower_rear: h.lbj, tie_rod: h.tro, pushrod: st.rod_out };
    return [pts, inb, outb, st];
  }

  function solveCase(susp, sp, forces) {
    const [pts, inb, outb, st] = loadGeometry(susp, sp);
    let F = [0, 0, 0], M = [0, 0, 0];
    for (const [f, p] of forces) { F = add(F, f); M = add(M, cross(pts[p], f)); }
    const e = {}; for (const k of MEMBERS) e[k] = unit(sub(inb[k], outb[k]));
    const out = {}, rhs = F.concat(M).map(v => -v);
    const colOf = (dir, at) => dir.concat(cross(at, dir));
    const T = (cols) => [0, 1, 2, 3, 4, 5].map(i => cols.map(c => c[i]));
    if (sp.on === "upright") {
      const sol = solveLinear(T(MEMBERS.map(k => colOf(e[k], outb[k]))), rhs);
      if (!sol) throw new SolveError("The link layout is singular for statics. Check the hardpoints.");
      MEMBERS.forEach((k, i) => out[k] = sol[i]); out.bending = 0;
    } else {
      const arm = sp.on, other = arm === "lower" ? "upper" : "lower", bj = arm === "lower" ? pts.lbj : pts.ubj;
      const unk = [`${other}_front`, `${other}_rear`, "tie_rod"];
      const cols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(d => colOf(d, bj)).concat(unk.map(k => colOf(e[k], outb[k])));
      const sol = solveLinear(T(cols), rhs);
      if (!sol) throw new SolveError("The link layout is singular for statics. Check the hardpoints.");
      const Fb = sol.slice(0, 3); unk.forEach((k, i) => out[k] = sol[3 + i]);
      const a = inb[`${arm}_front`], u = unit(sub(inb[`${arm}_rear`], a));
      const mbj = dot(u, cross(sub(bj, a), mul(Fb, -1))), mp = dot(u, cross(sub(pts.rod_out, a), e.pushrod));
      if (Math.abs(mp) < 1e-9) throw new SolveError("The pushrod has no lever arm about the wishbone pivot axis.");
      const Tp = -mbj / mp; out.pushrod = Tp;
      const node = add(mul(Fb, -1), mul(e.pushrod, Tp));
      const e1 = e[`${arm}_front`], e2 = e[`${arm}_rear`];
      // least squares: [e1 e2] t = -node
      const a11 = dot(e1, e1), a12 = dot(e1, e2), a22 = dot(e2, e2), b1 = -dot(e1, node), b2 = -dot(e2, node);
      const det = a11 * a22 - a12 * a12, t1 = (b1 * a22 - a12 * b2) / det, t2 = (a11 * b2 - a12 * b1) / det;
      out[`${arm}_front`] = t1; out[`${arm}_rear`] = t2;
      out.bending = norm(add(node, add(mul(e1, t1), mul(e2, t2))));
    }
    const Tp = out.pushrod;
    if (sp.direct) { out.damper = Tp; out.rocker_pivot = 0; }
    else {
      const fRod = mul(unit(sub(pts.rod_out, pts.rod_in)), Tp), ed = unit(sub(sp.dch, st.damper_out));
      const mRod = dot(sp.k, cross(sub(pts.rod_in, sp.c), fRod)), md = dot(sp.k, cross(sub(st.damper_out, sp.c), ed));
      const Td = -mRod / md; out.damper = Td; out.rocker_pivot = norm(add(fRod, mul(ed, Td)));
    }
    return out;
  }

  function tubeProps(od, wall) {
    const di = od - 2 * wall;
    return [Math.PI / 4 * (od ** 2 - di ** 2), Math.PI / 64 * (od ** 4 - di ** 4)];
  }

  function runLoads(cfg, susp, sp) {
    const [cases, info] = loadCases(cfg, susp), results = {}, desc = {}, tyre = {}, fz = {};
    for (const [name, forces, d, parts] of cases) {
      results[name] = solveCase(susp, sp, forces); desc[name] = d; fz[name] = parts;
      tyre[name] = forces.reduce((acc, [f]) => add(acc, f), [0, 0, 0]);
    }
    const mem = cfg.members, [, inb, outb] = loadGeometry(susp, sp);
    const size = { upper_front: "wishbone", upper_rear: "wishbone", lower_front: "wishbone", lower_rear: "wishbone", tie_rod: "tie_rod", pushrod: "pushrod" };
    const checks = MEMBERS.map(k => {
      const [od, wall] = mem[size[k]], [A, I] = tubeProps(od, wall), L = norm(sub(inb[k], outb[k]));
      const Pcr = Math.PI ** 2 * mem.E * I / L ** 2, Py = mem.yield * A;
      const vals = Object.entries(results).map(([n, r]) => [r[k], n]);
      const cmin = vals.reduce((m, v) => v[0] < m[0] ? v : m), tmax = vals.reduce((m, v) => v[0] > m[0] ? v : m);
      const pk = vals.reduce((m, v) => Math.abs(v[0]) > m[0] ? [Math.abs(v[0]), v[1]] : m, [-1, ""]);
      const comp = cmin[0] < 0 ? -cmin[0] : 0;
      return { member: k, size: size[k], length: L, od, wall, area: A, tension: Math.max(0, tmax[0]), t_case: tmax[1],
        compression: comp, c_case: cmin[1], Pcr, Py, peak: pk[0], p_case: pk[1],
        sf_buckle: comp > 1e-6 ? Pcr / comp : Infinity, sf_yield: pk[0] > 1e-6 ? Py / pk[0] : Infinity };
    });
    return { results, desc, tyre, fz_parts: fz, info, checks };
  }

  root.Susp = { SolveError, HP, HP_ORDER, SPRING_POINTS, DEFAULTS, SPRING_DEFAULTS, METRICS, deepMerge, finishConfig,
    defaultTargets, targetsFromFile, GENERAL_TARGETS, validate, Suspension, Spring, evaluate, runLoads, rackForAngle, MEMBERS, checkTargets,
    vec: { add, sub, mul, dot, cross, norm, unit, perp, rodrigues, matvec, deg, rad } };
})(typeof window !== "undefined" ? window : globalThis);
