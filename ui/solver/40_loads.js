/* 40_loads.js: Load cases, statics (incl. the rigid pushrod arm), strength and compliance (Python: loads/). */
// ------------------------------------------------------------------ loads
const MEMBERS = ["upper_front", "upper_rear", "lower_front", "lower_rear", "tie_rod", "pushrod"];

// mirrors loads.load_cases: lltdCar = the car's front LLTD (loads.lltd_front overrides it); braking by brake bias or by grip
function loadCases(cfg, susp, lltdCar = null) {
  const veh = cfg.vehicle,
    L = cfg.loads,
    W = veh.mass * G,
    wf = veh.weight_front,
    h = veh.cg_height,
    WB = veh.wheelbase;
  const front = cfg.axle === "front",
    share = front ? wf : 1 - wf;
  const lltd = L.lltd_front || lltdCar || wf,
    latShare = front ? lltd : 1 - lltd,
    t = susp.track;
  const bias = (L.brake_split || "bias") === "bias",
    bShare = front ? veh.front_brake_share : 1 - veh.front_brake_share;
  const info = {
    W,
    share,
    Fz0: (W * share) / 2,
    long_per_g: (W * h) / WB / 2,
    lat_per_g: ((W * h) / t) * latShare,
    lat_share: latShare,
    lltd,
    lltd_from_car: !!(lltdCar && !L.lltd_front),
    h,
    WB,
    t,
    brake_split: bias ? "bias" : "grip",
    brake_share: bShare,
  };
  const brakeFx = (g, Fz) => (bias ? (-g * W * bShare) / 2 : -g * Fz);
  const bdesc = g => (bias ? `Fx = ${g} g × car weight × ${(bShare * 100).toFixed(0)} % brake share / 2` : `Fx = ${g} × Fz`);
  const wheel = (ax = 0, ay = 0, side = 1) => {
    const dl = (front ? -1 : 1) * ax * info.long_per_g,
      dt = side * Math.abs(ay) * info.lat_per_g;
    const Fz = Math.max(0, info.Fz0 + dl + dt);
    let parts = `${info.Fz0.toFixed(0)} static`;
    if (dl) parts += ` ${dl > 0 ? "+" : "−"} ${Math.abs(dl).toFixed(0)} long.`;
    if (dt) parts += ` ${dt > 0 ? "+" : "−"} ${Math.abs(dt).toFixed(0)} lat.`;
    return [Fz, parts];
  };
  const bp = veh.brakes === "inboard" ? "c" : "cp",
    dp = veh.drive === "inboard" ? "c" : "cp";
  const cases = [];
  cases.push([
    "bump",
    [[[0, 0, L.bump_g * info.Fz0], "cp"]],
    `${L.bump_g} × static wheel load`,
    `${L.bump_g} × ${info.Fz0.toFixed(0)} static`,
  ]);
  for (const [side, nm] of [
    [1, "outer"],
    [-1, "inner"],
  ]) {
    const [Fz, parts] = wheel(0, L.corner_g, side);
    cases.push([
      `corner ${nm}`,
      [
        [[0, 0, Fz], "cp"],
        [[0, -side * L.corner_g * Fz, 0], "cp"],
      ],
      `${L.corner_g} g lateral, ${nm} wheel`,
      parts,
    ]);
  }
  {
    const [Fz, parts] = wheel(-L.brake_g);
    cases.push([
      "braking",
      [
        [[0, 0, Fz], "cp"],
        [[brakeFx(L.brake_g, Fz), 0, 0], bp],
      ],
      `${L.brake_g} g braking (${bdesc(L.brake_g)})`,
      parts,
    ]);
  }
  const g2 = L.combined_g;
  for (const [side, nm] of [
    [1, "outer"],
    [-1, "inner"],
  ]) {
    const [Fz, parts] = wheel(-g2, g2, side);
    cases.push([
      `brake+corner ${nm}`,
      [
        [[0, 0, Fz], "cp"],
        [[0, -side * g2 * Fz, 0], "cp"],
        [[brakeFx(g2, Fz), 0, 0], bp],
      ],
      `${g2} g braking + ${g2} g lateral, ${nm} wheel (${bdesc(g2)})`,
      parts,
    ]);
  }
  if (L.pothole_g)
    cases.push([
      "pothole",
      [[[0, 0, L.pothole_g * info.Fz0], "cp"]],
      `${L.pothole_g} × static wheel load, impact`,
      `${L.pothole_g} × ${info.Fz0.toFixed(0)} static`,
    ]);
  if (L.kerb_g)
    cases.push([
      "kerb strike",
      [
        [[0, 0, info.Fz0], "cp"],
        [[0, -L.kerb_g * info.Fz0, 0], "cp"],
      ],
      `${L.kerb_g} × static wheel load sideways (wheel pushed inboard) + static load, impact`,
      `${info.Fz0.toFixed(0)} static`,
    ]);
  if (!front) {
    const [Fz, parts] = wheel(L.accel_g);
    cases.push([
      "acceleration",
      [
        [[0, 0, Fz], "cp"],
        [[(L.accel_g * W) / 2, 0, 0], dp],
      ],
      `${L.accel_g} g acceleration (rear drive)`,
      parts,
    ]);
  }
  return [cases, info];
}

