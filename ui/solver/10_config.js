/* 10_config.js: Schema, defaults, config merging, target ranges and input checks (Python: schema.py, config.py, validate.py). */
// ------------------------------------------------------------------ config
// the shared schema (schema/*.json): inlined into the page by build.py as window.SUSP_SCHEMA; read from disk in Node
const SCHEMA =
  root.SUSP_SCHEMA ||
  (() => {
    const path = require("path"),
      dir = path.join(__dirname, "..", "schema");
    return Object.fromEntries(["defaults", "metrics", "targets", "points", "moves"].map(n => [n, require(path.join(dir, n + ".json"))]));
  })();
const HP = Object.fromEntries(SCHEMA.points.hardpoints.map(p => [p.key, p.short]));
const HP_ORDER = Object.keys(HP);
const SPRING_POINTS = SCHEMA.points.spring_points.map(p => p.key);
const DEFAULTS = clone(SCHEMA.defaults.defaults);
const SPRING_DEFAULTS = clone(SCHEMA.defaults.spring_defaults);
const METRICS = Object.fromEntries(Object.entries(SCHEMA.metrics.corner).map(([k, d]) => [k, [d.label, d.unit, d.decimals]]));

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
  checkExtras(cfg);
  return cfg;
}
// mirrors config._check_extras: asymmetric travel, caliper envelope and rear halfshaft
function checkExtras(cfg) {
  const sw = cfg.sweep,
    num = v => typeof v === "number" && isFinite(v),
    vec3 = v => Array.isArray(v) && v.length === 3 && v.every(num);
  for (const k of ["travel", "droop_travel", "bump_travel"])
    if (sw[k] != null && !(+sw[k] > 0)) throw new SolveError(`sweep.${k} must be a positive distance in mm`);
  const mem = cfg.members || {},
    lo = cfg.loads || {};
  if (mem.surface != null && !["ground", "machined", "cold-drawn", "hot-rolled", "as-forged"].includes(mem.surface))
    throw new SolveError("members.surface must be ground, machined, cold-drawn, hot-rolled or as-forged");
  for (const k of ["uts", "fatigue_sf", "weld_fat_tube", "weld_fat_tab", "tab_yield"])
    if (mem[k] != null && !(num(mem[k]) && mem[k] > 0)) throw new SolveError(`members.${k} must be a positive number`);
  if (mem.tab != null) {
    const bad =
      typeof mem.tab === "object" && !Array.isArray(mem.tab)
        ? Object.entries(mem.tab)
            .filter(([k, v]) => ["thickness", "width", "edge", "weld_leg", "weld_length", "count"].includes(k) && !(num(v) && v > 0))
            .map(([k]) => k)
        : ["tab"];
    if (bad.length) throw new SolveError(`members.tab needs positive numbers for ${bad.join(", ")}`);
  }
  for (const k of ["fatigue_cycles", "fatigue_bump_cycles"])
    if (lo[k] != null && !(num(lo[k]) && lo[k] >= 1)) throw new SolveError(`loads.${k} must be a number of cycles (1 or more)`);
  const cal = cfg.wheel.caliper;
  if (cal != null) {
    const miss = ["clock_deg", "radius", "size", "offset"].filter(k => !num((cal || {})[k]));
    if (miss.length) throw new SolveError("wheel.caliper needs numbers for " + miss.join(", "));
  }
  const sp = cfg.spring || {};
  if ((sp.spring_rate2 == null) !== (sp.spring_breakpoint == null))
    throw new SolveError("A dual-rate spring needs both spring.spring_rate2 (N/mm) and spring.spring_breakpoint (mm)");
  if (sp.spring_rate2 != null && !(num(sp.spring_rate2) && sp.spring_rate2 > 0 && num(sp.spring_breakpoint) && sp.spring_breakpoint >= 0))
    throw new SolveError("spring.spring_rate2 must be > 0 and spring.spring_breakpoint >= 0 mm");
  if (sp.bumpstop_gap != null) {
    if (!num(sp.bumpstop_gap) || !(num(sp.bumpstop_k) && sp.bumpstop_k > 0))
      throw new SolveError("A bump stop needs spring.bumpstop_gap (mm) and spring.bumpstop_k (N/mm, > 0)");
    if (sp.bumpstop_k2 != null && !(num(sp.bumpstop_k2) && sp.bumpstop_k2 >= 0))
      throw new SolveError("spring.bumpstop_k2 must be a number >= 0 (N/mm^2)");
  }
  const veh = cfg.vehicle;
  if (veh.tire_load_sens != null && !(num(veh.tire_load_sens) && veh.tire_load_sens >= 0 && veh.tire_load_sens < 1))
    throw new SolveError("vehicle.tire_load_sens must be between 0 and 1 (typically 0.1-0.3)");
  if (veh.tire_mu != null && !(num(veh.tire_mu) && veh.tire_mu > 0)) throw new SolveError("vehicle.tire_mu must be > 0");
  const arb = cfg.arb;
  if (arb != null) {
    if (typeof arb !== "object" || Array.isArray(arb))
      throw new SolveError("arb must be an object (see the README: anti-roll bar linkage)");
    if (!cfg.spring) throw new SolveError("The anti-roll bar linkage needs the spring block (it is part of the ride model)");
    const miss = ["link_outboard", "arm_tip", "bar_pivot"].filter(k => !vec3(arb[k]));
    if (miss.length) throw new SolveError(`arb needs ${miss.join(", ")} as [x, y, z]`);
    if (!["lower", "upper", "upright", "rocker"].includes(arb.link_on ?? "lower"))
      throw new SolveError("arb.link_on must be lower, upper, upright or rocker");
    if (arb.link_on === "rocker" && cfg.spring.rocker_pivot == null)
      throw new SolveError("arb.link_on = rocker needs a rocker in the spring block");
    if (!(num(arb.bar_od) && arb.bar_od > 0)) throw new SolveError("arb.bar_od (mm) is needed");
    if (arb.bar_wall != null && !(num(arb.bar_wall) && arb.bar_wall > 0 && arb.bar_wall < arb.bar_od / 2))
      throw new SolveError("arb.bar_wall must be between 0 and half the OD (null = solid bar)");
    for (const k of ["bar_length", "bar_G", "bar_yield"])
      if (arb[k] != null && !(num(arb[k]) && arb[k] > 0)) throw new SolveError(`arb.${k} must be > 0`);
    if (arb.bar_axis != null && !(vec3(arb.bar_axis) && arb.bar_axis.some(c => c)))
      throw new SolveError("arb.bar_axis must be a direction [x, y, z]");
  }
  const js = cfg.joints || {};
  if (typeof js !== "object" || Array.isArray(js)) throw new SolveError("joints must be an object keyed by joint");
  for (const [k, v] of Object.entries(js)) {
    if (!(k in DEFAULT_JOINTS)) throw new SolveError(`joints.${k} is not a joint; use one of ${Object.keys(DEFAULT_JOINTS).join(", ")}`);
    if (!v || typeof v !== "object") throw new SolveError(`joints.${k} must be an object like {"bolt": "z", "allow": 13}`);
    const b = v.bolt;
    if (b != null && !(["x", "y", "z", "pivot", "kingpin", "rocker"].includes(b) || (vec3(b) && b.some(c => c))))
      throw new SolveError(`joints.${k}.bolt must be x, y, z, pivot, kingpin, rocker or [x, y, z]`);
    if (v.type != null && !["rod_end", "bearing"].includes(v.type)) throw new SolveError(`joints.${k}.type must be rod_end or bearing`);
    if (v.type === "bearing" && !["upper_outboard", "lower_outboard"].includes(k))
      throw new SolveError(`joints.${k}: only the ball joints can be modeled as a bearing`);
    if (v.allow != null && !(num(v.allow) && v.allow > 0)) throw new SolveError(`joints.${k}.allow must be a positive angle in degrees`);
    if (b === "rocker" && !(cfg.spring || {}).rocker_axis)
      throw new SolveError(`joints.${k}.bolt = rocker needs a rocker (spring.rocker_axis)`);
    if (v.align != null) {
      const sw = cfg.sweep || {},
        lo = +(sw.droop_travel ?? sw.travel ?? 30),
        hi = +(sw.bump_travel ?? sw.travel ?? 30);
      if (!["upper_outboard", "lower_outboard"].includes(k))
        throw new SolveError(`joints.${k}.align is for the ball joints (spherical bearings) only`);
      if (!(num(v.align) && v.align >= -lo && v.align <= hi))
        throw new SolveError(`joints.${k}.align must be a wheel travel in mm between -${lo} and ${hi}`);
    }
  }
  const hs = cfg.halfshaft;
  if (hs != null && !(vec3(hs.diff_output) && vec3(hs.cv_outboard)))
    throw new SolveError("halfshaft needs diff_output and cv_outboard as [x, y, z]");
}

