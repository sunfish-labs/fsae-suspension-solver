/* 30_ride.js: Pushrod, rocker and damper; motion ratio, ride and damping (Python: ride.py). */
// ------------------------------------------------------------------ spring / rocker / damper
const G = 9.81;
class Spring {
  constructor(susp, sc) {
    this.s = susp;
    this.sc = sc;
    const h = susp.h;
    this.on = sc.rod_on;
    this.p0 = sc.rod_outboard.slice();
    this.dch = sc.damper_chassis.slice();
    this.direct = sc.rocker_pivot == null;
    if (this.on === "lower") {
      this.piv = [h.lif, h.lir];
      this.bj_i = 1;
    } else if (this.on === "upper") {
      this.piv = [h.uif, h.uir];
      this.bj_i = 0;
    }
    if (!this.direct) {
      this.c = sc.rocker_pivot.slice();
      this.k = unit(sc.rocker_axis);
      this.rr0 = sc.rocker_rod.slice();
      this.rd0 = sc.rocker_damper.slice();
      this.Lrod = norm(sub(this.rr0, this.p0));
    }
    this.bj0 = this.on !== "upright" ? susp.P0[this.bj_i] : null;
  }
  rodOut(x) {
    if (this.on === "upright") return this.s.move(x, this.p0);
    const [P] = this.s.unpack(x),
      [a, b] = this.piv,
      u = unit(sub(b, a));
    const v0 = perp(sub(this.bj0, a), u),
      v1 = perp(sub(P[this.bj_i], a), u);
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
    const f = th => norm(sub(this.rockerAt(th)[0], p)) - this.Lrod;
    let th = th0,
      done = false;
    for (let i = 0; i < 50; i++) {
      const r = f(th);
      if (Math.abs(r) < 1e-10) {
        done = true;
        break;
      }
      const d = (f(th + 1e-7) - r) / 1e-7;
      if (Math.abs(d) < 1e-12)
        throw new SolveError("The rocker is at a toggle point (the rod points through the pivot). Move the rocker's rod point.");
      th -= Math.max(-0.2, Math.min(0.2, r / d));
    }
    if (!done && Math.abs(f(th)) > 1e-6)
      throw new SolveError("The rocker position could not be solved: the pushrod cannot reach the rocker here.");
    const [rr, rd] = this.rockerAt(th);
    return { rod_out: p, rod_in: rr, damper_out: rd, damper_len: norm(sub(rd, this.dch)), rocker_deg: deg(th) };
  }
}