// link end points at ride height (dz = 0) or at a wheel travel dz (rack centered); mirrors loads._geometry
function loadGeometry(susp, sp, dz = 0) {
  const h = susp.h;
  let st,
    ub = h.ubj,
    lb = h.lbj,
    tro = h.tro,
    cp = h.cp,
    c = susp.c0;
  if (!dz) st = sp.state([0, 0, 0, 0, 0, 0]);
  else {
    const q = susp.observe(susp.states([dz]).get(dz), dz)._pts;
    ub = q.ub;
    lb = q.lb;
    tro = q.tro;
    cp = q.cp;
    c = q.c;
    let th = 0;
    const n = Math.max(1, Math.ceil(Math.abs(dz) / 5)); // walk the rocker out so it stays on its branch
    for (let i = 1; i <= n; i++) {
      const d = (dz * i) / n;
      st = sp.state(susp.states([d]).get(d), th);
      th = (st.rocker_deg * Math.PI) / 180;
    }
  }
  const pts = { ubj: ub, lbj: lb, tro, cp, c, rod_out: st.rod_out, rod_in: st.rod_in };
  const inb = { upper_front: h.uif, upper_rear: h.uir, lower_front: h.lif, lower_rear: h.lir, tie_rod: h.tri, pushrod: st.rod_in };
  const outb = { upper_front: ub, upper_rear: ub, lower_front: lb, lower_rear: lb, tie_rod: tro, pushrod: st.rod_out };
  return [pts, inb, outb, st];
}

function solveCase(susp, sp, forces, geom = null) {
  geom = geom || loadGeometry(susp, sp);
  const pts = geom[0];
  let F = [0, 0, 0],
    M = [0, 0, 0];
  for (const [f, p] of forces) {
    F = add(F, f);
    M = add(M, cross(pts[p], f));
  }
  return solveFM(susp, sp, F, M, geom);
}

// pivot reactions on a rigid wishbone (mirrors loads.arm_reactions): equilibrium leaves only the split of the load
// along the pivot axis open; take the split that keeps the reactions closest to the leg directions
function armReactions(p1, p2, e1, e2, Fsum, Mext) {
  const d = sub(p2, p1),
    u = unit(d),
    r2 = mul(cross(d, Mext), 1 / dot(d, d)); // the part of R2 the moments fix
  const x0 = sub(mul(Fsum, -1), r2).concat(r2);
  const nv = mul(u, -1).concat(u);
  const P = x => {
    const r1 = x.slice(0, 3),
      r2 = x.slice(3);
    return sub(r1, mul(e1, dot(r1, e1))).concat(sub(r2, mul(e2, dot(r2, e2))));
  };
  const Pn = P(nv),
    Px = P(x0),
    nn = Pn.reduce((s, v) => s + v * v, 0);
  const lam = nn > 1e-18 ? -Px.reduce((s, v, i) => s + v * Pn[i], 0) / nn : 0;
  const x = x0.map((v, i) => v + lam * nv[i]);
  return [x.slice(0, 3), x.slice(3)];
}