// Broad starting ranges that suit most FSAE cars; narrow them per design ("targets") or with a team targets file.
const GENERAL_TARGETS = SCHEMA.targets.general;
function defaultTargets(cfg) {
  const t = clone(GENERAL_TARGETS[cfg.axle]),
    sp = cfg.spring,
    cond = SCHEMA.targets.conditional;
  if (sp) {
    Object.assign(t, cond.spring);
    if (sp.damper_stroke) {
      Object.assign(t, cond.damper_stroke);
      if (sp.damper_eye_to_eye) Object.assign(t, cond.damper_eye_to_eye);
    }
    if (sp.rocker_pivot != null) Object.assign(t, cond.rocker);
    if (sp.damper_bump_low && sp.damper_rebound_low) Object.assign(t, cond.damping);
  }
  if (cfg.arb && cfg.spring) t.arb_fos = [+(cfg.members.sf_target || 2), null];
  if ((cfg.wheel || {}).caliper) t.caliper_rim_margin = [+((cfg.clearance || {}).caliper_margin ?? 3), null];
  const hs = cfg.axle === "rear" ? cfg.halfshaft : null;
  if (hs) {
    Object.assign(t, cond.halfshaft);
    for (const [key, metric] of [
      ["cv_angle_max_in", "hs_cv_in_max"],
      ["cv_angle_max_out", "hs_cv_out_max"],
      ["plunge_max", "hs_plunge"],
    ])
      if (hs[key] != null) t[metric] = [null, +hs[key]];
  }
  Object.assign(t, cfg._team_targets || {}, cfg.targets || {}); // general, then the team file, then the design's own
  for (const k of Object.keys(t)) if (t[k] == null) delete t[k];
  return t;
}
// team targets file: {"front": {...}, "rear": {...}} or a flat {metric: [lo, hi]} table
function targetsFromFile(data, axle) {
  if (data.front || data.rear) return clone(data[axle] || {});
  return clone(data.targets || data);
}