// ---- the spring as fitted (mirrors ride.spring_rate_at / spring_nonlinear / wheel_travel_under)
function springRateAt(sc, x) {
  let k = +sc.spring_rate;
  if (sc.spring_rate2 != null && sc.spring_breakpoint != null && x > +sc.spring_breakpoint) k = +sc.spring_rate2;
  const g = sc.bumpstop_gap;
  if (g != null && x > +g) k += +(sc.bumpstop_k || 0) + 2 * +(sc.bumpstop_k2 || 0) * (x - +g);
  return k;
}
const springNonlinear = sc => (sc.spring_rate2 != null && sc.spring_breakpoint != null) || sc.bumpstop_gap != null;
function wheelTravelUnder(cfg, susp, sp, dF, zmax) {
  if (dF <= 0) return 0;
  const n = Math.max(1, Math.ceil(zmax / 1)),
    zs = [...Array(n + 1).keys()].map(i => (zmax * i) / n),
    xs = susp.states(zs),
    L = [];
  let th = 0;
  for (const z of zs) {
    const st = sp.state(xs.get(Number(z)), th);
    th = rad(st.rocker_deg);
    L.push(st.damper_len);
  }
  let F = 0;
  for (let j = 0; j < n; j++) {
    const x0 = L[0] - L[j],
      x1 = L[0] - L[j + 1],
      dz = zs[j + 1] - zs[j],
      df = (springRateAt(cfg.spring, (x0 + x1) / 2) * (x1 - x0) ** 2) / dz;
    if (F + df >= dF) return df > 0 ? zs[j] + ((dF - F) / df) * dz : zs[j];
    F += df;
  }
  return zmax;
}
// ---- anti-roll bar driven by its own drop link (mirrors ride.ArbLink / arb_metrics)
class ArbLink {
  constructor(susp, sp, a) {
    const h = susp.h;
    this.s = susp;
    this.sp = sp;
    this.on = a.link_on || "lower";
    this.p0 = a.link_outboard.map(Number);
    this.t0 = a.arm_tip.map(Number);
    this.c = a.bar_pivot.map(Number);
    this.k = unit((a.bar_axis || [0, 1, 0]).map(Number));
    this.L = norm(sub(this.t0, this.p0));
    if (this.on === "lower" || this.on === "upper") {
      this.piv = this.on === "lower" ? [h.lif, h.lir] : [h.uif, h.uir];
      this.bj_i = this.on === "lower" ? 1 : 0;
      this.bj0 = susp.P0[this.bj_i];
    }
  }
  linkOut(x, st) {
    if (this.on === "upright") return this.s.move(x, this.p0);
    if (this.on === "rocker") return add(this.sp.c, matvec(rodrigues(mul(this.sp.k, rad(st.rocker_deg))), sub(this.p0, this.sp.c)));
    const [P] = this.s.unpack(x),
      [a, b] = this.piv,
      u = unit(sub(b, a)),
      v0 = perp(sub(this.bj0, a), u),
      v1 = perp(sub(P[this.bj_i], a), u);
    return add(a, matvec(rodrigues(mul(u, Math.atan2(dot(u, cross(v0, v1)), dot(v0, v1)))), sub(this.p0, a)));
  }
  theta(x, st, th0 = 0) {
    const p = this.linkOut(x, st),
      f = th => norm(sub(add(this.c, matvec(rodrigues(mul(this.k, th)), sub(this.t0, this.c))), p)) - this.L;
    let th = th0;
    for (let i = 0; i < 50; i++) {
      const r = f(th);
      if (Math.abs(r) < 1e-10) return th;
      const d = (f(th + 1e-7) - r) / 1e-7;
      if (Math.abs(d) < 1e-12) throw new SolveError("The anti-roll bar's drop link points through the bar axis (toggle). Move arm_tip.");
      th -= Math.max(-0.2, Math.min(0.2, r / d));
    }
    if (Math.abs(f(th)) > 1e-6) throw new SolveError("The anti-roll bar's drop link cannot reach the bar arm here.");
    return th;
  }
}
function arbMetrics(cfg, susp, sp, rows, sts, zs, i0) {
  const a = cfg.arb,
    bar = new ArbLink(susp, sp, a),
    order = [...Array(rows.length - i0).keys()].map(i => i + i0).concat([...Array(i0).keys()].reverse()),
    ths = new Array(rows.length);
  let th = 0;
  for (const i of order) {
    if (i === i0 - 1) th = ths[i0];
    th = bar.theta(rows[i]._x, sts[i], th);
    ths[i] = th;
  }
  const dth = gradient2(ths, zs),
    tp = Math.abs(dth[i0]),
    od = +a.bar_od,
    di = a.bar_wall ? Math.max(0, od - 2 * a.bar_wall) : 0,
    J = (Math.PI / 32) * (od ** 4 - di ** 4),
    Lb = +(a.bar_length || 2 * Math.abs(a.arm_tip[1])),
    Gm = +(a.bar_G || 79300),
    Kt = (Gm * J) / Lb,
    kw = 2 * Kt * tp * tp,
    t = susp.track,
    twist = 2 * tp * (t / 2) * Math.tan(rad(+cfg.sweep.roll_deg)),
    tau = (Gm * twist * od) / 2 / Lb,
    yld = +(a.bar_yield || cfg.members.yield);
  rows.forEach((r, i) => (r.arb_deg = deg(ths[i])));
  return {
    arb_twist: deg(tp),
    arb_wheel_rate: kw,
    arb_roll: ((kw * 1000 * (t / 1000) ** 2) / 2) * (Math.PI / 180),
    arb_tau: tau,
    arb_fos: tau > 0 ? (0.577 * yld) / tau : Infinity,
    arb_progression: tp > 0 ? ((Math.abs(dth[dth.length - 1]) - Math.abs(dth[0])) / tp) * 100 : 0,
  };
}

function angleToArm(arm, force, k) {
  const a = perp(arm, k),
    f = perp(force, k),
    na = norm(a),
    nf = norm(f);
  if (na < 1e-9 || nf < 1e-9) return 0;
  return deg(Math.acos(Math.min(1, Math.abs(dot(a, f)) / (na * nf))));
}
function transmissionAngles(sp, st) {
  return [
    angleToArm(sub(st.rod_in, sp.c), sub(st.rod_in, st.rod_out), sp.k),
    angleToArm(sub(st.damper_out, sp.c), sub(sp.dch, st.damper_out), sp.k),
  ];
}

