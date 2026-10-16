/* 20_kinematics.js: The rigid-link solver and its sweeps, metrics, evaluate and target checks (Python: kinematics.py). */
// ------------------------------------------------------------------ kinematics
class Suspension {
  constructor(cfg) {
    this.cfg = cfg;
    const h = {};
    for (const k of HP_ORDER) h[HP[k]] = cfg.hardpoints[k].slice();
    this.h = h;
    const w = cfg.wheel,
      veh = cfg.vehicle;
    this.R = +w.tire_radius;
    this.WB = +veh.wheelbase;
    this.CG = +veh.cg_height;
    this.frontShare = +veh.front_brake_share;
    this.track = veh.track ? +veh.track : 2 * h.cp[1];
    this.axle = cfg.axle;
    this.rackDir = unit(cfg.rack_direction);
    const g = rad(w.camber_deg),
      toe = rad(w.toe_deg);
    this.a0 = unit([Math.sin(toe) * Math.cos(g), Math.cos(toe) * Math.cos(g), -Math.sin(g)]);
    const up = unit(sub([0, 0, 1], mul(this.a0, this.a0[2])));
    this.cpz0 = h.cp[2];
    this.c0 = add(h.cp, mul(up, this.R));
    this.P0 = [h.ubj, h.lbj, h.tro, this.c0];
    this.ref = this.c0.slice();
    this.tri0 = h.tri;
    this.L = [norm(sub(h.ubj, h.uif)), norm(sub(h.ubj, h.uir)), norm(sub(h.lbj, h.lif)), norm(sub(h.lbj, h.lir)), norm(sub(h.tro, h.tri))];
    this.cache = new Map();
  }
  move(x, p) {
    const Rm = rodrigues(x.slice(3));
    return add(add(matvec(Rm, sub(p, this.ref)), this.ref), x.slice(0, 3));
  }
  unpack(x) {
    const Rm = rodrigues(x.slice(3)),
      t = x.slice(0, 3);
    const P = this.P0.map(p => add(add(matvec(Rm, sub(p, this.ref)), this.ref), t));
    return [P, matvec(Rm, this.a0)];
  }
  contact(P, a) {
    const up = unit(sub([0, 0, 1], mul(a, a[2])));
    return sub(P[3], mul(up, this.R));
  }
  res(x, dz, rack) {
    const [P, a] = this.unpack(x),
      h = this.h;
    const tri = add(this.tri0, mul(this.rackDir, rack)),
      cp = this.contact(P, a);
    return [
      norm(sub(P[0], h.uif)) - this.L[0],
      norm(sub(P[0], h.uir)) - this.L[1],
      norm(sub(P[1], h.lif)) - this.L[2],
      norm(sub(P[1], h.lir)) - this.L[3],
      norm(sub(P[2], tri)) - this.L[4],
      cp[2] - (this.cpz0 + dz),
    ];
  }
  newton(x0, dz, rack, tol = 1e-9, maxit = 40) {
    let x = x0.slice(),
      r = this.res(x, dz, rack);
    const mx = v => Math.max(...v.map(Math.abs)),
      nrm = v => Math.hypot(...v);
    for (let it = 0; it < maxit; it++) {
      if (mx(r) < tol) return [x, true];
      const J = [[], [], [], [], [], []];
      for (let i = 0; i < 6; i++) {
        const xp = x.slice();
        xp[i] += 1e-6;
        const rp = this.res(xp, dz, rack);
        for (let j = 0; j < 6; j++) J[j][i] = (rp[j] - r[j]) / 1e-6;
      }
      const dx = solveLinear(
        J,
        r.map(v => -v)
      );
      if (!dx) return [x, false];
      let t = 1,
        xn,
        rn,
        ok = false;
      while (t > 1e-4) {
        xn = x.map((v, i) => v + t * dx[i]);
        rn = this.res(xn, dz, rack);
        if (nrm(rn) < nrm(r) * (1 - 1e-4 * t) || mx(rn) < tol) {
          ok = true;
          break;
        }
        t *= 0.5;
      }
      if (!ok) return [x, mx(r) < 1e-6];
      x = xn;
      r = rn;
    }
    return [x, mx(r) < 1e-6];
  }
  ramp(x, s0, s1, step = 1.5) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(s1[0] - s0[0]), Math.abs(s1[1] - s0[1])) / step));
    for (let k = 1; k <= n; k++) {
      const f = k / n,
        dz = s0[0] + (s1[0] - s0[0]) * f,
        rk = s0[1] + (s1[1] - s0[1]) * f;
      const [xn, ok] = this.newton(x, dz, rk);
      if (!ok)
        throw new SolveError(
          `No valid position at ${dz.toFixed(1)} mm travel, ${rk.toFixed(1)} mm rack. The links cannot reach it: check the hardpoints or reduce the travel/rack range.`
        );
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
    const out = new Map(),
      todo = [...new Set(dzs.map(Number))].sort((a, b) => a - b);
    for (const side of [1, -1]) {
      const seq = todo.filter(d => d * side > 0).sort((a, b) => Math.abs(a) - Math.abs(b));
      let x = [0, 0, 0, 0, 0, 0],
        z = 0;
      for (const d of seq) {
        if (this.cache.has(d)) {
          x = this.cache.get(d);
          z = d;
        } else {
          x = this.ramp(x, [z, 0], [d, 0]);
          z = d;
          this.cache.set(d, x);
        }
        out.set(d, x);
      }
    }
    if (todo.includes(0)) out.set(0, [0, 0, 0, 0, 0, 0]);
    return out;
  }
  observe(x, dz, rack = 0) {
    const [P, a] = this.unpack(x),
      [ub, lb, tro, c] = P,
      cp = this.contact(P, a),
      h = this.h;
    const d = sub(ub, lb),
      o = { dz, rack };
    o.camber = -deg(Math.asin(Math.min(1, Math.max(-1, a[2]))));
    o.toe = deg(Math.atan2(a[0], a[1]));
    o.caster = deg(Math.atan((lb[0] - ub[0]) / d[2]));
    o.kpi = deg(Math.atan((lb[1] - ub[1]) / d[2]));
    const f = (lb[2] - cp[2]) / d[2];
    o.scrub = cp[1] - (lb[1] + (lb[1] - ub[1]) * f);
    o.trail = lb[0] + (lb[0] - ub[0]) * f - cp[0];
    [o.cp_x, o.cp_y, o.cp_z] = cp;
    const [n1, d1] = plane(h.uif, h.uir, ub),
      [n2, d2] = plane(h.lif, h.lir, lb);
    const dv = cross(n1, n2);
    let pt = null,
      dvf = dv,
      dvs = dv;
    if (norm(dv) < 1e-9) {
      dvf = cross(n1, [1, 0, 0]);
      dvs = cross(n1, [0, 1, 0]);
    } else pt = solveLinear([n1, n2, dv], [d1, d2, 0]);
    let dy, dzz;
    if (pt && Math.abs(dv[0]) > 1e-9) {
      const q = add(pt, mul(dv, (cp[0] - pt[0]) / dv[0]));
      dy = q[1] - cp[1];
      dzz = q[2] - cp[2];
      o.fv_ic = [q[1], q[2]];
      o.fvsa = Math.abs(dy);
    } else {
      dy = dvf[1];
      dzz = dvf[2];
      o.fv_ic = null;
      o.fvsa = Infinity;
    }
    o.fv_line = [cp[1], cp[2], dy, dzz];
    const rc = Math.abs(dy) > 1e-12 ? (-cp[1] * dzz) / dy : NaN;
    o.roll_center = rc;
    o.roll_center_chassis = rc + cp[2];
    let sv = null;
    if (pt && Math.abs(dv[1]) > 1e-9) {
      sv = add(pt, mul(dv, (cp[1] - pt[1]) / dv[1]));
      o.sv_ic = [sv[0], sv[2]];
    } else o.sv_ic = null;
    const slopeRear = ref => (sv ? (sv[2] - ref[2]) / (ref[0] - sv[0]) : Math.abs(dvs[0]) > 1e-12 ? -dvs[2] / dvs[0] : 0);
    const veh = this.cfg.vehicle,
      k = (this.WB / this.CG) * 100;
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
    const sw = this.cfg.sweep,
      T = +(travel ?? sw.travel);
    let n = +(steps ?? sw.steps);
    if (n % 2 === 0) n++;
    const zs = Array.from({ length: n }, (_, i) => -T + (2 * T * i) / (n - 1));
    zs[(n - 1) / 2] = 0;
    const xs = this.states(zs);
    return zs.map(z => this.observe(xs.get(z), z));
  }
  rollSweep(maxDeg, steps) {
    const sw = this.cfg.sweep,
      m = +(maxDeg ?? sw.roll_deg);
    let n = +(steps ?? sw.roll_steps);
    if (n % 2 === 0) n++;
    const phis = Array.from({ length: n }, (_, i) => -m + (2 * m * i) / (n - 1));
    const t = this.h.cp[1];
    const ss = phis.map(p => t * Math.tan(rad(p)));
    ss[(n - 1) / 2] = 0;
    const xs = this.states(ss.concat(ss.map(s => -s)));
    return phis.map((phi, i) => {
      const s = ss[i],
        oo = this.observe(xs.get(s), s),
        oi = this.observe(xs.get(s ? -s : 0), -s);
      const [yR, zR, dyR, dzR] = oo.fv_line,
        [yL, zL, dyL, dzL] = oi.fv_line;
      const pR = [yR, zR],
        pL = [-yL, zL];
      const rc = lineIntersect2d(pR, [dyR, dzR], pL, [-dyL, dzL]);
      const gl = Math.hypot(pR[0] - pL[0], pR[1] - pL[1]),
        g = [(pR[0] - pL[0]) / gl, (pR[1] - pL[1]) / gl];
      const mid = [(pR[0] + pL[0]) / 2, (pR[1] + pL[1]) / 2];
      let hrc = NaN,
        yrc = NaN;
      if (rc) {
        const v = [rc[0] - mid[0], rc[1] - mid[1]];
        hrc = g[0] * v[1] - g[1] * v[0];
        yrc = g[0] * v[0] + g[1] * v[1];
      }
      return {
        roll: phi,
        dz_outer: s,
        camber_outer: oo.camber + phi,
        camber_inner: oi.camber - phi,
        toe_outer: oo.toe,
        toe_inner: oi.toe,
        rc_height: hrc,
        rc_lateral: yrc,
      };
    });
  }
  steerSweep(rackMax, steps) {
    const sw = this.cfg.sweep,
      Rm = +(rackMax ?? sw.rack_travel),
      n = +(steps ?? sw.rack_steps);
    const rs = Array.from({ length: n + 1 }, (_, i) => (Rm * i) / n);
    const base = this.observe([0, 0, 0, 0, 0, 0], 0, 0),
      cols = { 1: [base], "-1": [base] };
    for (const sgn of [1, -1]) {
      let x = [0, 0, 0, 0, 0, 0];
      for (let i = 1; i <= n; i++) {
        x = this.ramp(x, [0, sgn * rs[i - 1]], [0, sgn * rs[i]]);
        cols[sgn].push(this.observe(x, 0, sgn * rs[i]));
      }
    }
    const cot = t => 1 / Math.tan(rad(t));
    return rs.map((r, i) => {
      const a = cols[1][i],
        b = cols["-1"][i],
        fa = a.toe - base.toe,
        fb = b.toe - base.toe;
      let inner, outer, ci, co;
      if (fa < 0) {
        inner = -fa;
        outer = fb;
        ci = a.camber;
        co = b.camber;
      } else {
        inner = -fb;
        outer = fa;
        ci = b.camber;
        co = a.camber;
      }
      const ack = outer > 1 && inner > 0.5 ? (((cot(outer) - cot(inner)) * this.WB) / this.track) * 100 : NaN;
      return { rack: r, inner, outer, ackermann: ack, camber_inner: ci, camber_outer: co };
    });
  }
  grid(heaves, racks) {
    const xs = this.states(heaves),
      out = [];
    for (const hz of heaves) {
      const xh = xs.get(Number(hz));
      for (const rk of racks) out.push([hz, rk, rk ? this.ramp(xh, [hz, 0], [hz, rk]) : xh]);
    }
    return out;
  }
  steerArm() {
    const h = this.h,
      k = unit(sub(h.ubj, h.lbj));
    return norm(perp(sub(h.tro, h.lbj), k));
  }
  packaging(spring) {
    const sw = this.cfg.sweep,
      T = sw.travel,
      Rk = sw.rack_travel;
    const heaves = [-T, 0, T],
      racks = this.axle === "front" ? [-Rk, 0, Rk] : [0];
    const h = this.h,
      rimR = (this.cfg.wheel.rim_diameter_in * 25.4) / 2,
      cl = this.cfg.clearance;
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
        [`upper arm leg to pivot X=${h.uir[0].toFixed(0)}`, "upper", h.uir, p.ub],
      ];
      const checks = legs.map(([n, , s0, s1]) => [`${rod} – ${n}`, [p.tri, p.tro], [s0, s1], need("tie rod", "arm")]);
      if (spring) {
        const st = spring.state(x),
          pr = [st.rod_out, st.rod_in];
        for (const [n, arm, s0, s1] of legs) if (arm !== spring.on) checks.push([`pushrod – ${n}`, pr, [s0, s1], need("pushrod", "arm")]);
        checks.push([`pushrod – ${rod}`, pr, [p.tri, p.tro], need("pushrod", "tie rod")]);
        const mir = q => [q[0], -q[1], q[2]];
        checks.push([
          "damper – other side's damper",
          [st.damper_out, spring.dch],
          [mir(st.damper_out), mir(spring.dch)],
          (cl.damper_od ?? 55) + cl.margin,
        ]);
      }
      for (const [name, [a0, a1], [b0, b1], req] of checks) {
        const dist = segDist(a0, a1, b0, b1),
          cur = res.pairs[name];
        if (!cur || dist - req < cur[0] - cur[3]) res.pairs[name] = [dist, hz, rk, req];
      }
      for (const nm of ["ub", "lb", "tro"]) {
        const radial = norm(perp(sub(p[nm], p.c), p.a));
        if (radial > res.rim_max) {
          res.rim_max = radial;
          res.rim_where = [nm, hz, rk];
        }
      }
    }
    const wd = Object.entries(res.pairs).reduce((m, kv) => (!m || kv[1][0] - kv[1][3] < m[1][0] - m[1][3] ? kv : m), null);
    res.min_clearance = wd[1][0];
    res.required = wd[1][3];
    res.min_pair = wd;
    res.ok = wd[1][0] >= wd[1][3];
    res.rim_margin = rimR - res.rim_max;
    return res;
  }
}

