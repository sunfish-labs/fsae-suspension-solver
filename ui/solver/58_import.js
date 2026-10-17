/* 58_import.js: points from CAD (a SolidWorks point table) into hardpoints: reading the table, matching names to
   points, the CAD's axes and units, which side and axle, and putting the contact patch on the ground. */
const IMPORT_UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4 };
const AXIS_SPECS = ["+X", "-X", "+Y", "-Y", "+Z", "-Z"];
// what an imported point can be: the hardpoints (an arm's two inboard pivots as a pair, sorted by X later), the
// wheel center (stands in for a missing contact patch), and the spring points
const IMPORT_TARGETS = [
  ["upper_inboard", "Upper wishbone inboard pivot"],
  ["upper_outboard", "Upper ball joint"],
  ["lower_inboard", "Lower wishbone inboard pivot"],
  ["lower_outboard", "Lower ball joint"],
  ["trackrod_inboard", "Tie rod / toe link inboard"],
  ["trackrod_outboard", "Tie rod / toe link outboard"],
  ["contact_patch", "Tire contact patch"],
  ["wheel_center", "Wheel center"],
  ["rod_outboard", "Pushrod / pullrod outboard"],
  ["rocker_pivot", "Rocker pivot"],
  ["rocker_axis_point", "Rocker: a 2nd point on its pivot axis"],
  ["rocker_rod", "Rocker: pushrod point"],
  ["rocker_damper", "Rocker: damper point"],
  ["damper_chassis", "Damper chassis mount"],
];
const IMPORT_PAIRS = {
  upper_inboard: ["upper_inboard_front", "upper_inboard_rear"],
  lower_inboard: ["lower_inboard_front", "lower_inboard_rear"],
};
const IMPORT_SPRING = ["rod_outboard", "rocker_pivot", "rocker_rod", "rocker_damper", "damper_chassis"];