function gradient2(L, zs) {
  // numpy.gradient(L, zs, edge_order=2), also for uneven spacing (bump and droop travel can differ)
  const n = L.length,
    g = new Array(n);
  for (let i = 1; i < n - 1; i++) {
    const hd = zs[i] - zs[i - 1],
      hs = zs[i + 1] - zs[i];
    g[i] = (hd * hd * L[i + 1] + (hs * hs - hd * hd) * L[i] - hs * hs * L[i - 1]) / (hs * hd * (hd + hs));
  }
  let d1 = zs[1] - zs[0],
    d2 = zs[2] - zs[1];
  g[0] = (-(2 * d1 + d2) / (d1 * (d1 + d2))) * L[0] + ((d1 + d2) / (d1 * d2)) * L[1] - (d1 / (d2 * (d1 + d2))) * L[2];
  d1 = zs[n - 2] - zs[n - 3];
  d2 = zs[n - 1] - zs[n - 2];
  g[n - 1] = (d2 / (d1 * (d1 + d2))) * L[n - 3] - ((d2 + d1) / (d1 * d2)) * L[n - 2] + ((2 * d2 + d1) / (d2 * (d1 + d2))) * L[n - 1];
  return g;
}
// mirrors ride.aero_sag: travel where the spring has taken the downforce F, ride-height loss and the frequency there
function aeroSag(F, zs, kwRows, kt, ms, i0) {
  const zUp = zs.slice(i0),
    kw = kwRows.slice(i0);
  let force = 0,
    zAt = zUp[zUp.length - 1],
    kwAt = kw[kw.length - 1];
  for (let j = 1; j < zUp.length; j++) {
    const df = ((kw[j - 1] + kw[j]) / 2) * (zUp[j] - zUp[j - 1]);
    if (force + df >= F) {
      const t = df > 0 ? (F - force) / df : 0;
      zAt = zUp[j - 1] + t * (zUp[j] - zUp[j - 1]);
      kwAt = kw[j - 1] + t * (kw[j] - kw[j - 1]);
      break;
    }
    force += df;
  }
  const kr = (kwAt * kt) / (kwAt + kt);
  return { aero_sag: zAt + F / kt, ride_freq_aero: Math.sqrt((kr * 1000) / ms) / (2 * Math.PI), _aero_travel: zAt };
}

