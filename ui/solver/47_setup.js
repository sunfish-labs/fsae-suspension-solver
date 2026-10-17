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
// mirrors output/equations.py: SolidWorks global variables (Tools > Equations > Link to external file), team frame
const EQ_SPRING = ["rod_outboard", "rocker_pivot", "rocker_rod", "rocker_damper", "damper_chassis"];
const eqNum = (v, d = 3) => (Math.round(+v * 10 ** d) / 10 ** d + 0).toFixed(d);
function equationLines(cfg, ev) {
  const pre = cfg.axle === "front" ? "F_" : "R_",
    team = cornerOut(cfg),
    out = [];
  for (const k of HP_ORDER) "XYZ".split("").forEach((a, i) => out.push([`${pre}${k}_${a}`, eqNum(team.hardpoints[k][i])]));
  const sp = team.spring || {};
  for (const k of EQ_SPRING) if (Array.isArray(sp[k])) "XYZ".split("").forEach((a, i) => out.push([`${pre}${k}_${a}`, eqNum(sp[k][i])]));
  if (Array.isArray(sp.rocker_axis)) {
    const n = Math.hypot(...sp.rocker_axis.map(Number)) || 1;
    "XYZ".split("").forEach((a, i) => out.push([`${pre}rocker_axis_${a}`, eqNum(+sp.rocker_axis[i] / n, 6)]));
  }
  const v = setupValues(cfg, ev);
  out.push([`${pre}tie_rod_length`, eqNum(v.tie_rod_len)]);
  if (v.pushrod_len != null) out.push([`${pre}pushrod_length`, eqNum(v.pushrod_len)], [`${pre}damper_length`, eqNum(v.damper_len)]);
  out.push([`${pre}track`, eqNum(ev.susp.track)]);
  return out;
}
function equationsText(name, corners, wheelbase) {
  const lines = [
    `' ${name}: suspension points for SolidWorks (Tools > Equations > Link to external file)`,
    "' ISO 8855 team frame: X forward, Y left, Z up, mm; origin on the ground under the front axle, on the centerline",
    "' each corner as the left-hand one (Y positive); set the model's units to mm",
    `"wheelbase"= ${eqNum(wheelbase)}`,
  ];
  for (const [cfg, ev] of corners) for (const [n, v] of equationLines(cfg, ev)) lines.push(`"${n}"= ${v}`);
  return lines.join("\n") + "\n";
}
