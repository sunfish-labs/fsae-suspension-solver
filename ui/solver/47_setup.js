// ---------------------------------------------------------------- setup sheet values (mirrors susp/setup.py)
const THREADS = {
  "3/8-24 UNF": 25.4 / 24,
  "5/16-24 UNF": 25.4 / 24,
  "1/4-28 UNF": 25.4 / 28,
  "M8x1.25": 1.25,
  "M10x1.25": 1.25,
  "M10x1.5": 1.5,
};
function setupValues(cfg, ev) {
  const s = ev.susp,
    m = ev.metrics,
    h = s.h,
    kp = sub(h.ubj, h.lbj),
    u = unit(kp),
    arm = norm(cross(sub(h.tro, h.lbj), u)),
    veh = cfg.vehicle,
    share = cfg.axle === "front" ? +veh.weight_front : 1 - +veh.weight_front;
  const out = {
    axle: cfg.axle,
    camber: m.camber,
    toe: m.toe,
    caster: m.caster,
    kpi: m.kpi,
    corner_kg: (+veh.mass * share) / 2,
    tie_rod_len: norm(sub(h.tro, h.tri)),
    camber_per_mm: deg(1 / norm(kp)),
    toe_per_mm: deg(1 / arm),
    steer_arm: arm,
  };
  const sp = ev.spring;
  if (sp) {
    const st = sp.state([0, 0, 0, 0, 0, 0]);
    Object.assign(out, {
      spring_rate: +cfg.spring.spring_rate,
      wheel_rate: m.wheel_rate,
      ride_freq: m.ride_freq,
      damper_len: st.damper_len,
      pushrod_len: norm(sub(st.rod_out, st.rod_in)),
    });
    const hh = 0.5,
      xs = s.states([-hh, hh]),
      v = mul(sub(sp.state(xs.get(hh)).rod_out, sp.state(xs.get(-hh)).rod_out), 1 / (2 * hh)),
      pr = Math.abs(dot(unit(sub(st.rod_in, st.rod_out)), v));
    out.pushrod_ratio = pr;
    out.ride_per_mm = pr > 1e-9 ? 1 / pr : null;
  }
  return out;
}
