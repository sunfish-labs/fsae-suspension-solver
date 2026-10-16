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
function aeroSag(F, zs, mr, ks, kt, ms, i0) {
  const zUp = zs.slice(i0),
    kw = mr.slice(i0).map(m => ks * m * m);
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
  const MR = mr[i0];
  if (MR < 1e-6) throw new SolveError("The motion ratio is zero: the damper does not move with the wheel. Check the spring geometry.");
  const ks = +sc.spring_rate,
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
  const aero = veh[cfg.axle === "front" ? "aero_front" : "aero_rear"];
  if (aero) Object.assign(out, aeroSag(aero / 2, zs, mr, ks, kt, ms, i0));
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
