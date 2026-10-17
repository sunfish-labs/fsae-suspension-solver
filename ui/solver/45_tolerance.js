// ---------------------------------------------------------------- build tolerance (mirrors susp/tools/tolerance.py)
const TOL_METRICS = [
  "roll_center",
  "rc_lat",
  "camber_gain",
  "bump_steer",
  "bump_steer_max",
  "caster",
  "kpi",
  "scrub",
  "trail",
  "antidive",
  "antisquat",
  "motion_ratio",
  "ride_freq",
];
const TOL_SHIMMED = ["bump_steer", "bump_steer_max"];
const TOL_CAP = 10;
function tolPoints(cfg) {
  const pts = HP_ORDER.filter(p => p !== "contact_patch");
  if (cfg.spring) for (const k of ["rocker_pivot", "damper_chassis"]) if (cfg.spring[k] != null) pts.push(`spring.${k}`);
  return pts;
}
const tolWhere = p => (p.endsWith("outboard") && !p.startsWith("spring.") ? "upright" : "chassis");
const tolRef = (c, p) => (p.startsWith("spring.") ? c.spring[p.slice(7)] : c.hardpoints[p]);
const tolClass = a => (a < 0.5 ? "precise jig" : a < 1 ? "jig" : a < 2 ? "jig, some slack" : "shop tolerance");
function tolerance(rawCfg, tol = 1) {
  const q = c => evaluate(c, { full: false, steer: false, pack: false });
  const e0 = q(rawCfg),
    cfg0 = e0.cfg,
    base = e0.metrics,
    tg = defaultTargets(cfg0),
    keys = TOL_METRICS.filter(k => k in tg && base[k] != null);
  const effects = [];
  for (const p of tolPoints(cfg0))
    for (let i = 0; i < 3; i++) {
      let eff = Object.fromEntries(keys.map(k => [k, 0]));
      for (const s of [1, -1]) {
        const c = JSON.parse(JSON.stringify(cfg0));
        tolRef(c, p)[i] += s * tol;
        let m;
        try {
          m = q(c).metrics;
        } catch (x) {
          if (!(x instanceof SolveError)) throw x;
          eff = Object.fromEntries(keys.map(k => [k, Infinity]));
          break;
        }
        for (const k of keys) if (m[k] != null) eff[k] = Math.max(eff[k], Math.abs(m[k] - base[k]));
      }
      effects.push([p, "xyz"[i], eff]);
    }
  const metrics = keys.map(k => {
    const [lo, hi] = tg[k],
      v = base[k],
      margin = Math.max(0, Math.min(lo != null ? v - lo : Infinity, hi != null ? hi - v : Infinity)),
      es = effects.map(e => e[2][k]),
      big = es.length ? Math.max(...es) : 0,
      n = big > 0 ? es.filter(x => x > 0.05 * big).length : 0;
    return {
      key: k,
      value: v,
      lo,
      hi,
      margin,
      rss: Math.sqrt(es.reduce((a, x) => a + x * x, 0)),
      worst: es.reduce((a, x) => a + x, 0),
      n: Math.max(n, 1),
    };
  });
  const by = Object.fromEntries(metrics.map(m => [m.key, m]));
  const allow = (eff, skip = []) => {
    let best = Infinity,
      limit = null;
    for (const [k, e] of Object.entries(eff)) {
      if (e <= 1e-12 || skip.includes(k)) continue;
      const a = (tol * by[k].margin) / (e * Math.sqrt(by[k].n));
      if (a < best) [best, limit] = [a, k];
    }
    return [best, limit];
  };
  const coords = effects.map(([p, ax, eff]) => {
    const [allowed, limit] = allow(eff),
      [shim, limitShim] = allow(eff, TOL_SHIMMED);
    return { point: p, axis: ax, where: tolWhere(p), allowed, limit, allowed_shim: shim, limit_shim: limitShim, effects: eff };
  });
  return { tol, metrics, coords };
}