function solveFM(susp, sp, F, M, geom = null) {
  const [pts, inb, outb, st] = geom || loadGeometry(susp, sp);
  const e = {};
  for (const k of MEMBERS) e[k] = unit(sub(inb[k], outb[k]));
  const out = {},
    rhs = F.concat(M).map(v => -v);
  const colOf = (dir, at) => dir.concat(cross(at, dir));
  const T = cols => [0, 1, 2, 3, 4, 5].map(i => cols.map(c => c[i]));
  if (sp.on === "upright") {
    const sol = solveLinear(T(MEMBERS.map(k => colOf(e[k], outb[k]))), rhs);
    if (!sol) throw new SolveError("The link layout is singular for statics. Check the hardpoints.");
    MEMBERS.forEach((k, i) => (out[k] = sol[i]));
    out.bending = 0;
  } else {
    const arm = sp.on,
      other = arm === "lower" ? "upper" : "lower",
      bj = arm === "lower" ? pts.lbj : pts.ubj;
    const unk = [`${other}_front`, `${other}_rear`, "tie_rod"];
    const cols = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
      .map(d => colOf(d, bj))
      .concat(unk.map(k => colOf(e[k], outb[k])));
    const sol = solveLinear(T(cols), rhs);
    if (!sol) throw new SolveError("The link layout is singular for statics. Check the hardpoints.");
    const Fb = sol.slice(0, 3);
    unk.forEach((k, i) => (out[k] = sol[3 + i]));
    const a = inb[`${arm}_front`],
      u = unit(sub(inb[`${arm}_rear`], a));
    const mbj = dot(u, cross(sub(bj, a), mul(Fb, -1))),
      mp = dot(u, cross(sub(pts.rod_out, a), e.pushrod));
    if (Math.abs(mp) < 1e-9) throw new SolveError("The pushrod has no lever arm about the wishbone pivot axis.");
    const Tp = -mbj / mp;
    out.pushrod = Tp;
    // the arm as one rigid body: -Fb at the ball joint, the pushrod at its mount, a reaction at each pivot
    const fRod = mul(e.pushrod, Tp),
      p1 = inb[`${arm}_front`],
      p2 = inb[`${arm}_rear`],
      e1 = e[`${arm}_front`],
      e2 = e[`${arm}_rear`];
    const Mext = add(cross(sub(bj, p1), mul(Fb, -1)), cross(sub(pts.rod_out, p1), fRod));
    const [R1, R2] = armReactions(p1, p2, e1, e2, add(mul(Fb, -1), fRod), Mext);
    out[`${arm}_front`] = dot(R1, e1);
    out[`${arm}_rear`] = dot(R2, e2);
    out.bending = Math.hypot(norm(sub(R1, mul(e1, dot(R1, e1)))), norm(sub(R2, mul(e2, dot(R2, e2)))));
  }
  const Tp = out.pushrod;
  if (sp.direct) {
    out.damper = Tp;
    out.rocker_pivot = 0;
  } else {
    const fRod = mul(unit(sub(pts.rod_out, pts.rod_in)), Tp),
      ed = unit(sub(sp.dch, st.damper_out));
    const mRod = dot(sp.k, cross(sub(pts.rod_in, sp.c), fRod)),
      md = dot(sp.k, cross(sub(st.damper_out, sp.c), ed));
    const Td = -mRod / md;
    out.damper = Td;
    out.rocker_pivot = norm(add(fRod, mul(ed, Td)));
  }
  return out;
}

function tubeProps(od, wall) {
  const di = od - 2 * wall;
  return [(Math.PI / 4) * (od ** 2 - di ** 2), (Math.PI / 64) * (od ** 4 - di ** 4)];
}

