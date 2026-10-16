/* 50_car.js: Whole-car roll balance (Python: car.py). */
// ---------------------------------------------------------------- whole car (mirrors ride.car_balance)
const CAR_TARGETS = SCHEMA.targets.car;
const CAR_LABELS = Object.fromEntries(Object.entries(SCHEMA.metrics.car).map(([k, d]) => [k, [d.label, d.unit, d.decimals]]));
// mirrors car.axle_limit: lateral g where an axle saturates, with load-sensitive tires
function axleLimit(mu, k, c, F0) {
  const q = mu * k * (c / F0) ** 2;
  let ay = q < 1e-15 ? mu : (-1 + Math.sqrt(1 + 4 * mu * q)) / (2 * q);
  if (c * ay > F0) ay = mu * (1 - k);
  return ay;
}
function carBalance(fcfg, fev, rcfg, rev, o = {}) {
  const G = 9.81,
    veh = fcfg.vehicle,
    m = veh.mass,
    wf = veh.weight_front,
    h = veh.cg_height / 1000,
    WB = veh.wheelbase / 1000;
  const fr = fev.ride,
    rr = rev.ride,
    muf = 2 * fcfg.spring.unsprung_mass,
    mur = 2 * rcfg.spring.unsprung_mass;
  const Rf = fev.susp.R / 1000,
    Rr = rev.susp.R / 1000,
    tf = fev.susp.track / 1000,
    tr = rev.susp.track / 1000;
  const ms = m - muf - mur,
    msf = m * wf - muf,
    msr = m * (1 - wf) - mur,
    hs = (m * h - muf * Rf - mur * Rr) / ms;
  const zrf = fev.metrics.roll_center / 1000,
    zrr = rev.metrics.roll_center / 1000,
    a_s = (WB * msr) / ms;
  const z_ra = zrf + ((zrr - zrf) * a_s) / WB,
    d = hs - z_ra,
    dg = Math.PI / 180;
  const series = (a, b) => (a > 0 && b > 0 ? 1 / (1 / a + 1 / b) : 0),
    rollK = (k, t) => ((k * 1000 * t * t) / 2) * dg;
  // a corner with an arb linkage block uses the bar stiffness from its geometry
  const srcF = fr.arb_roll != null ? "geometry" : "input",
    srcR = rr.arb_roll != null ? "geometry" : "input",
    arbF = fr.arb_roll != null ? fr.arb_roll : o.arbF || 0,
    arbR = rr.arb_roll != null ? rr.arb_roll : o.arbR || 0;
  const Ksf = rollK(fr.wheel_rate, tf),
    Ksr = rollK(rr.wheel_rate, tr),
    Ktf = rollK(fcfg.spring.tire_rate, tf),
    Ktr = rollK(rcfg.spring.tire_rate, tr);
  const Kf = series(Ksf + arbF, Ktf),
    Kr = series(Ksr + arbR, Ktr),
    grad = (ms * G * d) / (Kf + Kr);
  const transfer = lam => [
    (ms * G * d * lam + msf * G * zrf + muf * G * Rf) / tf,
    (ms * G * d * (1 - lam) + msr * G * zrr + mur * G * Rr) / tr,
  ];
  const [dF, dR] = transfer(Kf / (Kf + Kr)),
    lltd = (dF * tf) / (dF * tf + dR * tr);
  const out = {
    ms,
    hs: hs * 1000,
    z_ra: z_ra * 1000,
    arm: d * 1000,
    Kf,
    Kr,
    Ksf,
    Ksr,
    Ktf,
    Ktr,
    arb_in_f: arbF,
    arb_in_r: arbR,
    arb_src_f: srcF,
    arb_src_r: srcR,
    grad,
    lltd,
    freq_f: fr.ride_freq,
    freq_r: rr.ride_freq,
    wf,
    dFz_f: dF,
    dFz_r: dR,
    rc_f: zrf * 1000,
    rc_r: zrr * 1000,
    geo_f: (msf * G * zrf + muf * G * Rf) / tf,
    geo_r: (msr * G * zrr + mur * G * Rr) / tr,
  };
  // tire load sensitivity (mirrors car.car_balance): each axle's lateral limit and the LLTD that equalizes them
  const ks = veh.tire_load_sens;
  if (ks != null) {
    const mu = +(veh.tire_mu || 1.5),
      F0f = (m * wf * G) / 2,
      F0r = (m * (1 - wf) * G) / 2;
    out.tire_mu = mu;
    out.tire_load_sens = +ks;
    out.ay_lim_f = axleLimit(mu, +ks, dF, F0f);
    out.ay_lim_r = axleLimit(mu, +ks, dR, F0r);
    out.limit_balance = out.ay_lim_r - out.ay_lim_f; // + : the front lets go first (understeer)
    out.grip_loss_f = (1 - out.ay_lim_f / mu) * 100;
    out.grip_loss_r = (1 - out.ay_lim_r / mu) * 100;
    const a1 = (ms * G * d) / tf / F0f,
      b1 = (msf * G * zrf + muf * G * Rf) / tf / F0f,
      a2 = (-ms * G * d) / tr / F0r,
      b2 = (ms * G * d + msr * G * zrr + mur * G * Rr) / tr / F0r;
    if (Math.abs(a1 - a2) > 1e-12) {
      const [dFn, dRn] = transfer((b2 - b1) / (a1 - a2));
      out.lltd_neutral = (dFn * tf) / (dFn * tf + dRn * tr);
    }
  }
  const tg = o.targetGrad || 1.0,
    tl = o.targetLltd || wf + 0.05,
    K_need = (ms * G * d) / tg;
  const a_ = ms * G * d,
    b_ = msf * G * zrf + muf * G * Rf,
    e_ = msr * G * zrr + mur * G * Rr;
  const lam = Math.abs(a_) > 1e-9 ? (tl * (a_ + b_ + e_) - b_) / a_ : NaN,
    lam_c = Math.min(1, Math.max(0, lam));
  const barFor = (K, Ks, Kt) => (K >= Kt ? Infinity : 1 / (1 / K - 1 / Kt) - Ks);
  Object.assign(out, {
    target_grad: tg,
    target_lltd: tl,
    K_need,
    lam,
    lam_c,
    arb_f: barFor(lam_c * K_need, Ksf, Ktf),
    arb_r: barFor((1 - lam_c) * K_need, Ksr, Ktr),
  });
  const lam0 = Kf / (Kf + Kr);
  if (lam_c > lam0 + 1e-9 && lam_c < 1) out.lltd_fix = ["front", barFor((lam_c / (1 - lam_c)) * Kr, Ksf, Ktf) - arbF];
  else if (lam_c < lam0 - 1e-9 && lam_c > 0) out.lltd_fix = ["rear", barFor(((1 - lam_c) / lam_c) * Kf, Ksr, Ktr) - arbR];
  const t = Object.assign({}, CAR_TARGETS, o.targets || {});
  const vals = { roll_gradient: grad, lltd_vs_weight: (lltd - wf) * 100, freq_ratio: rr.ride_freq / fr.ride_freq };
  out.checks = ["roll_gradient", "lltd_vs_weight", "freq_ratio"].map(k => ({
    key: k,
    value: vals[k],
    lo: t[k][0],
    hi: t[k][1],
    status: (t[k][0] == null || vals[k] >= t[k][0]) && (t[k][1] == null || vals[k] <= t[k][1]) ? "PASS" : "FAIL",
  }));
  return out;
}