// one number from a table cell: quotes and a unit suffix allowed, a decimal comma if asked
function importNum(c, comma) {
  let s = String(c)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s*(mm|cm|m|in|")$/i, "");
  if (comma) s = s.replace(",", ".");
  return s === "" || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ? NaN : +s;
}
// a point table as text: "name, x, y, z" per line (comma, tab or semicolon separated; a semicolon table may use
// decimal commas), or free text whose last three numbers are the coordinates ("Upper BJ  X 12.3 Y 45 Z 6")
function parsePointTable(text) {
  const rows = [],
    skipped = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let name = null,
      v = null;
    const sep = line.includes("\t") ? "\t" : line.includes(";") ? ";" : line.includes(",") ? "," : null;
    if (sep) {
      const cells = line
        .split(sep)
        .map(c => c.trim())
        .filter(c => c !== "");
      if (cells.length >= 4) {
        v = cells.slice(-3).map(c => importNum(c, sep === ";"));
        name = cells
          .slice(0, -3)
          .join(" ")
          .replace(/^["']|["']$/g, "");
      }
    }
    if (!v || !v.every(Number.isFinite)) {
      const nums = [...line.matchAll(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)];
      if (nums.length >= 3) {
        const last = nums.slice(-3);
        v = last.map(m => +m[0]);
        name = line
          .slice(0, last[0].index)
          .replace(/[\s,;:=]*[xX]?[\s:=]*$/, "")
          .trim();
      }
    }
    if (name && v && v.every(Number.isFinite)) rows.push({ name, v });
    else if (!/^\W*name\b/i.test(line)) skipped.push(line);
  }
  return { rows, skipped };
}
// units from the size of the numbers: an FSAE corner spans about 0.3 to 0.8 m from the centerline
function guessUnits(rows) {
  const big = Math.max(0, ...rows.map(r => Math.max(...r.v.map(Math.abs))));
  return big < 5 ? "m" : big < 80 ? "in" : "mm";
}
const IMPORT_SYN = {
  upper: ["upper", "top", "uca", "upr", "u"],
  lower: ["lower", "bottom", "bot", "lca", "lwr"],
  inb: ["inboard", "inner", "in", "ib", "chassis", "frame", "pivot", "mount", "rack"],
  outb: ["outboard", "outer", "out", "ob", "upright", "bj", "ball", "balljoint", "knuckle", "joint"],
  tie: ["tie", "tierod", "track", "trackrod", "toe", "toelink", "steering", "steer", "tr"],
  cp: ["contact", "patch", "cp", "tcp"],
  wc: ["wc", "hub", "spindle", "wheelcenter"],
  center: ["center", "centre", "ctr"],
  rocker: ["rocker", "bellcrank", "bell", "crank"],
  rod: ["pushrod", "pullrod", "push", "pull", "rod", "pr"],
  damp: ["damper", "shock", "coilover"],
  axis: ["axis"],
  fore: ["front", "fwd", "forward", "fore", "f"],
  aft: ["rear", "aft", "back", "r"],
};
// a point's name -> {axle, side, key, fore}: axle and side from leading tokens (FL, RR, LF, "front", "rear left"...)
function classifyPointName(name) {
  let toks = String(name)
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  let axle = null,
    side = null;
  const lead = {
    fl: ["front", "left"],
    lf: ["front", "left"],
    fr: ["front", "right"],
    rf: ["front", "right"],
    rl: ["rear", "left"],
    lr: ["rear", "left"],
    rr: ["rear", "right"],
  };
  for (let i = 0; i < 3 && toks.length; i++) {
    const t = toks[0];
    if (lead[t]) [axle, side] = lead[t];
    else if (["front", "frt"].includes(t) && !axle) axle = "front";
    else if (t === "rear" && !axle) axle = "rear";
    else if (["left", "lh"].includes(t) && !side) side = "left";
    else if (["right", "rh"].includes(t) && !side) side = "right";
    else break;
    toks = toks.slice(1);
  }
  toks = toks.filter(t => {
    if (["left", "lh"].includes(t)) side = side || "left";
    else if (["right", "rh"].includes(t)) side = side || "right";
    else return true;
    return false;
  });
  const joined = toks.join("_"),
    P = SCHEMA.points;
  // exact names first: the JSON keys, the short names and the importer's aliases
  const shortToKey = Object.fromEntries(P.hardpoints.map(h => [h.short, h.key])),
    springKeys = P.spring_points.map(s => s.key);
  let key = null;
  // only an identifier-style name (no spaces) is read as the solver's own key: there "front" means the smaller X
  // (KineSolver naming), while in words ("LCA front") front means physically forward
  const ident = /^[A-Za-z0-9_]+$/.test(
    String(name)
      .trim()
      .replace(/^(fl|fr|rl|rr|lf|rf|lr|front|rear)_/i, "")
  );
  const exact = ident
    ? shortToKey[P.aliases[joined]] || shortToKey[joined] || (P.hardpoints.some(h => h.key === joined) ? joined : null)
    : null;
  if (exact) key = exact;
  else if (ident && (springKeys.includes(joined) || P.spring_aliases[joined])) key = P.spring_aliases[joined] || joined;
  if (key === "rocker_axis") key = "rocker_axis_point";
  const has = g => toks.some(t => IMPORT_SYN[g].includes(t));
  let fore = has("fore") ? "fore" : has("aft") ? "aft" : null;
  if (key && /^(upper|lower)_inboard_(front|rear)$/.test(key)) {
    fore = null; // the solver's own key (KineSolver naming: front = smaller X), not a physical front or rear
    key = key.replace(/_(front|rear)$/, "");
  }
  if (!key) {
    if (has("cp")) key = "contact_patch";
    else if (has("wc") || (toks.includes("wheel") && has("center"))) key = "wheel_center";
    else if (has("rocker"))
      key = has("axis") ? "rocker_axis_point" : has("damp") ? "rocker_damper" : has("rod") ? "rocker_rod" : "rocker_pivot";
    else if (has("tie")) key = has("outb") ? "trackrod_outboard" : has("inb") ? "trackrod_inboard" : null;
    else if (has("damp")) key = "damper_chassis";
    else if (has("rod")) key = "rod_outboard";
    else if (has("upper") || has("lower")) {
      const arm = has("upper") ? "upper" : "lower";
      key = has("outb") ? `${arm}_outboard` : has("inb") || fore ? `${arm}_inboard` : null;
    }
  }
  if (!IMPORT_PAIRS[key]) fore = null;
  return { axle, side, key, fore };
}
// the CAD axes from the points themselves: up from the ball joints (upper above lower), outboard from the inboard
// pivots to the outboard points; forward is the axis left, its sign from front-vs-rear names or both axles' wheels
function guessImportAxes(rows, current) {
  const at = k => rows.filter(r => r.key === k).map(r => r.v);
  const mean = ps => (ps.length ? [0, 1, 2].map(i => ps.reduce((s, p) => s + p[i], 0) / ps.length) : null);
  const ub = mean(at("upper_outboard")),
    lb = mean(at("lower_outboard"));
  const out = mean([...at("upper_outboard"), ...at("lower_outboard"), ...at("contact_patch"), ...at("wheel_center")]),
    inn = mean([...at("upper_inboard"), ...at("lower_inboard")]);
  if (!ub || !lb || !out || !inn) return null;
  const d = sub(ub, lb),
    up = [0, 1, 2].reduce((b, i) => (Math.abs(d[i]) > Math.abs(d[b]) ? i : b), 0);
  const o = sub(out, inn),
    rest = [0, 1, 2].filter(i => i !== up),
    right = Math.abs(o[rest[0]]) >= Math.abs(o[rest[1]]) ? rest[0] : rest[1],
    fwd = rest.find(i => i !== right);
  const spec = (i, s) => (s < 0 ? "-" : "+") + "XYZ"[i];
  // forward's sign: the front wheels ahead of the rear, or a pivot named front ahead of one named rear
  let sFwd = null;
  const cpOf = ax => mean(rows.filter(r => r.axle === ax && (r.key === "contact_patch" || r.key === "wheel_center")).map(r => r.v));
  const cf = cpOf("front"),
    cr = cpOf("rear");
  if (cf && cr && Math.abs(cf[fwd] - cr[fwd]) > 100) sFwd = Math.sign(cf[fwd] - cr[fwd]);
  else {
    const fo = mean(rows.filter(r => r.fore === "fore").map(r => r.v)),
      af = mean(rows.filter(r => r.fore === "aft").map(r => r.v));
    if (fo && af && Math.abs(fo[fwd] - af[fwd]) > 1e-6) sFwd = Math.sign(fo[fwd] - af[fwd]);
  }
  const keepSign = current && current.fwd && current.fwd.slice(1) === "XYZ"[fwd] ? (current.fwd[0] === "-" ? -1 : 1) : 1;
  // points named as left-hand ones run outboard toward the CAD's left, so its right is the other way
  const named = rows.filter(r => r.key && r.key !== "ignore" && r.side),
    left = named.length > 0 && named.every(r => r.side === "left");
  return {
    fwd: spec(fwd, sFwd || keepSign),
    up: spec(up, Math.sign(d[up]) || 1),
    right: spec(right, (Math.sign(o[right]) || 1) * (left ? -1 : 1)),
    fwdSure: sFwd != null,
  };
}
function importAxesOk(ax) {
  const ids = [ax.fwd, ax.up, ax.right].map(s => String(s).slice(1));
  return AXIS_SPECS.includes(ax.fwd) && AXIS_SPECS.includes(ax.up) && AXIS_SPECS.includes(ax.right) && new Set(ids).size === 3;
}
// a CAD point (file units, file axes) in the solver's axes and mm
function importToSolver(v, ax, scale) {
  const c = s => (s[0] === "-" ? -1 : 1) * v["XYZ".indexOf(s[1])] * scale;
  return [c(ax.fwd), c(ax.right), c(ax.up)];
}
/* rows: [{name, v, key, axle, side, fore}] (key and axle as the user confirmed them; axle null = opts.axle).
   opts: {units, axes {fwd, up, right}, axle, tireRadius {front, rear}, ground (contact patch at Z = 0, X = 0)}.
   Returns {axles: {front|rear: {hardpoints, spring, rocker_axis, missing, cp_cad}}, notes, problems, wheelbase}. */
function buildImport(rows, opts) {
  const notes = [],
    problems = [],
    scale = IMPORT_UNITS[opts.units] || 1,
    ax = opts.axes;
  if (!importAxesOk(ax)) return { axles: {}, notes, problems: ["Pick three different axes for forward, up and right."], wheelbase: null };
  const used = rows.filter(r => r.key && r.key !== "ignore");
  const byAxle = {};
  for (const r of used) (byAxle[r.axle || opts.axle] = byAxle[r.axle || opts.axle] || []).push(r);
  const axles = {},
    cpCad = {};
  for (const [axle, rs0] of Object.entries(byAxle)) {
    if (axle !== "front" && axle !== "rear") continue;
    const sides = new Set(rs0.map(r => r.side).filter(Boolean));
    let rs = rs0;
    if (sides.has("right") && sides.has("left")) {
      rs = rs0.filter(r => r.side !== "left");
      notes.push(`${importCap(axle)}: used the right-hand points; the ${rs0.length - rs.length} left-hand ones are ignored.`);
    }
    const P = rs.map(r => ({ ...r, p: importToSolver(r.v, ax, scale) }));
    const one = k => P.filter(r => r.key === k);
    // which side: the outboard points' Y against the inboard pivots'
    const yo = [...one("upper_outboard"), ...one("lower_outboard"), ...one("contact_patch"), ...one("wheel_center")].map(r => r.p[1]),
      yi = [...one("upper_inboard"), ...one("lower_inboard")].map(r => r.p[1]);
    const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
    let mirrored = false;
    if (yo.length && yi.length && avg(yo) < avg(yi)) {
      P.forEach(r => (r.p[1] = -r.p[1]));
      mirrored = true;
      notes.push(
        `${importCap(axle)}: these are left-hand points (outboard is toward −Y in the solver's axes), mirrored to the right-hand corner the solver uses.`
      );
    }
    const hp = {},
      sp = {};
    const pick = (k, label) => {
      const f = P.filter(r => r.key === k);
      if (f.length > 1)
        problems.push(
          `${importCap(axle)}: ${f.length} points are marked as the ${label} (${f.map(r => r.name).join(", ")}); the first is used.`
        );
      return f[0] || null;
    };
    for (const [k, [kf, kr]] of Object.entries(IMPORT_PAIRS)) {
      const f = P.filter(r => r.key === k);
      if (f.length > 2)
        problems.push(`${importCap(axle)}: ${f.length} points are marked as ${k.replace("_", " ")} pivots; only two are used.`);
      const two = f.slice(0, 2).sort((a, b) => a.p[0] - b.p[0]);
      if (two[0]) hp[kf] = two[0];
      if (two[1]) hp[kr] = two[1];
      // a pivot named "front" should be ahead of one named "rear": if not, forward is reversed
      const fo = two.find(r => r.fore === "fore"),
        af = two.find(r => r.fore === "aft");
      if (fo && af && fo.p[0] < af.p[0])
        problems.push(
          `${importCap(axle)}: the ${k.split("_")[0]} pivot named as the front one (${fo.name}) comes out behind the one named rear (${af.name}). Forward is probably the other way: flip the forward axis.`
        );
    }
    for (const k of ["upper_outboard", "lower_outboard", "trackrod_inboard", "trackrod_outboard", "contact_patch"]) {
      const r = pick(k, k.replace(/_/g, " "));
      if (r) hp[k] = r;
    }
    const wc = pick("wheel_center", "wheel center");
    for (const k of IMPORT_SPRING) {
      const r = pick(k, k.replace(/_/g, " "));
      if (r) sp[k] = r;
    }
    const axisPt = pick("rocker_axis_point", "rocker axis point");
    // the ground and the X zero: the contact patch (or the wheel center less the tire radius)
    let cp = hp.contact_patch ? hp.contact_patch.p.slice() : null;
    if (!cp && wc) {
      const R = (opts.tireRadius && opts.tireRadius[axle]) || 254;
      cp = [wc.p[0], wc.p[1], wc.p[2] - R];
      hp.contact_patch = { name: `${wc.name} − tire radius`, p: cp };
      notes.push(
        `${importCap(axle)}: no contact patch point, so it is the wheel center less the tire radius (${importFmt1(R)} mm), straight down (ignores camber).`
      );
    }
    cpCad[axle] = cp ? cp.slice() : null;
    const shift = [0, 0, 0];
    if (opts.ground !== false && cp) {
      shift[0] = cp[0];
      shift[2] = cp[2];
      if (Math.abs(cp[2]) > 0.5)
        notes.push(
          `${importCap(axle)}: the contact patch was ${importFmt1(Math.abs(cp[2]))} mm ${cp[2] > 0 ? "above" : "below"} your CAD's zero height, so every point moved to put it on the ground (Z = 0).`
        );
      if (Math.abs(cp[0]) > 0.5)
        notes.push(
          `${importCap(axle)}: X is measured from this axle's contact patch (it was at ${importFmt1(cp[0])} mm), as the solver keeps each axle.`
        );
    } else if (!cp)
      problems.push(
        `${importCap(axle)}: no contact patch or wheel center, so the ground can't be placed: the points are used as they are.`
      );
    const at = r => [r.p[0] - shift[0], r.p[1] - shift[1], r.p[2] - shift[2]].map(x => +x.toFixed(3));
    const hardpoints = Object.fromEntries(Object.entries(hp).map(([k, r]) => [k, at(r)])),
      spring = Object.fromEntries(Object.entries(sp).map(([k, r]) => [k, at(r)]));
    let rockerAxis = null;
    if (axisPt && sp.rocker_pivot) {
      const d = sub(axisPt.p, sp.rocker_pivot.p);
      if (norm(d) > 1e-6) rockerAxis = unit(d).map(x => +x.toFixed(6));
    }
    if (rockerAxis) spring.rocker_axis = rockerAxis;
    const missing = HP_ORDER.filter(k => !hardpoints[k]);
    if (yo.length && !yi.length && !mirrored && hardpoints.contact_patch && hardpoints.contact_patch[1] < 0)
      problems.push(
        `${importCap(axle)}: the contact patch is at negative Y (left of the centerline) but there are no inboard pivots to tell the side; check the right axis.`
      );
    axles[axle] = { hardpoints, spring, missing, names: Object.fromEntries(Object.entries({ ...hp, ...sp }).map(([k, r]) => [k, r.name])) };
  }
  let wheelbase = null;
  if (cpCad.front && cpCad.rear) {
    wheelbase = +(cpCad.front[0] - cpCad.rear[0]).toFixed(1);
    if (!(wheelbase > 0)) {
      problems.push("The front contact patch comes out behind the rear one: forward is probably the other way.");
      wheelbase = null;
    }
  }
  if (!used.length) problems.push("No points matched. Name them as in the list, or pick what each one is in the table.");
  return { axles, notes, problems, wheelbase };
}
const importCap = s => s.charAt(0).toUpperCase() + s.slice(1);
const importFmt1 = v => (Math.round(v * 10) / 10).toString();