function summarize(rows, roll) {
  let i0 = 0;
  rows.forEach((r, i) => {
    if (Math.abs(r.dz) < Math.abs(rows[i0].dz)) i0 = i;
  });
  const r0 = rows[i0],
    lo = rows[0],
    hi = rows[rows.length - 1],
    span = (hi.dz - lo.dz) / 25.4;
  const m = {};
  for (const k of ["camber", "toe", "caster", "kpi", "scrub", "trail", "roll_center", "fvsa"]) m[k] = r0[k];
  m.camber_gain = -(hi.camber - lo.camber) / span;
  m.bump_steer = (hi.toe - lo.toe) / span;
  m.bump_steer_max = Math.max(...rows.map(r => Math.abs(r.toe - r0.toe)));
  m.bump_steer_curve = (hi.toe + lo.toe) / 2 - r0.toe;
  const cpy = rows.map(r => r.cp_y);
  m.track_change = Math.max(...cpy) - Math.min(...cpy);
  m.rc_min = Math.min(...rows.map(r => r.roll_center));
  m.rc_max = Math.max(...rows.map(r => r.roll_center));
  for (const k of ["antidive", "antisquat", "antilift"]) if (k in r0) m[k] = r0[k];
  if (roll && roll.length) {
    const j0 = (roll.length - 1) / 2,
      a = roll[j0 - 1],
      b = roll[j0 + 1],
      dp = b.roll - a.roll;
    m.roll_camber = (b.camber_outer - a.camber_outer) / dp;
    m.roll_steer = (b.toe_outer - a.toe_outer) / dp;
    m.rc_lat = (b.rc_lateral - a.rc_lateral) / dp;
    const top = roll[roll.length - 1];
    m.roll_camber_max = top.camber_outer;
    m.rc_height_roll = top.rc_height;
    m.roll_max_deg = top.roll;
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

// ------------------------------------------------------------------ evaluate
function evaluate(rawCfg, opts = {}) {
  const cfg = finishConfig(rawCfg);
  const full = opts.full !== false;
  const s = new Suspension(cfg);
  const rows = s.heaveSweep(full ? undefined : 9); // quick: 9 points so the toe curve's bend shows
  const roll = s.rollSweep(undefined, full ? undefined : 3);
  const out = { cfg, susp: s, rows, roll, metrics: summarize(rows, roll), steer: null, pack: null, spring: null, ride: null };
  const m = out.metrics;
  if (cfg.axle === "front" && opts.steer !== false) {
    out.steer = s.steerSweep(undefined, full ? undefined : 7);
    const [ack, reached] = ackermannAt(out.steer, cfg.sweep.ackermann_at_outer_deg);
    m.ackermann = ack;
    out.ack_reached = reached;
    const last = out.steer[out.steer.length - 1];
    if (last.outer > 1) m.turn_radius = s.WB / Math.sin(rad(last.outer)) / 1000;
    m.steer_arm = s.steerArm();
  }
  if (cfg.spring) {
    const sp = new Spring(s, cfg.spring);
    out.spring = sp;
    out.ride = rideMetrics(cfg, s, sp, rows);
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
    if (v == null || Number.isNaN(v)) {
      rows.push({ key: k, value: null, lo, hi, status: "n/a" });
      continue;
    }
    const ok = (lo == null || v >= lo - 1e-9) && (hi == null || v <= hi + 1e-9);
    rows.push({ key: k, value: v, lo, hi, status: ok ? "PASS" : "FAIL" });
  }
  if (pack) {
    const [nm, [d, , , need]] = pack.min_pair;
    rows.push({
      key: "link_clearance",
      label: `Link clearance (${nm})`,
      value: d,
      lo: need,
      hi: null,
      unit: "mm",
      dec: 1,
      status: pack.ok ? "PASS" : "FAIL",
    });
    rows.push({
      key: "rim_margin",
      label: "Rim radial margin",
      value: pack.rim_margin,
      lo: 5,
      hi: null,
      unit: "mm",
      dec: 1,
      status: pack.rim_margin >= 5 ? "PASS" : "FAIL",
    });
  }
  return rows;
}