// mirrors loads.wheel_rate_at_ride
function wheelRateAtRide(cfg, susp, sp) {
  const xs = susp.states([-1, 1]),
    L1 = sp.state(xs.get(-1)).damper_len,
    L2 = sp.state(xs.get(1)).damper_len,
    mr = Math.abs(L1 - L2) / 2;
  return springRateAt(cfg.spring, 0) * mr * mr;
}
// mirrors loads.run_loads: bump and pothole are also solved at the wheel travel that load reaches
function runLoads(cfg, susp, sp, lltd = null) {
  const [cases, info] = loadCases(cfg, susp, lltd),
    results = {},
    desc = {},
    tire = {},
    fz = {},
    deflect = {};
  const geom0 = loadGeometry(susp, sp),
    kw = wheelRateAtRide(cfg, susp, sp),
    travel = travelRange(cfg)[1], // full bump
    extra = [];
  for (const [name, forces, d, parts] of cases) {
    if ((name === "bump" || name === "pothole") && kw > 1e-9) {
      const Fz = forces.reduce((acc, [f]) => acc + f[2], 0),
        // dual-rate spring or bump stop: integrate the rate curve
        dz = springNonlinear(cfg.spring)
          ? wheelTravelUnder(cfg, susp, sp, Fz - info.Fz0, travel)
          : Math.min(travel, Math.max(0, (Fz - info.Fz0) / kw));
      if (dz > 0.05)
        extra.push([
          `${name} (deflected)`,
          forces,
          `${d}, solved at +${dz.toFixed(1)} mm of wheel travel${dz >= travel ? " (full bump)" : ""}`,
          parts,
          dz,
        ]);
    }
  }
  for (const [name, forces, d, parts, dz] of cases.map(c => c.concat([0])).concat(extra)) {
    let geom;
    try {
      geom = dz ? loadGeometry(susp, sp, dz) : geom0;
    } catch (e) {
      if (e instanceof SolveError) continue;
      throw e;
    }
    results[name] = solveCase(susp, sp, forces, geom);
    desc[name] = d;
    fz[name] = parts;
    tire[name] = forces.reduce((acc, [f]) => add(acc, f), [0, 0, 0]);
    if (dz) deflect[name] = dz;
  }
  info.wheel_rate = kw;
  const mem = cfg.members,
    [, inb, outb] = loadGeometry(susp, sp);
  const size = {
    upper_front: "wishbone",
    upper_rear: "wishbone",
    lower_front: "wishbone",
    lower_rear: "wishbone",
    tie_rod: "tie_rod",
    pushrod: "pushrod",
  };
  const checks = MEMBERS.map(k => {
    const [od, wall] = mem[size[k]],
      [A, I] = tubeProps(od, wall),
      L = norm(sub(inb[k], outb[k]));
    const Pcr = (Math.PI ** 2 * mem.E * I) / L ** 2,
      Py = mem.yield * A;
    const vals = Object.entries(results).map(([n, r]) => [r[k], n]);
    const cmin = vals.reduce((m, v) => (v[0] < m[0] ? v : m)),
      tmax = vals.reduce((m, v) => (v[0] > m[0] ? v : m));
    const pk = vals.reduce((m, v) => (Math.abs(v[0]) > m[0] ? [Math.abs(v[0]), v[1]] : m), [-1, ""]);
    const comp = cmin[0] < 0 ? -cmin[0] : 0;
    return {
      member: k,
      size: size[k],
      length: L,
      od,
      wall,
      area: A,
      tension: Math.max(0, tmax[0]),
      t_case: tmax[1],
      compression: comp,
      c_case: cmin[1],
      Pcr,
      Py,
      peak: pk[0],
      p_case: pk[1],
      sf_buckle: comp > 1e-6 ? Pcr / comp : Infinity,
      sf_yield: pk[0] > 1e-6 ? Py / pk[0] : Infinity,
    };
  });
  return {
    results,
    desc,
    tire,
    fz_parts: fz,
    info,
    deflect,
    checks,
    parts: partChecks(cfg, checks),
    bending_check: bendingCheck(cfg, susp, sp, results, deflect),
    compliance: compliance(cfg, susp, sp, results),
  };
}
// mirrors loads.link_stiffness / loads.compliance (unit-load method)
const IMPACT_CASES = ["bump", "pothole", "kerb strike", "bump (deflected)", "pothole (deflected)"];
function linkStiffness(cfg, k, length) {
  const mem = cfg.members,
    size = /^(upper|lower)/.test(k) ? "wishbone" : k,
    [A] = tubeProps(...mem[size]);
  const parts = [(mem.E * A) / length];
  if (mem.rod_end_k) parts.push(+mem.rod_end_k, +mem.rod_end_k);
  if (mem.mount_k) parts.push(+mem.mount_k);
  if (k === "tie_rod" && cfg.axle === "front") parts.push(...steeringStiffness(cfg));
  return 1 / parts.reduce((s, x) => s + 1 / x, 0);
}
// mirrors compliance.steering_stiffness: the rack (rack_k) and the column's torsion (column_k) seen at the rack
function steeringStiffness(cfg) {
  const mem = cfg.members,
    out = [],
    cf = cfg.vehicle.rack_c_factor;
  if (mem.rack_k) out.push(+mem.rack_k);
  if (mem.column_k && cf) out.push(+mem.column_k / ((cf / (2 * Math.PI) / 1000) * (cf / 360)));
  return out;
}
function compliance(cfg, susp, sp, results) {
  const [, inb, outb] = loadGeometry(susp, sp),
    k = {};
  for (const m of MEMBERS) k[m] = linkStiffness(cfg, m, norm(sub(inb[m], outb[m])));
  const I3 = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    Z = [0, 0, 0],
    cp = susp.h.cp,
    deg = 180 / Math.PI;
  const unitRows = I3.map(f => solveFM(susp, sp, f, Z)).concat(I3.map(m => solveFM(susp, sp, Z, m)));
  const cases = Object.entries(results).map(([name, r]) => {
    const st = {};
    for (const m of MEMBERS) st[m] = r[m] / k[m];
    const q = unitRows.map(u => MEMBERS.reduce((s, m) => s + st[m] * u[m], 0)),
      d = q.slice(0, 3),
      th = q.slice(3);
    const dcp = add(d, cross(th, cp));
    return {
      case: name,
      camber: -th[0] * deg,
      toe: -th[2] * deg,
      cp_y: dcp[1],
      cp_z: dcp[2],
      worst_stretch: Math.max(...MEMBERS.map(m => Math.abs(st[m]))),
      d,
      theta: th,
      driving: !IMPACT_CASES.includes(name),
    };
  });
  const mem = cfg.members,
    tl = mem.toe_comp_limit ?? null,
    cl = mem.camber_comp_limit ?? null;
  let drv = cases.filter(c => c.driving);
  if (!drv.length) drv = cases;
  const worst = key => drv.reduce((m, c) => (Math.abs(c[key]) > Math.abs(m[key]) ? c : m));
  const wt = worst("toe"),
    wc = worst("camber");
  return {
    stiffness: k,
    cases,
    toe_limit: tl,
    camber_limit: cl,
    worst_toe: wt,
    worst_camber: wc,
    toe_ok: tl == null || Math.abs(wt.toe) <= tl,
    camber_ok: cl == null || Math.abs(wc.camber) <= cl,
  };
}
// mirrors loads.part_checks / loads.bending_check
const BOLT_UTS = { "8.8": 800, "10.9": 1040, "12.9": 1220, "SAE 5": 827, "SAE 8": 1034 };
function partChecks(cfg, rows) {
  const mem = cfg.members,
    d = +(mem.bolt_dia || 0),
    planes = +(mem.bolt_shear_planes || 2),
    uts = BOLT_UTS[String(mem.bolt_grade)] || 0;
  const cap = d && uts ? ((planes * Math.PI) / 4) * d * d * 0.6 * uts : null,
    rating = mem.rod_end_rating || null;
  return rows.map(r => ({
    member: r.member,
    peak: r.peak,
    p_case: r.p_case,
    bolt_capacity: cap,
    sf_bolt: cap ? (r.peak > 1e-6 ? cap / r.peak : Infinity) : null,
    rod_end_rating: rating,
    sf_rod_end: rating ? (r.peak > 1e-6 ? rating / r.peak : Infinity) : null,
  }));
}
function bendingCheck(cfg, susp, sp, results, deflect = {}) {
  if (sp.on !== "lower" && sp.on !== "upper") return null;
  const [pts, inb, outb] = loadGeometry(susp, sp),
    arm = sp.on;
  let best = null;
  for (const leg of [`${arm}_front`, `${arm}_rear`]) {
    const p0 = inb[leg],
      p1 = outb[leg],
      u = unit(sub(p1, p0)),
      Lg = norm(sub(p1, p0));
    const a = Math.min(Lg, Math.max(0, dot(sub(pts.rod_out, p0), u))),
      off = norm(sub(pts.rod_out, add(p0, mul(u, a))));
    if (!best || off < best.off) best = { leg, u, Lg, off, a };
  }
  const { leg, Lg, off, a } = best,
    [od, wall] = cfg.members.wishbone,
    [A, I] = tubeProps(od, wall);
  let worst = null;
  for (const [name, r] of Object.entries(results)) {
    const [gp, gi, go] = deflect[name] ? loadGeometry(susp, sp, deflect[name]) : [pts, inb, outb];
    const p0 = gi[leg],
      p1 = go[leg],
      uu = unit(sub(p1, p0)),
      Lc = norm(sub(p1, p0));
    const ac = Math.min(Lc, Math.max(0, dot(sub(gp.rod_out, p0), uu)));
    const F = mul(unit(sub(gp.rod_in, gp.rod_out)), r.pushrod),
      Fu = dot(F, uu),
      Pp = norm(sub(F, mul(uu, Fu))),
      M = (Pp * ac * (Lc - ac)) / Lc;
    const nPivot = r[leg],
      nNode = nPivot - Fu; // leg tension either side of the mount
    const sig = (M * (od / 2)) / I + Math.max(Math.abs(nPivot), Math.abs(nNode)) / A;
    if (!worst || sig > worst.stress) worst = { case: name, P_perp: Pp, moment: M, stress: sig, n_pivot: nPivot, n_node: nNode };
  }
  return Object.assign(
    { leg, length: Lg, a, offset: off, od, wall, sf: worst.stress > 1e-9 ? cfg.members.yield / worst.stress : Infinity },
    worst
  );
}