function rideMetrics(cfg, susp, sp, rows) {
  const sc = cfg.spring,
    veh = cfg.vehicle,
    zs = rows.map(r => r.dz);
  let i0 = 0;
  zs.forEach((z, i) => {
    if (Math.abs(z) < Math.abs(zs[i0])) i0 = i;
  });
  const order = [...Array(rows.length - i0).keys()].map(i => i + i0).concat([...Array(i0).keys()].reverse());
  const sts = new Array(rows.length);
  let th = 0;
  for (const i of order) {
    if (i === i0 - 1) th = rad(sts[i0].rocker_deg);
    const st = sp.state(rows[i]._x, th);
    th = rad(st.rocker_deg);
    sts[i] = st;
  }
  const L = sts.map(s => s.damper_len),
    mr = gradient2(L, zs).map(v => -v);
  rows.forEach((r, i) => {
    r.damper_len = L[i];
    r.motion_ratio = mr[i];
    r.rocker_deg = sts[i].rocker_deg;
    r._spring = sts[i];
  });
  const MR = mr[i0],
    xd = L.map(v => L[i0] - v),
    kwRows = xd.map((x, i) => springRateAt(sc, x) * mr[i] * mr[i]);
  rows.forEach((r, i) => (r.wheel_rate = kwRows[i]));
  if (MR < 1e-6) throw new SolveError("The motion ratio is zero: the damper does not move with the wheel. Check the spring geometry.");
  const ks = springRateAt(sc, 0),
    kt = +sc.tire_rate;
  const share = cfg.axle === "front" ? veh.weight_front : 1 - veh.weight_front;
  const mc = (veh.mass * share) / 2,
    ms = mc - sc.unsprung_mass;
  const kw = ks * MR * MR,
    kr = (kw * kt) / (kw + kt);
  const Lmax = Math.max(...L),
    Lmin = Math.min(...L),
    rk = sts.map(s => s.rocker_deg);
  const out = {
    motion_ratio: MR,
    mr_progression: ((mr[mr.length - 1] - mr[0]) / MR) * 100,
    wheel_rate: kw,
    ride_rate: kr,
    ride_freq: Math.sqrt((kr * 1000) / ms) / (2 * Math.PI),
    hop_freq: Math.sqrt(((kw + kt) * 1000) / sc.unsprung_mass) / (2 * Math.PI),
    damper_used: Lmax - Lmin,
    rocker_rot: Math.max(...rk) - Math.min(...rk),
    static_spring_force: (ms * G) / MR,
    _m_sprung: ms,
    _m_corner: mc,
    _damper_len0: L[i0],
    _damper_len_range: [Lmin, L[i0], Lmax],
    _wheel_travel_per_stroke: sc.damper_stroke ? sc.damper_stroke / MR : null,
  };
  if (sc.damper_stroke) {
    out.damper_margin = +sc.damper_stroke - out.damper_used;
    if (sc.damper_eye_to_eye) {
      const closed = sc.damper_eye_to_eye - sc.damper_stroke;
      out.damper_topout = sc.damper_eye_to_eye - Lmax;
      out.damper_bottomout = Lmin - closed;
      out.damper_static_pos = ((sc.damper_eye_to_eye - L[i0]) / sc.damper_stroke) * 100;
    }
  }
  const e = sub(sts[i0].rod_in, sts[i0].rod_out);
  out.rod_angle = deg(Math.atan2(Math.abs(e[2]), Math.hypot(e[0], e[1])));
  if (!sp.direct) {
    const ta = sts.map(st => transmissionAngles(sp, st));
    rows.forEach((r, i) => {
      r.trans_rod = ta[i][0];
      r.trans_damper = ta[i][1];
    });
    out.trans_min = Math.min(...ta.map(a => Math.min(a[0], a[1])));
    out._arm_rod = norm(perp(sub(sp.rr0, sp.c), sp.k));
    out._arm_damper = norm(perp(sub(sp.rd0, sp.c), sp.k));
  }
  if (sc.target_freq_hz) {
    const krt = (ms * (2 * Math.PI * sc.target_freq_hz) ** 2) / 1000;
    out.spring_for_target = krt < kt ? (krt * kt) / (kt - krt) / (MR * MR) : NaN;
  }
  Object.assign(out, damping(sc, MR, kw, kr, kt, ms));
  out.wheel_rate_bump = kwRows[kwRows.length - 1];
  // mirrors ride_metrics: the wheel rate with the spring's static force x the motion ratio's change (dF/dz exactly)
  out.wheel_rate_preload = kw + out.static_spring_force * gradient2(mr, zs)[i0];
  if (sc.bumpstop_gap != null) {
    const g = +sc.bumpstop_gap;
    if (g <= 0) out.bumpstop_travel = 0;
    else
      for (let j = i0; j < rows.length - 1; j++)
        if (xd[j + 1] >= g && g > xd[j]) {
          out.bumpstop_travel = zs[j] + ((g - xd[j]) / (xd[j + 1] - xd[j])) * (zs[j + 1] - zs[j]);
          break;
        }
  }
  const aero = veh[cfg.axle === "front" ? "aero_front" : "aero_rear"];
  if (aero) Object.assign(out, aeroSag(aero / 2, zs, kwRows, kt, ms, i0));
  if (cfg.arb) Object.assign(out, arbMetrics(cfg, susp, sp, rows, sts, zs, i0));
  return out;
}
// mirrors ride.damping: damper c (N per m/s at the shaft) acts at the wheel as c MR^2
function damping(sc, MR, kw, kr, kt, ms) {
  const mu = +sc.unsprung_mass,
    cc = 2 * Math.sqrt(kr * 1000 * ms),
    ch = 2 * Math.sqrt((kw + kt) * 1000 * mu);
  const zl = +(sc.target_zeta_low || 0.7),
    zh = +(sc.target_zeta_high || 0.35);
  const out = { c_crit: cc, c_crit_hop: ch, damper_c_low_target: (zl * cc) / (MR * MR), damper_c_high_target: (zh * cc) / (MR * MR) };
  for (const [k, n] of [
    ["damper_bump_low", "zeta_bump_low"],
    ["damper_rebound_low", "zeta_rebound_low"],
    ["damper_bump_high", "zeta_bump_high"],
    ["damper_rebound_high", "zeta_rebound_high"],
  ])
    if (sc[k]) out[n] = (+sc[k] * MR * MR) / cc;
  if (sc.damper_bump_high) out.zeta_hop = (+sc.damper_bump_high * MR * MR) / ch;
  return out;
}