// ------------------------------------------------------------------ input checks
// target keys that aren't metrics (usually a misspelling) would otherwise be ignored without a word
function closest(k, keys) {
  const lev = (a, b) => {
    const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = d[0];
      d[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const t = d[j];
        d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = t;
      }
    }
    return d[b.length];
  };
  let best = null,
    bd = Infinity;
  for (const c of keys) {
    const v = lev(k, c);
    if (v < bd) {
      bd = v;
      best = c;
    }
  }
  return bd <= Math.max(2, Math.floor(k.length * 0.35)) ? best : null;
}
function unknownTargetKeys(targets, known = METRICS, what = "target", where = " in targets") {
  return Object.keys(targets || {})
    .filter(k => !k.startsWith("_") && !(k in known))
    .sort()
    .map(k => {
      const near = closest(k, Object.keys(known));
      return (
        `${what === "target" ? "Target" : "Car target"} "${k}"${where} is not a ${what === "target" ? "metric the solver reports" : "car metric"}, so it is ignored` +
        (near ? `. Did you mean "${near}"?` : ". Check the spelling against the Targets list.")
      );
    });
}
function validate(cfg) {
  const h = {};
  for (const k of HP_ORDER) h[HP[k]] = cfg.hardpoints[k];
  const out = [],
    W = m => out.push(["warn", m]),
    E = m => out.push(["error", m]);
  const R = cfg.wheel.tire_radius;
  if (Math.abs(h.cp[2]) > 1)
    W(`Contact patch Z is ${h.cp[2].toFixed(1)} mm. The ground should be Z = 0 (Z up); check the CAD axis mapping.`);
  if (h.cp[1] <= 0) E("Contact patch Y must be positive (right-hand wheel, Y outboard). Your Y axis may be flipped.");
  if (h.ubj[2] <= h.lbj[2]) E("Upper ball joint is not above the lower one. They may be swapped, or Z is not up.");
  for (const [arm, pts] of [
    ["upper", ["uif", "uir", "ubj"]],
    ["lower", ["lif", "lir", "lbj"]],
  ]) {
    const [a, b, bj] = pts.map(p => h[p]);
    if (Math.max(a[1], b[1]) >= bj[1]) W(`${arm} wishbone: an inboard pivot is not inboard of the ball joint (Y). Check for swapped axes.`);
    const u = mul(sub(b, a), 1 / Math.max(norm(sub(b, a)), 1e-9));
    if (norm(perp(sub(bj, a), u)) < 50)
      E(`${arm} wishbone: the ball joint is almost on the pivot axis, so the arm cannot control the wheel.`);
    if (Math.abs(u[0]) < 0.5)
      W(
        `${arm} wishbone pivot axis is ${deg(Math.acos(Math.min(1, Math.abs(u[0])))).toFixed(0)} deg off fore-aft. Check the pivot coordinates.`
      );
  }
  for (const [nm, p] of [
    ["Upper ball joint", "ubj"],
    ["Lower ball joint", "lbj"],
    ["Trackrod outboard", "tro"],
  ]) {
    if (h[p][1] > h.cp[1] + 5)
      W(`${nm} is outboard of the tire center plane (Y ${h[p][1].toFixed(0)} > ${h.cp[1].toFixed(0)}). Check it fits inside the rim.`);
    if (h[p][2] > 2 * R) W(`${nm} is above the top of the tire. Check units (mm) and Z.`);
  }
  if (Math.abs(h.tro[1] - h.tri[1]) < 100) W("Tie rod is under 100 mm long laterally. Bump steer will be hard to control.");
  const k = unit(sub(h.ubj, h.lbj)),
    arm = norm(perp(sub(h.tro, h.lbj), k));
  if (cfg.axle === "front" && arm < 50) W(`Steering arm is only ${arm.toFixed(0)} mm. Rack forces will be high and steering very quick.`);
  const veh = cfg.vehicle;
  if (veh.wheelbase < 1525) W(`Wheelbase ${veh.wheelbase.toFixed(0)} mm is below the FSAE minimum (1525 mm in recent rules).`);
  if (!(veh.weight_front >= 0.3 && veh.weight_front <= 0.7)) W("Front weight should be a fraction such as 0.46, not a percentage.");
  const sp = cfg.spring;
  if (sp) {
    const p = sp.rod_outboard;
    if (sp.rod_on !== "upright") {
      const [a, b, bj] = (sp.rod_on === "lower" ? ["lif", "lir", "lbj"] : ["uif", "uir", "ubj"]).map(q => h[q]);
      const u = unit(sub(b, a)),
        dbj = norm(perp(sub(bj, a), u)),
        dp = norm(perp(sub(p, a), u));
      if (dp < 0.6 * dbj)
        W(
          `Pushrod mounts ${dp.toFixed(0)} mm from the ${sp.rod_on} arm axis vs ${dbj.toFixed(0)} mm for the ball joint, which bends the arm.`
        );
    }
    const inner = sp.rocker_pivot != null ? sp.rocker_rod : sp.damper_chassis;
    const e = sub(inner, p),
      L = norm(e),
      ang = deg(Math.asin(Math.min(1, Math.abs(e[2]) / L)));
    if (ang < 20) W(`Pushrod is only ${ang.toFixed(0)} deg from horizontal: low motion ratio and high rod forces (30-60 deg is typical).`);
    if (sp.rocker_axis != null) {
      if (norm(sp.rocker_axis) < 1e-9) E("Rocker axis is zero. Give the direction of the rocker pivot bolt, e.g. 1, 0, 0.");
      else {
        const ax = unit(sp.rocker_axis),
          r = sub(sp.rocker_rod, sp.rocker_pivot);
        if (Math.abs(dot(cross(r, mul(e, 1 / L)), ax)) < 0.2 * norm(perp(r, ax)))
          W("The pushrod points almost through the rocker pivot: tiny lever arm, near a toggle position.");
      }
    }
  }
  for (const m of unknownTargetKeys(cfg.targets)) W(m);
  for (const m of unknownTargetKeys(cfg._team_targets, METRICS, "target", " in the team targets file")) W(m);
  return out.sort((a, b) => (a[0] === "error" ? 0 : 1) - (b[0] === "error" ? 0 : 1));
}
