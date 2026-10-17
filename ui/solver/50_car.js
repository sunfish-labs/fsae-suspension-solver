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
// roll with a frame of torsional stiffness Kc between the axles (mirrors car.flex_roll)
function flexRoll(A, aFront, Kf, Kr, gf, gr, Kc) {
  const Af = A * aFront,
    Ar = A * (1 - aFront),
    [pf, pr] = solveLinear(
      [
        [Kf + Kc, -Kc],
        [-Kc, Kr + Kc],
      ],
      [Af + Kf * gf, Ar + Kr * gr]
    );
  return [aFront * pf + (1 - aFront) * pr, pf - pr, Kf * (pf - gf), Kr * (pr - gr)];
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
    Kr = series(Ksr + arbR, Ktr);
  // body roll includes the tires squashing under the whole transfer, the geometric part too (mirrors car.py)
  const A = ms * G * d,
    Gf = msf * G * zrf + muf * G * Rf,
    Gr = msr * G * zrr + mur * G * Rr,
    gf = Gf / Ktf,
    gr = Gr / Ktr;
  let grad = (A + Kf * gf + Kr * gr) / (Kf + Kr),
    Ef = Kf * (grad - gf),
    Er = Kr * (grad - gr);
  let dF = (Ef + Gf) / tf,
    dR = (Er + Gr) / tr,
    lltd = (dF * tf) / (dF * tf + dR * tr);
  const lltdRigid = lltd,
    Kc = veh.frame_k ? +veh.frame_k : null;
  let twist = 0;
  if (Kc) {
    [grad, twist, Ef, Er] = flexRoll(A, msf / ms, Kf, Kr, gf, gr, Kc);
    dF = (Ef + Gf) / tf;
    dR = (Er + Gr) / tr;
    lltd = (dF * tf) / (dF * tf + dR * tr);
  }
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
    K_warp: Kf + Kr > 0 ? (Kf * Kr) / (Kf + Kr) : 0, // twist test on corner scales
    roll_susp_f: Ksf + arbF > 0 ? Ef / (Ksf + arbF) : NaN,
    roll_susp_r: Ksr + arbR > 0 ? Er / (Ksr + arbR) : NaN,
    freq_f: fr.ride_freq,
    freq_r: rr.ride_freq,
    wf,
    dFz_f: dF,
    dFz_r: dR,
    rc_f: zrf * 1000,
    rc_r: zrr * 1000,
    geo_f: Gf / tf,
    geo_r: Gr / tr,
    frame_k: Kc,
    lltd_rigid: lltdRigid,
    frame_twist: twist,
  };
  if (Kc) {
    out.frame_ratio = Kc / (Kf + Kr);
    const lltdWith = (dk, kc) => {
      const Kf2 = series(Ksf + arbF + dk, Ktf);
      let eF, eR;
      if (kc == null) {
        const g2 = (A + Kf2 * gf + Kr * gr) / (Kf2 + Kr);
        [eF, eR] = [Kf2 * (g2 - gf), Kr * (g2 - gr)];
      } else [, , eF, eR] = flexRoll(A, msf / ms, Kf2, Kr, gf, gr, kc);
      const a_ = (eF + Gf) / tf,
        b_ = (eR + Gr) / tr;
      return (a_ * tf) / (a_ * tf + b_ * tr);
    };
    const dR0 = lltdWith(10, null) - lltdWith(0, null),
      dF0 = lltdWith(10, Kc) - lltdWith(0, Kc);
    out.frame_bar_effect = Math.abs(dR0) > 1e-12 ? dF0 / dR0 : 1;
  }
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
    out.lltd_neutral = (tf * F0f) / (tf * F0f + tr * F0r); // dF / F0f = dR / F0r, dF tf + dR tr = m g h
  }
  const tg = o.targetGrad || 1.0,
    tl = o.targetLltd || wf + 0.05;
  const lam = Math.abs(A) > 1e-9 ? (tl * (A + Gf + Gr) - Gf) / A : NaN,
    lam_c = Math.min(1, Math.max(0, lam)),
    Efn = lam_c * A,
    Ern = (1 - lam_c) * A;
  const need = (E, g) => (tg > g ? E / (tg - g) : Infinity),
    Kfn = need(Efn, gf),
    Krn = need(Ern, gr);
  const barFor = (K, Ks, Kt) => (K >= Kt ? Infinity : 1 / (1 / K - 1 / Kt) - Ks);
  Object.assign(out, {
    target_grad: tg,
    target_lltd: tl,
    K_need: Kfn + Krn,
    lam,
    lam_c,
    arb_f: barFor(Kfn, Ksf, Ktf),
    arb_r: barFor(Krn, Ksr, Ktr),
  });
  const lam0 = Math.abs(A) > 1e-9 ? Ef / A : 0.5;
  if (lam_c > lam0 + 1e-9 && lam_c < 1) {
    const den = A + Kr * (gr - gf) - Efn;
    if (den > 0) out.lltd_fix = ["front", barFor((Efn * Kr) / den, Ksf, Ktf) - arbF];
  } else if (lam_c < lam0 - 1e-9 && lam_c > 0) {
    const den = A + Kf * (gf - gr) - Ern;
    if (den > 0) out.lltd_fix = ["rear", barFor((Ern * Kf) / den, Ksr, Ktr) - arbR];
  }
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
