/* 35_joints.js: Rod-end and spherical-bearing misalignment over the travel and rack range (Python: joints.py). */
// key: [label, kind, bolt, square]; keys match the hardpoint / spring point each joint sits on
const DEFAULT_JOINTS = {
  upper_inboard_front: ["Upper wishbone, inboard (pivot {uif})", "rod_end", "pivot", true],
  upper_inboard_rear: ["Upper wishbone, inboard (pivot {uir})", "rod_end", "pivot", true],
  lower_inboard_front: ["Lower wishbone, inboard (pivot {lif})", "rod_end", "pivot", true],
  lower_inboard_rear: ["Lower wishbone, inboard (pivot {lir})", "rod_end", "pivot", true],
  upper_outboard: ["Upper ball joint", "bearing", "kingpin", false],
  lower_outboard: ["Lower ball joint", "bearing", "kingpin", false],
  trackrod_inboard: ["{rod}, inboard", "rod_end", "z", true],
  trackrod_outboard: ["{rod}, outboard", "rod_end", "z", true],
  rod_outboard: ["Pushrod, outboard", "rod_end", "pivot", false],
  rocker_rod: ["Pushrod, rocker end", "rod_end", "rocker", false],
  rocker_damper: ["Damper, rocker end", "rod_end", "rocker", false],
  damper_chassis: ["Damper, chassis end", "rod_end", "rocker", false],
};
const EYE3 = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
function armR([a, b], bj0, bj) {
  const u = unit(sub(b, a)),
    v0 = perp(sub(bj0, a), u),
    v1 = perp(sub(bj, a), u);
  return rodrigues(mul(u, Math.atan2(dot(u, cross(v0, v1)), dot(v0, v1))));
}
function misalignment(cfg, s, sp) {
  const sw = cfg.sweep,
    mem = cfg.members,
    [D, B] = travelRange(cfg),
    h = s.h,
    rear = cfg.axle === "rear";
  const heaves = heavePoints(D, B, +(sw.pack_heave_steps || 9)),
    racks = cfg.axle === "front" ? heavePoints(sw.rack_travel, sw.rack_travel, +(sw.pack_rack_steps || 7)) : [0];
  const piv = { upper: [h.uif, h.uir], lower: [h.lif, h.lir] },
    names = {
      uif: `X=${h.uif[0].toFixed(0)}`,
      uir: `X=${h.uir[0].toFixed(0)}`,
      lif: `X=${h.lif[0].toFixed(0)}`,
      lir: `X=${h.lir[0].toFixed(0)}`,
      rod: rear ? "Toe link" : "Tie rod",
    };
  const jl = [];
  for (const [key, arm, pk, bj] of [
    ["upper_inboard_front", "upper", "uif", "ub"],
    ["upper_inboard_rear", "upper", "uir", "ub"],
    ["lower_inboard_front", "lower", "lif", "lb"],
    ["lower_inboard_rear", "lower", "lir", "lb"],
  ])
    jl.push([key, "chassis", P => unit(sub(P.pts[bj], h[pk])), arm]);
  jl.push(["upper_outboard", "upright", null, "upper"], ["lower_outboard", "upright", null, "lower"]);
  const tr = P => unit(sub(P.pts.tro, P.pts.tri));
  jl.push(["trackrod_inboard", "chassis", tr, null], ["trackrod_outboard", "upright", tr, null]);
  if (sp) {
    const on = sp.on === "upper" || sp.on === "lower" ? sp.on : "upright",
      dmp = P => unit(sub(sp.dch, P.st.damper_out));
    if (!sp.direct) {
      const pr = P => unit(sub(P.st.rod_in, P.st.rod_out));
      jl.push(
        ["rod_outboard", on, pr, on !== "upright" ? sp.on : null],
        ["rocker_rod", "rocker", pr, null],
        ["rocker_damper", "rocker", dmp, null]
      );
    } else jl.push(["rod_outboard", on, dmp, on !== "upright" ? sp.on : null]);
    jl.push(["damper_chassis", "chassis", dmp, null]);
  }
  const user = cfg.joints || {},
    P0 = { ub: s.P0[0], lb: s.P0[1] };
  const poses = [];
  for (const [hz, rk, x] of s.grid(heaves, racks)) {
    const pts = s.observe(x, hz, rk)._pts,
      Ru = rodrigues(x.slice(3)),
      st = sp ? sp.state(x) : null,
      Rr = sp && !sp.direct ? rodrigues(mul(sp.k, rad(st.rocker_deg))) : EYE3;
    poses.push({
      hz,
      rk,
      pts,
      st,
      R: { chassis: EYE3, upright: Ru, rocker: Rr, upper: armR(piv.upper, P0.ub, pts.ub), lower: armR(piv.lower, P0.lb, pts.lb) },
    });
  }
  let ride = poses[0];
  for (const q of poses) if (Math.abs(q.hz) + Math.abs(q.rk) < Math.abs(ride.hz) + Math.abs(ride.rk)) ride = q;
  const asinD = v => deg(Math.asin(Math.min(1, Math.abs(v))));
  const rows = [];
  for (const [key, mount, link, arm] of jl) {
    let [label, kind, boltD, squareD] = DEFAULT_JOINTS[key];
    const uc = user[key] || {};
    kind = uc.type || kind;
    let bolt = uc.bolt ?? boltD,
      arm_ = arm;
    const square = "square" in uc ? uc.square : !("bolt" in uc) ? squareD : ["x", "y", "z"].includes(uc.bolt);
    if (bolt === "rocker" && (!sp || sp.direct)) {
      // no rocker (direct-acting damper): the damper's chassis bolt parallels the arm's pivot axis
      if (sp && (sp.on === "upper" || sp.on === "lower")) [bolt, arm_] = ["pivot", sp.on];
      else bolt = "x";
    }
    let b0;
    if (bolt === "pivot") {
      const pa = piv[arm_ || "lower"];
      b0 = unit(sub(pa[1], pa[0]));
    } else if (bolt === "kingpin") b0 = unit(sub(s.P0[0], s.P0[1]));
    else if (bolt === "rocker") b0 = sp.k.slice();
    else if (typeof bolt === "string") b0 = EYE3["xyz".indexOf(bolt)].slice();
    else b0 = unit(bolt.map(Number));
    const allow = +(uc.allow ?? (mem[kind === "bearing" ? "bearing_misalign" : "rod_end_misalign"] || (kind === "bearing" ? 10 : 12)));
    let ang;
    if (kind === "bearing")
      ang = q => {
        const p = matvec(q.R[arm], b0),
          r = matvec(q.R.upright, b0);
        return deg(Math.atan2(norm(cross(p, r)), Math.abs(dot(p, r)))); // atan2: exact near 0
      };
    else {
      if (square) b0 = unit(perp(b0, link(ride)));
      ang = q => asinD(dot(link(q), matvec(q.R[mount], b0)));
    }
    let worst = null;
    for (const q of poses) {
      const v = [ang(q), q.hz, q.rk];
      if (!worst || v[0] > worst[0] || (v[0] === worst[0] && (v[1] > worst[1] || (v[1] === worst[1] && v[2] > worst[2])))) worst = v;
    }
    const row = {
      key,
      label: label.replace(/\{(\w+)\}/g, (_, k) => names[k]),
      kind,
      mount: kind === "rod_end" ? mount : arm,
      square: !!square && kind === "rod_end",
      bolt: typeof bolt === "string" ? bolt : "vector",
      bolt0: b0,
      ride: ang(ride),
      worst: worst[0],
      at: [worst[1], worst[2]],
      allow,
      margin: allow - worst[0],
      best: null,
    };
    if (kind === "rod_end") {
      // the bolt direction (square to the link at ride height) that keeps the worst angle smallest
      const u0 = link(ride),
        e1 = unit(Math.abs(u0[2]) < 0.9 ? cross(u0, [0, 0, 1]) : cross(u0, [1, 0, 0])),
        e2 = cross(u0, e1);
      const A = poses.map(q => dot(link(q), matvec(q.R[mount], e1))),
        Bv = poses.map(q => dot(link(q), matvec(q.R[mount], e2)));
      let bi = 0,
        bw = Infinity;
      for (let i = 0; i < 180; i++) {
        const ph = (Math.PI * i) / 180,
          c = Math.cos(ph),
          sn = Math.sin(ph);
        let w = 0;
        for (let j = 0; j < A.length; j++) w = Math.max(w, asinD(c * A[j] + sn * Bv[j]));
        if (w < bw) [bw, bi] = [w, i];
      }
      const ph = (Math.PI * bi) / 180;
      row.best = { worst: bw, bolt: add(mul(e1, Math.cos(ph)), mul(e2, Math.sin(ph))) };
    }
    rows.push(row);
  }
  let wr = rows[0];
  for (const r of rows) if (r.margin < wr.margin) wr = r;
  return { rows, margin: wr.margin, worst: wr, n_poses: poses.length };
}
