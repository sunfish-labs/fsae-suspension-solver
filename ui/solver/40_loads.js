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

const STATICS_SINGULAR =
  "The links can't hold the wheel in this position: two or more of them line up (for example the tie rod in line with a wishbone leg). Check the hardpoints.";
function solveFM(susp, sp, F, M, geom = null) {
  const [pts, inb, outb, st] = geom || loadGeometry(susp, sp);
  const e = {};
  for (const k of MEMBERS) e[k] = unit(sub(inb[k], outb[k]));
  const out = {},
    rhs = F.concat(M).map(v => -v);
  const colOf = (dir, at) => dir.concat(cross(at, dir)),
    solveStatics = A => {
      // refuse a near-singular layout, as Python does (it would give huge, meaningless forces)
      if (!(cond1(A) < 1e12)) throw new SolveError(STATICS_SINGULAR);
      return solveLinear(A, rhs);
    };
  const T = cols => [0, 1, 2, 3, 4, 5].map(i => cols.map(c => c[i]));
  if (sp.on === "upright") {
    const sol = solveStatics(T(MEMBERS.map(k => colOf(e[k], outb[k]))));
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
    const sol = solveStatics(T(cols));
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
    deflect = {},
    skipped = [];
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
      if (!(e instanceof SolveError)) throw e;
      skipped.push([name, dz]); // the wheel can't reach that travel: keep the ride-height case only
      continue;
    }
    results[name] = solveCase(susp, sp, forces, geom);
    desc[name] = d;
    fz[name] = parts;
    tire[name] = forces.reduce((acc, [f]) => add(acc, f), [0, 0, 0]);
    if (dz) deflect[name] = dz;
  }
  info.wheel_rate = kw;
  info.skipped = skipped;
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
    rocker_check: rockerCheck(cfg, susp, sp, results, deflect),
    compliance: compliance(cfg, susp, sp, results),
    durability: durability(cfg, susp, sp, results, info, deflect),
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
// mirrors strength.rod_leg: the leg of the arm carrying the rod that the mount sits closest to
function rodLeg(susp, sp) {
  const [pts, inb, outb] = loadGeometry(susp, sp);
  let best = null;
  for (const leg of [`${sp.on}_front`, `${sp.on}_rear`]) {
    const p0 = inb[leg],
      p1 = outb[leg],
      u = unit(sub(p1, p0)),
      Lg = norm(sub(p1, p0));
    const a = Math.min(Lg, Math.max(0, dot(sub(pts.rod_out, p0), u))),
      off = norm(sub(pts.rod_out, add(p0, mul(u, a))));
    if (!best || off < best.off) best = { leg, Lg, a, off };
  }
  return best;
}
// mirrors strength.leg_stress: peak fiber stress (bending + |axial|) in that leg
// the leg's section with a gusset plate standing on the tube in the load plane (mirrors strength.section)
function legSection(od, wall, tg = 0, h = 0) {
  const [At, It] = tubeProps(od, wall),
    r = od / 2;
  if (h <= 1e-9 || tg <= 0) return [At, It, r];
  const Ap = tg * h,
    yp = r + h / 2,
    A = At + Ap,
    yb = (Ap * yp) / A,
    I = It + At * yb ** 2 + (tg * h ** 3) / 12 + Ap * (yp - yb) ** 2;
  return [A, I, Math.max(r + yb, r + h - yb)];
}
function gussetOf(cfg) {
  const g = (cfg.members || {}).gusset;
  if (!g) return null;
  if (g.type === "to_node") return { type: "to_node" };
  return {
    type: "along_leg",
    thickness: +g.thickness,
    height: +g.height,
    length_in: +(g.length_in || 0),
    length_out: +(g.length_out || 0),
    fat: g.fat ? +g.fat : null,
  };
}
function legStress(cfg, leg, r, geom) {
  const [gp, gi, go] = geom,
    [od, wall] = cfg.members.wishbone;
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
  const g = gussetOf(cfg),
    base = { P_perp: Pp, moment: M, n_pivot: nPivot, n_node: nNode };
  if (g && g.type === "to_node") {
    const [A] = tubeProps(od, wall);
    return Object.assign(base, {
      moment: 0,
      stress: Math.max(Math.abs(nPivot), Math.abs(nNode)) / A,
      x: ac,
      where: "carried to the ball-joint node by the bracket",
      end_stress: null,
    });
  }
  if (!g) {
    const [A, I] = tubeProps(od, wall);
    const sig = (M * (od / 2)) / I + Math.max(Math.abs(nPivot), Math.abs(nNode)) / A;
    return Object.assign(base, { stress: sig, x: ac, where: "at the mount", end_stress: null });
  }
  const xIn = Math.max(0, ac - g.length_in),
    xOut = Math.min(Lc, ac + g.length_out);
  const hAt = x => {
    if (x < xIn || x > xOut) return 0;
    const side = x <= ac ? ac - xIn : xOut - ac;
    return side > 1e-9 ? g.height * (1 - Math.abs(x - ac) / side) : Math.abs(x - ac) < 1e-9 ? g.height : 0;
  };
  const stressAt = (x, h = null) => {
    const [A, I, c] = legSection(od, wall, g.thickness, h == null ? hAt(x) : h),
      Mx = x <= ac ? (Pp * x * (Lc - ac)) / Lc : (Pp * ac * (Lc - x)) / Lc;
    return (Mx * c) / I + Math.abs(x <= ac ? nPivot : nNode) / A;
  };
  const xs = [...new Set(Array.from({ length: 401 }, (_, i) => (Lc * i) / 400).concat([xIn, xOut, ac]))].sort((a, b) => a - b);
  let best = [-Infinity, 0];
  for (const x of xs) {
    const s = stressAt(x);
    if (s > best[0] || (s === best[0] && x > best[1])) best = [s, x];
  }
  const ends = [xIn, xOut].filter(x => x > 0 && x < Lc).map(x => stressAt(x, 0)),
    x = best[1];
  const where =
    Math.min(Math.abs(x - xIn), Math.abs(x - xOut)) < Lc / 400 + 1e-9 && x !== ac
      ? "gusset end"
      : x > xIn && x < xOut
        ? "in the gusset"
        : "bare tube";
  return Object.assign(base, { stress: best[0], x, where, end_stress: ends.length ? Math.max(...ends) : null });
}
function bendingCheck(cfg, susp, sp, results, deflect = {}) {
  if (sp.on !== "lower" && sp.on !== "upper") return null;
  const geom0 = loadGeometry(susp, sp),
    { leg, Lg, off, a } = rodLeg(susp, sp),
    [od, wall] = cfg.members.wishbone;
  let worst = null;
  for (const [name, r] of Object.entries(results)) {
    const s = legStress(cfg, leg, r, deflect[name] ? loadGeometry(susp, sp, deflect[name]) : geom0);
    if (!worst || s.stress > worst.stress) worst = Object.assign({ case: name }, s);
  }
  return Object.assign(
    {
      leg,
      length: Lg,
      a,
      offset: off,
      od,
      wall,
      gusset: gussetOf(cfg),
      sf: worst.stress > 1e-9 ? cfg.members.yield / worst.stress : Infinity,
    },
    worst
  );
}
// ---------------------------------------------------------------- the rocker's plates (mirrors loads.rocker_check)
const ROCKER_YIELD = 241.0;
function rockerOf(cfg) {
  const rk = (cfg.members || {}).rocker;
  if (!rk) return null;
  return {
    thickness: +rk.thickness,
    plates: Math.trunc(+rk.plates || 2),
    pivot_bore: +rk.pivot_bore,
    pivot_edge: +rk.pivot_edge,
    pin_dia: +(rk.pin_dia || cfg.members.bolt_dia || 8.0),
    edge: +rk.edge,
    width: +rk.width,
    yield_: +(rk.yield || ROCKER_YIELD),
  };
}
function rockerForces(susp, sp, r, geom) {
  const [pts, , , st] = geom,
    push = mul(unit(sub(pts.rod_out, pts.rod_in)), +r.pushrod),
    dmp = mul(unit(sub(sp.dch, st.damper_out)), +r.damper);
  return { pushrod: [pts.rod_in, push], damper: [st.damper_out, dmp], pivot: [sp.c, mul(add(push, dmp), -1)] };
}
function rockerStress(rk, sp, fr) {
  const n = rk.plates,
    t = rk.thickness,
    k = sp.k,
    holes = {},
    arms = {};
  let oop = 0;
  for (const [end, [p, F]] of Object.entries(fr)) {
    const Fm = norm(F),
      Fi = perp(F, k),
      Fip = norm(Fi);
    if (Fm > 1e-9) oop = Math.max(oop, Math.abs(dot(F, k)) / Fm);
    const [d, e] = end === "pivot" ? [rk.pivot_bore, rk.pivot_edge] : [rk.pin_dia, rk.edge];
    holes[end] = { force: Fip, d, edge: e, stress: { bearing: Fip / (n * t * d), tearout: Fip / (n * 2 * t * (e - d / 2)) } };
    if (end === "pivot") continue;
    const rv = perp(sub(p, sp.c), k),
      L = norm(rv),
      u = L > 1e-9 ? mul(rv, 1 / L) : rv,
      fAl = dot(Fi, u),
      fAc = norm(sub(Fi, mul(u, fAl))),
      lever = Math.max(0, L - rk.pivot_edge),
      w = rk.width,
      M = fAc * lever;
    arms[end] = { length: L, lever, across: fAc, along: fAl, moment: M, stress: (6 * M) / (n * t * w * w) + Math.abs(fAl) / (n * t * w) };
  }
  return [holes, arms, oop];
}
function rockerCheck(cfg, susp, sp, results, deflect = {}) {
  const rk = rockerOf(cfg);
  if (!rk || sp.direct) return null;
  const geom0 = loadGeometry(susp, sp),
    sy = rk.yield_,
    allow = { bearing: sy, tearout: 0.577 * sy },
    holes = {},
    arms = {};
  let oop = [0, null];
  for (const [name, r] of Object.entries(results)) {
    const g = deflect[name] ? loadGeometry(susp, sp, deflect[name]) : geom0,
      [h, a, o] = rockerStress(rk, sp, rockerForces(susp, sp, r, g));
    if (o > oop[0]) oop = [o, name];
    for (const [end, v] of Object.entries(h)) {
      const fos = Object.fromEntries(Object.entries(v.stress).map(([m, s]) => [m, s > 1e-9 ? allow[m] / s : Infinity])),
        gov = fos.bearing <= fos.tearout ? "bearing" : "tearout";
      if (!holes[end] || fos[gov] < holes[end].sf) holes[end] = Object.assign({}, v, { case: name, fos, governs: gov, sf: fos[gov] });
    }
    for (const [end, v] of Object.entries(a)) {
      const sf = v.stress > 1e-9 ? sy / v.stress : Infinity;
      if (!arms[end] || sf < arms[end].sf) arms[end] = Object.assign({}, v, { case: name, sf });
    }
  }
  const rows = [...Object.entries(holes).map(([k, v]) => [`hole:${k}`, v.sf]), ...Object.entries(arms).map(([k, v]) => [`arm:${k}`, v.sf])];
  const govRow = rows.reduce((b, x) => (b === null || x[1] < b[1] ? x : b), null);
  return {
    rocker: Object.assign({}, rk, { yield: sy }),
    holes,
    arms,
    out_of_plane: oop[0],
    oop_case: oop[1],
    sf: rows.length ? Math.min(...rows.map(x => x[1])) : Infinity,
    governs: govRow ? govRow[0] : null,
  };
}
// ---------------------------------------------------------------- part loads for FEA (mirrors loads/parts.py)
// every force on the upright, each wishbone and the rocker of the right-hand corner, per case: [name, point, force]
const TIRE_PT = { cp: "contact patch", c: "wheel center" };
function partLoads(cfg, susp, sp, run) {
  const [cases] = loadCases(cfg, susp, run.info.lltd),
    forces = Object.fromEntries(cases.map(([n, f]) => [n, f])),
    out = {};
  for (const [name, r] of Object.entries(run.results)) {
    const dz = run.deflect[name] || 0,
      [pts, inb, outb, st] = dz ? loadGeometry(susp, sp, dz) : loadGeometry(susp, sp),
      e = Object.fromEntries(Object.keys(inb).map(k => [k, unit(sub(inb[k], outb[k]))]));
    const T = k => +r[k],
      up = forces[name.replace(" (deflected)", "")].map(([F, p]) => [`tire force at the ${TIRE_PT[p]}`, pts[p], F.slice()]);
    up.push(["tie rod outboard", pts.tro, mul(e.tie_rod, T("tie_rod"))]);
    const fRod = mul(unit(sub(pts.rod_in, pts.rod_out)), T("pushrod")),
      parts = {},
      arms = { upper: ["ubj", "upper_front", "upper_rear"], lower: ["lbj", "lower_front", "lower_rear"] };
    for (const [arm, [bj, kf, kr]] of Object.entries(arms)) {
      if (arm === sp.on) continue;
      const onUp = add(mul(e[kf], T(kf)), mul(e[kr], T(kr))),
        ff = inb[kf][0] >= inb[kr][0];
      up.push([`${arm} ball joint`, pts[bj], onUp]);
      parts[`${arm} wishbone`] = [
        ["ball joint", pts[bj], mul(onUp, -1)],
        [ff ? "front pivot" : "rear pivot", inb[kf], mul(e[kf], T(kf))],
        [ff ? "rear pivot" : "front pivot", inb[kr], mul(e[kr], T(kr))],
      ];
    }
    if (sp.on === "upright") up.push(["pushrod mount", pts.rod_out, fRod]);
    else {
      const [bj, kf, kr] = arms[sp.on],
        Fb = mul(
          up.reduce((s, [, , F]) => add(s, F), [0, 0, 0]),
          -1
        ),
        p1 = inb[kf],
        p2 = inb[kr],
        ff = p1[0] >= p2[0];
      up.push([`${sp.on} ball joint`, pts[bj], Fb]);
      const Mext = add(cross(sub(pts[bj], p1), mul(Fb, -1)), cross(sub(pts.rod_out, p1), fRod)),
        [R1, R2] = armReactions(p1, p2, e[kf], e[kr], add(mul(Fb, -1), fRod), Mext);
      parts[`${sp.on} wishbone`] = [
        ["ball joint", pts[bj], mul(Fb, -1)],
        ["pushrod mount", pts.rod_out, fRod],
        [ff ? "front pivot" : "rear pivot", p1, R1],
        [ff ? "rear pivot" : "front pivot", p2, R2],
      ];
    }
    const ordered = { upright: up };
    for (const k of Object.keys(parts).sort().reverse()) ordered[k] = parts[k];
    if (!sp.direct) {
      const push = mul(unit(sub(pts.rod_out, pts.rod_in)), T("pushrod")),
        dmp = mul(unit(sub(sp.dch, st.damper_out)), +r.damper);
      ordered.rocker = [
        ["pushrod end", pts.rod_in, push],
        ["damper end", st.damper_out, dmp],
        ["pivot", sp.c, mul(add(push, dmp), -1)],
      ];
    }
    out[name] = ordered;
  }
  return out;
}
// ---------------------------------------------------------------- brackets and fatigue (mirrors loads/durability.py)
const SURFACE = {
  ground: [1.58, -0.085],
  machined: [4.51, -0.265],
  "cold-drawn": [4.51, -0.265],
  "hot-rolled": [57.7, -0.718],
  "as-forged": [272.0, -0.995],
};
const TAB_DEFAULT = { thickness: 3.175, width: 25.4, edge: 12.7, weld_leg: 3.0, weld_length: 50.0, count: 2 };
const CAFL = (2e6 / 1e7) ** (1 / 3);
const MEMBER_SIZE = {
  upper_front: "wishbone",
  upper_rear: "wishbone",
  lower_front: "wishbone",
  lower_rear: "wishbone",
  tie_rod: "tie_rod",
  pushrod: "pushrod",
};
function tabOf(mem) {
  const tab = Object.assign({}, TAB_DEFAULT, mem.tab || {}),
    d = +(mem.bolt_dia || 8);
  if (tab.edge <= d / 2) throw new SolveError(`members.tab.edge (${tab.edge} mm) must be more than half the bolt (${d / 2} mm)`);
  if (tab.width <= d) throw new SolveError(`members.tab.width (${tab.width} mm) must be more than the bolt (${d} mm)`);
  return [tab, d];
}
function endurance(mem, bendingOd = null) {
  const sut = +(mem.uts || 670),
    se0 = sut <= 1400 ? 0.5 * sut : 700,
    [a, b] = SURFACE[String(mem.surface || "machined")] || SURFACE.machined,
    ka = a * sut ** b;
  let kb, kc;
  if (bendingOd) {
    kb = bendingOd <= 51 ? 1.24 * bendingOd ** -0.107 : 1.51 * bendingOd ** -0.157;
    kc = 1;
  } else [kb, kc] = [1, 0.85];
  return [ka * kb * kc * se0, { sut, se0, ka, kb, kc }];
}
function snStrength(se, sut, N, f = 0.9) {
  if (N >= 1e6) return se;
  N = Math.max(N, 1e3);
  const b = -Math.log10((f * sut) / se) / 3;
  return ((f * sut) ** 2 / se) * N ** b;
}
function snLife(se, sut, sa, sm, f = 0.9) {
  const sar = sm > 0 ? sa / (1 - sm / sut) : sa;
  if (sm >= sut || sar >= f * sut) return 1e3;
  if (sar <= se) return Infinity;
  const b = -Math.log10((f * sut) / se) / 3;
  return (sar / ((f * sut) ** 2 / se)) ** (1 / b);
}
const weldAllow = (fat, N) => (N < 1e7 ? fat * (2e6 / Math.max(N, 1e4)) ** (1 / 3) : CAFL * fat);
const weldLife = (fat, rng) => (rng <= CAFL * fat ? Infinity : 2e6 * (fat / rng) ** 3);
const goodman = (sa, sm, se, sut) => (sa <= 1e-9 ? Infinity : sm < 0 ? se / sa : 1 / (sa / se + sm / sut));
function durability(cfg, susp, sp, results, info, deflect = {}) {
  const mem = cfg.members,
    [tab, d] = tabOf(mem),
    n = +tab.count,
    t = +tab.thickness,
    W = +tab.width,
    e = +tab.edge,
    leg_ = +tab.weld_leg,
    Lw = +tab.weld_length,
    sy = +(mem.tab_yield || mem.yield);
  const geom0 = loadGeometry(susp, sp),
    stat = solveCase(susp, sp, [[[0, 0, info.Fz0], "cp"]], geom0);
  const ends = MEMBERS.concat(["damper"], sp.direct ? [] : ["rocker_pivot"]);
  const tabs = ends.map(key => {
    let F = -1,
      kase = "";
    for (const [name, r] of Object.entries(results)) {
      const v = Math.abs(r[key]);
      if (v > F || (v === F && name > kase)) [F, kase] = [v, name];
    }
    const st = {
      bearing: F / (n * t * d),
      tearout: F / (n * 2 * t * (e - d / 2)),
      net: F / (n * t * (W - d)),
      weld: F / (n * Lw * 0.707 * leg_),
    };
    const fos =
      F > 1e-9
        ? { bearing: sy / st.bearing, tearout: (0.577 * sy) / st.tearout, net: sy / st.net, weld: (0.577 * sy) / st.weld }
        : { bearing: Infinity, tearout: Infinity, net: Infinity, weld: Infinity };
    const gov = Object.keys(fos).reduce((g, k) => (fos[k] < fos[g] ? k : g));
    return { member: key, force: F, case: kase, stress: st, fos, governs: gov, sf: fos[gov] };
  });
  let cyc = Object.keys(results).filter(nm => !nm.startsWith("pothole") && !nm.startsWith("kerb strike"));
  if (cyc.includes("bump (deflected)")) cyc = cyc.filter(nm => nm !== "bump");
  // each driving case from rest and back, then the swings between opposite cases (mirrors durability.swings)
  const REST = "at rest",
    sw = cyc
      .map(c => [c, REST])
      .concat(
        [
          ["corner outer", "corner inner"],
          ["brake+corner outer", "brake+corner inner"],
          ["braking", "acceleration"],
        ].filter(([a, b]) => a in results && b in results)
      );
  const L = cfg.loads || {},
    nDrive = +(L.fatigue_cycles || 1e5),
    nBump = +(L.fatigue_bump_cycles || 1e4),
    fatTube = +(mem.weld_fat_tube || 45),
    fatTab = +(mem.weld_fat_tab || 36);
  const [seAx, facAx] = endurance(mem),
    sut = facAx.sut,
    rows = [];
  const worst = (label, kind, base, stress) => {
    let best = null;
    for (const [c0, c2] of sw) {
      const sc = stress(c0),
        ss = stress(c2),
        sa = Math.abs(sc - ss) / 2,
        sm = (sc + ss) / 2,
        N = c2 !== REST ? nDrive : c0.startsWith("bump") ? nBump : nDrive,
        c = c2 === REST ? c0 : `${c0} ↔ ${c2}`;
      let allow, life, nn;
      if (kind === "weld") {
        allow = weldAllow(base, N);
        life = weldLife(base, 2 * sa);
        nn = sa > 1e-9 ? allow / (2 * sa) : Infinity;
      } else {
        allow = snStrength(base, sut, N);
        life = snLife(base, sut, sa, sm);
        nn = goodman(sa, sm, allow, sut);
      }
      if (!best || nn < best.n) best = { item: label, kind, case: c, cycles: N, s_a: sa, s_m: sm, allow, n: nn, life };
    }
    rows.push(best);
  };
  for (const k of MEMBERS) {
    const [A] = tubeProps(...mem[MEMBER_SIZE[k]]),
      per = c => (c === REST ? stat : results[c])[k] / A;
    worst(k, "tube", seAx, per);
    worst(k, "weld", fatTube, per);
  }
  for (const key of ends) {
    const th = n * Lw * 0.707 * leg_;
    worst(`tab:${key}`, "weld", fatTab, c => (c === REST ? stat : results[c])[key] / th);
  }
  if (sp.on === "lower" || sp.on === "upper") {
    const leg = rodLeg(susp, sp).leg,
      [seB] = endurance(mem, +mem.wishbone[0]),
      sRest = legStress(cfg, leg, stat, geom0).stress;
    worst(`leg:${leg}`, "tube", seB, c =>
      c === REST ? sRest : legStress(cfg, leg, results[c], deflect[c] ? loadGeometry(susp, sp, deflect[c]) : geom0).stress
    );
    const g = gussetOf(cfg);
    if (g && g.type === "along_leg" && legStress(cfg, leg, stat, geom0).end_stress != null) {
      // the weld toe where the gusset stops on the tube: IIW longitudinal attachment, class by the gusset's length
      const Lg2 = g.length_in + g.length_out,
        fatG = g.fat || (Lg2 <= 50 ? 80 : Lg2 <= 150 ? 71 : Lg2 <= 300 ? 63 : 50);
      worst(`gusset:${leg}`, "weld", fatG, c =>
        c === REST
          ? legStress(cfg, leg, stat, geom0).end_stress || 0
          : legStress(cfg, leg, results[c], deflect[c] ? loadGeometry(susp, sp, deflect[c]) : geom0).end_stress || 0
      );
    }
  }
  const sfFat = +(mem.fatigue_sf || 1.5);
  for (const r of rows) r.ok = r.n >= sfFat;
  return {
    tabs,
    tab,
    bolt: d,
    tab_yield: sy,
    static: stat,
    cycle_cases: cyc,
    swings: sw,
    fatigue: rows,
    cycles: nDrive,
    bump_cycles: nBump,
    fatigue_sf: sfFat,
    endurance: Object.assign({ se_axial: seAx }, facAx),
    weld_fat_tube: fatTube,
    weld_fat_tab: fatTab,
    tab_sf_min: Math.min(...tabs.map(r => r.sf)),
    fatigue_n_min: Math.min(...rows.map(r => r.n)),
  };
}
