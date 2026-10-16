// CAD export: the suspension as reference geometry (points and lines, optional tube bodies) for SolidWorks,
// Fusion, Onshape, NX or CATIA. Pure functions, no DOM: SuspCAD.geometry() builds named points and lines from
// evaluated corners (Susp.evaluate), and toIGES / toSTEP / toCSV / toSTL write them out. Runs in the browser and
// in Node (tests).
(function (root) {
  "use strict";
  const S = root.Susp;
  const { add, sub, mul, norm, unit, cross } = S.vec;

  // Solver frame: X forward, Y outboard on the right wheel (= right), Z up, ground at Z = 0, car centerline at Y = 0.
  // That frame is left-handed, so each export frame below is a proper right-handed CAD frame with the right-hand
  // corners on the right of the car.
  const FRAMES = {
    sw: { label: "SolidWorks default: X forward, Y up, Z right", f: ([x, y, z]) => [x, z, y] },
    iso: { label: "X forward, Y left, Z up (ISO 8855 vehicle axes)", f: ([x, y, z]) => [x, -y, z] },
    adams: { label: "X rearward, Y right, Z up (ADAMS / Liu et al.)", f: ([x, y, z]) => [-x, y, z] },
    solver: { label: "As in the solver: X forward, Y right, Z up (left-handed: right corners land on CAD's left)", f: p => p.slice() },
  };
  const POSES = { ride: "ride height", bump: "full bump", droop: "full droop", steer_p: "full rack +", steer_m: "full rack −" };
  // IGES colour numbers: 1 black, 2 red, 3 green, 4 blue, 6 magenta, 7 cyan
  const POSE_COLOR = { ride: 4, bump: 2, droop: 3, steer_p: 6, steer_m: 7 };

  function rockerGuess(e, dz) {
    if (!e.ride || !e.rows) return 0;
    let best = e.rows[0];
    for (const q of e.rows) if (Math.abs(q.dz - dz) < Math.abs(best.dz - dz)) best = q;
    return ((best.rocker_deg || 0) * Math.PI) / 180;
  }

  // one corner at one pose, right-hand side, solver frame: named points and links
  function cornerAt(e, dz, rack) {
    const s = e.susp,
      sp = e.spring,
      h = s.h,
      x = s.pose(dz, rack),
      o = s.observe(x, dz, rack),
      p = o._pts;
    const rear = e.cfg.axle === "rear",
      tr = rear ? "toe_link" : "tie_rod";
    const fr = (a, b) => (a[0] >= b[0] ? "front" : "rear");
    const P = {
      [`UCA_${fr(h.uif, h.uir)}_pivot`]: h.uif,
      [`UCA_${fr(h.uir, h.uif)}_pivot`]: h.uir,
      UCA_ball_joint: p.ub,
      [`LCA_${fr(h.lif, h.lir)}_pivot`]: h.lif,
      [`LCA_${fr(h.lir, h.lif)}_pivot`]: h.lir,
      LCA_ball_joint: p.lb,
      [`${tr}_inboard`]: p.tri,
      [`${tr}_outboard`]: p.tro,
      wheel_center: p.c,
      contact_patch: p.cp,
    };
    const uf = `UCA_${fr(h.uif, h.uir)}_pivot`,
      ur = `UCA_${fr(h.uir, h.uif)}_pivot`,
      lf = `LCA_${fr(h.lif, h.lir)}_pivot`,
      lr = `LCA_${fr(h.lir, h.lif)}_pivot`;
    const L = [
      [`UCA_${uf.split("_")[1]}_leg`, uf, "UCA_ball_joint", "wishbone"],
      [`UCA_${ur.split("_")[1]}_leg`, ur, "UCA_ball_joint", "wishbone"],
      [`LCA_${lf.split("_")[1]}_leg`, lf, "LCA_ball_joint", "wishbone"],
      [`LCA_${lr.split("_")[1]}_leg`, lr, "LCA_ball_joint", "wishbone"],
      [tr, `${tr}_inboard`, `${tr}_outboard`, "tie_rod"],
      ["upright_axis", "LCA_ball_joint", "UCA_ball_joint", null],
    ];
    P.spin_axis_in = sub(p.c, mul(p.a, 40));
    P.spin_axis_out = add(p.c, mul(p.a, 40));
    L.push(["spin_axis", "spin_axis_in", "spin_axis_out", null]);
    if (sp) {
      const st = sp.state(x, rockerGuess(e, dz));
      P.pushrod_outboard = st.rod_out;
      P.damper_chassis = sp.dch;
      if (sp.direct) {
        L.push(["damper", "pushrod_outboard", "damper_chassis", "damper"]);
      } else {
        Object.assign(P, {
          pushrod_inboard: st.rod_in,
          rocker_pivot: sp.c,
          rocker_damper: st.damper_out,
          rocker_axis_a: sub(sp.c, mul(sp.k, 20)),
          rocker_axis_b: add(sp.c, mul(sp.k, 20)),
        });
        L.push(
          ["pushrod", "pushrod_outboard", "pushrod_inboard", "pushrod"],
          ["rocker_rod_arm", "rocker_pivot", "pushrod_inboard", null],
          ["rocker_damper_arm", "rocker_pivot", "rocker_damper", null],
          ["rocker_edge", "pushrod_inboard", "rocker_damper", null],
          ["rocker_axis", "rocker_axis_a", "rocker_axis_b", null],
          ["damper", "rocker_damper", "damper_chassis", "damper"]
        );
      }
    }
    return { P, L };
  }

  /* corners: [{ e }] from Susp.evaluate (e.cfg.axle says front or rear). opts:
       frame: key of FRAMES (default "sw"); origin: "axle" (front axle centerline on the ground) or "solver";
       units: "mm" | "in"; poses: subset of ["bump", "droop", "steer"] added to the ride-height geometry;
       wheelbase: for a car, the rear corner is placed this far behind the front contact patch.
     Returns { points: [{name, layer, p}], lines: [{name, layer, a, b, color, od}], layers, units, frame }. */
  function geometry(corners, opts = {}) {
    const fr = FRAMES[opts.frame || "sw"],
      k = opts.units === "in" ? 1 / 25.4 : 1,
      poses = ["ride"].concat((opts.poses || []).flatMap(q => (q === "steer" ? ["steer_p", "steer_m"] : [q])));
    const front = corners.find(c => c.e.cfg.axle !== "rear") || corners[0];
    const x0 = opts.origin === "solver" ? 0 : front.e.susp.h.cp[0];
    const out = { points: [], lines: [], bodies: [], layers: [], units: opts.units === "in" ? "in" : "mm", frame: opts.frame || "sw" };
    for (const c of corners) {
      const e = c.e,
        rear = e.cfg.axle === "rear",
        ax = rear ? "R" : "F",
        sw = e.cfg.sweep || {};
      // corner files each use their own X; in a car the rear contact patch sits one wheelbase behind the front one
      const dx = rear && corners.length > 1 ? front.e.susp.h.cp[0] - (opts.wheelbase || e.cfg.vehicle.wheelbase) - e.susp.h.cp[0] : 0;
      const tube = kind =>
        kind === "wishbone"
          ? e.cfg.members.wishbone[0]
          : kind === "tie_rod"
            ? e.cfg.members.tie_rod[0]
            : kind === "pushrod"
              ? e.cfg.members.pushrod[0]
              : kind === "damper"
                ? (e.cfg.clearance || {}).damper_od || 50
                : null;
      for (const pose of poses) {
        if (pose.startsWith("steer") && (rear || !sw.rack_travel)) continue;
        const dz = pose === "bump" ? sw.travel : pose === "droop" ? -sw.travel : 0,
          rk = pose === "steer_p" ? sw.rack_travel : pose === "steer_m" ? -sw.rack_travel : 0;
        for (const side of ["R", "L"]) {
          // the left wheel is the mirror image of the right wheel at the opposite rack position
          let g;
          try {
            g = cornerAt(e, dz, side === "R" ? rk : -rk);
          } catch (err) {
            continue;
          }
          const layer = `${ax}${side} ${POSES[pose]}`,
            tag = `${ax}${side}_`;
          if (!out.layers.includes(layer)) out.layers.push(layer);
          const T = q => fr.f([q[0] + dx - x0, side === "R" ? q[1] : -q[1], q[2]]).map(v => v * k);
          if (pose === "ride")
            for (const [n, q] of Object.entries(g.P))
              if (!/^(spin_axis|rocker_axis)_/.test(n)) out.points.push({ name: tag + n, layer, p: T(q) });
          if (pose === "ride") rideBodies(out, g, tag, layer, T, k, e.cfg, tube);
          for (const [n, a, b, kind] of g.L)
            out.lines.push({
              name: tag + n + (pose === "ride" ? "" : "_" + pose),
              layer,
              a: T(g.P[a]),
              b: T(g.P[b]),
              color: POSE_COLOR[pose],
              od: pose === "ride" && kind ? tube(kind) * k : null,
            });
        }
      }
    }
    return out;
  }

  // solid bodies at ride height for the STEP-solids export: every link as a tube (its real OD, or a 12 mm rod for the
  // upright and rocker lines), a ball at every joint, and the tire as a cylinder. Each is {name, layer, shape, ...}.
  function rideBodies(out, g, tag, layer, T, k, cfg, tube) {
    const JOINT = 22,
      ROD = 12;
    for (const [n, a, b, kind] of g.L) {
      if (n === "spin_axis") continue;
      out.bodies.push({ name: tag + n, layer, shape: "cyl", a: T(g.P[a]), b: T(g.P[b]), d: (kind ? tube(kind) : ROD) * k });
    }
    for (const [n, q] of Object.entries(g.P)) {
      if (/^(spin_axis|rocker_axis)_|^wheel_center$/.test(n)) continue;
      out.bodies.push({ name: tag + n + "_ball", layer, shape: "ball", c: T(q), d: (n === "contact_patch" ? 10 : JOINT) * k });
    }
    const w = cfg.wheel || {},
      c = g.P.wheel_center,
      ax = unit(sub(g.P.spin_axis_out, g.P.spin_axis_in)),
      half = (w.tire_width || 190) / 2;
    out.bodies.push({
      name: tag + "tire",
      layer,
      shape: "cyl",
      a: T(sub(c, mul(ax, half))),
      b: T(add(c, mul(ax, half))),
      d: 2 * (w.tire_radius || 254) * k,
    });
  }

  // ---------------------------------------------------------------- writers
  const num = v => {
    let s = (Math.abs(v) < 5e-10 ? 0 : v).toFixed(6);
    s = s.replace(/0+$/, "");
    return s.endsWith(".") ? s + "0" : s;
  };
  const csvq = s => (/[",\n]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : s);

  function toCSV(g) {
    const rows = [`name,layer,x_${g.units},y_${g.units},z_${g.units}`];
    for (const q of g.points) rows.push([q.name, q.layer, ...q.p.map(num)].map(csvq).join(","));
    rows.push("", `link,layer,x1_${g.units},y1_${g.units},z1_${g.units},x2_${g.units},y2_${g.units},z2_${g.units}`);
    for (const l of g.lines) rows.push([l.name, l.layer, ...l.a.map(num), ...l.b.map(num)].map(csvq).join(","));
    return rows.join("\n") + "\n";
  }

  // IGES 5.3, fixed 80-column ASCII: points (116) and lines (110), one IGES level per layer, colour by pose
  function toIGES(g, meta = {}) {
    const pad = (s, n) => (s + " ".repeat(n)).slice(0, n),
      rj = (s, n) => (" ".repeat(n) + s).slice(-n);
    const H = s => `${s.length}H${s}`;
    const now = meta.date || new Date(),
      two = v => String(v).padStart(2, "0");
    const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}.${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
    const name = (meta.name || "suspension").replace(/[^\w.-]+/g, "_");
    const maxc = Math.max(1, ...g.points.flatMap(q => q.p.map(Math.abs)), ...g.lines.flatMap(l => l.a.concat(l.b).map(Math.abs)));
    const gp = [
      H(","),
      H(";"),
      H(name),
      H(name + ".igs"),
      H("FSAE Suspension Solver"),
      H("1.0"),
      "32",
      "38",
      "6",
      "308",
      "15",
      H(name),
      "1.0",
      g.units === "in" ? "1" : "2",
      g.units === "in" ? H("INCH") : H("MM"),
      "1",
      "1.0",
      H(stamp),
      "1.0E-6",
      num(maxc * 1.1),
      H(meta.author || ""),
      H(meta.org || ""),
      "11",
      "0",
      H(stamp),
    ];
    const wrap = (tokens, width, endc) => {
      const lines = [];
      let cur = "";
      tokens.forEach((t, i) => {
        const piece = t + (i === tokens.length - 1 ? endc : ",");
        if (cur.length + piece.length > width) {
          lines.push(cur);
          cur = "";
        }
        cur += piece;
      });
      if (cur) lines.push(cur);
      return lines;
    };
    const S = [
      "Suspension reference geometry, FSAE Suspension Solver.",
      `Units ${g.units}, frame ${g.frame}. Points and lines only.`,
      "One IGES level per corner and pose; colour by pose.",
    ];
    const G = wrap(gp, 72, ";");
    const ents = [];
    const lvl = layer => g.layers.indexOf(layer) + 1;
    const lab = n =>
      n
        .replace(/[^A-Za-z0-9]/g, "")
        .toUpperCase()
        .slice(0, 8);
    for (const q of g.points)
      ents.push({ type: 116, params: ["116", ...q.p.map(num), "0"], level: lvl(q.layer), color: 1, label: lab(q.name) });
    for (const l of g.lines)
      ents.push({
        type: 110,
        params: ["110", ...l.a.map(num), ...l.b.map(num)],
        level: lvl(l.layer),
        color: l.color || 1,
        label: lab(l.name),
      });
    const D = [],
      P = [];
    ents.forEach((en, i) => {
      const dseq = 2 * i + 1,
        pl = wrap(en.params, 64, ";"),
        pstart = P.length + 1;
      pl.forEach(t => P.push(pad(t, 64) + rj(String(dseq), 8)));
      D.push([en.type, pstart, 0, 1, en.level, 0, 0, 0, "00000000"].map(v => rj(String(v), 8)).join(""));
      D.push([en.type, 0, en.color, pl.length, 0, "", "", en.label, 0].map(v => rj(String(v), 8)).join(""));
    });
    const sec = (lines, c) => lines.map((t, i) => pad(t, 72) + c + rj(String(i + 1), 7));
    const out = [...sec(S, "S"), ...sec(G, "G"), ...sec(D, "D"), ...sec(P, "P")];
    out.push(
      pad(
        `S${rj(String(S.length), 7)}G${rj(String(G.length), 7)}D${rj(String(D.length), 7)}P${rj(String(P.length), 7)}`.replace(/ /g, "0"),
        72
      ) +
        "T" +
        rj("1", 7)
    );
    return out.join("\n") + "\n";
  }

  // STEP AP214: a wireframe part whose curve sets are the layers; every point and line keeps its name
  function toSTEP(g, meta = {}) {
    const name = (meta.name || "suspension").replace(/'/g, "");
    const L = [];
    let n = 0;
    const add_ = s => {
      L.push(`#${++n}=${s};`);
      return `#${n}`;
    };
    const q = s => `'${String(s).replace(/'/g, "")}'`,
      pt = (nm, p) => add_(`CARTESIAN_POINT(${q(nm)},(${p.map(num).join(",")}))`);
    const ac = add_(`APPLICATION_CONTEXT('automotive design')`);
    add_(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ac})`);
    const pc = add_(`PRODUCT_CONTEXT('',${ac},'mechanical')`);
    const pr = add_(`PRODUCT(${q(name)},${q(name)},'',(${pc}))`);
    add_(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${pr}))`);
    const pdf = add_(`PRODUCT_DEFINITION_FORMATION('','',${pr})`);
    const pdc = add_(`PRODUCT_DEFINITION_CONTEXT('part definition',${ac},'design')`);
    const pd = add_(`PRODUCT_DEFINITION('design','',${pdf},${pdc})`);
    const pds = add_(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
    let lu = add_(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
    if (g.units === "in") {
      const m = add_(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),${lu})`),
        de = add_(`DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)`);
      lu = add_(`(CONVERSION_BASED_UNIT('INCH',${m})LENGTH_UNIT()NAMED_UNIT(${de}))`);
    }
    const au = add_(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`),
      su = add_(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
    const um = add_(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),${lu},'distance_accuracy_value','confusion accuracy')`);
    const ctx = add_(
      `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${um}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lu},${au},${su}))REPRESENTATION_CONTEXT('',''))`
    );
    const o = pt("origin", [0, 0, 0]),
      dz = add_(`DIRECTION('',(0.,0.,1.))`),
      dx = add_(`DIRECTION('',(1.,0.,0.))`);
    const ax2 = add_(`AXIS2_PLACEMENT_3D('',${o},${dz},${dx})`);
    const sets = g.layers
      .map(layer => {
        const items = g.points
          .filter(p => p.layer === layer)
          .map(p => pt(p.name, p.p))
          .concat(g.lines.filter(l => l.layer === layer).map(l => add_(`POLYLINE(${q(l.name)},(${pt("", l.a)},${pt("", l.b)}))`)));
        return items.length ? add_(`GEOMETRIC_CURVE_SET(${q(layer)},(${items.join(",")}))`) : null;
      })
      .filter(Boolean);
    const rep = add_(`GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION(${q(name)},(${[ax2].concat(sets).join(",")}),${ctx})`);
    add_(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
    const ts = (meta.date || new Date()).toISOString().slice(0, 19);
    return (
      [
        "ISO-10303-21;",
        "HEADER;",
        `FILE_DESCRIPTION(('Suspension reference geometry from the FSAE Suspension Solver'),'2;1');`,
        `FILE_NAME(${q(name + ".step")},'${ts}',(''),(''),'FSAE Suspension Solver','FSAE Suspension Solver','');`,
        `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));`,
        "ENDSEC;",
        "DATA;",
        ...L,
        "ENDSEC;",
        "END-ISO-10303-21;",
      ].join("\n") + "\n"
    );
  }

  // STEP AP214 with real solid bodies (B-rep cylinders and spheres), one named part per body, collected in one
  // assembly. Onshape, Fusion and SolidWorks import these as parts you can mate to, measure and section.
  function toSTEPSolid(g, meta = {}) {
    const name = (meta.name || "suspension").replace(/'/g, "");
    const L = [];
    let n = 0;
    const add_ = s => {
      L.push(`#${++n}=${s};`);
      return `#${n}`;
    };
    const q = s => `'${String(s).replace(/'/g, "")}'`,
      pt = p => add_(`CARTESIAN_POINT('',(${p.map(num).join(",")}))`),
      dir = v => add_(`DIRECTION('',(${v.map(num).join(",")}))`),
      place = (o, z, x) => add_(`AXIS2_PLACEMENT_3D('',${pt(o)},${dir(z)},${dir(x)})`);
    const ac = add_(`APPLICATION_CONTEXT('automotive design')`);
    add_(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ac})`);
    const pc = add_(`PRODUCT_CONTEXT('',${ac},'mechanical')`),
      pdc = add_(`PRODUCT_DEFINITION_CONTEXT('part definition',${ac},'design')`);
    let lu = add_(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))`);
    if (g.units === "in") {
      const m = add_(`LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),${lu})`),
        de = add_(`DIMENSIONAL_EXPONENTS(1.,0.,0.,0.,0.,0.,0.)`);
      lu = add_(`(CONVERSION_BASED_UNIT('INCH',${m})LENGTH_UNIT()NAMED_UNIT(${de}))`);
    }
    const au = add_(`(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))`),
      su = add_(`(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())`);
    const um = add_(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),${lu},'distance_accuracy_value','confusion accuracy')`);
    const ctx = add_(
      `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${um}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lu},${au},${su}))REPRESENTATION_CONTEXT('',''))`
    );
    const product = nm => {
      const pr = add_(`PRODUCT(${q(nm)},${q(nm)},'',(${pc}))`);
      add_(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${pr}))`);
      const pd = add_(`PRODUCT_DEFINITION('design','',${add_(`PRODUCT_DEFINITION_FORMATION('','',${pr})`)},${pdc})`);
      return [pd, add_(`PRODUCT_DEFINITION_SHAPE('','',${pd})`)];
    };
    const [apd, apds] = product(name),
      aax = place([0, 0, 0], [0, 0, 1], [1, 0, 0]),
      arep = add_(`SHAPE_REPRESENTATION(${q(name)},(${aax}),${ctx})`);
    add_(`SHAPE_DEFINITION_REPRESENTATION(${apds},${arep})`);

    // a closed cylinder: two planar caps and the side, bounded by the two end circles
    function cylinder(a, b, r) {
      const len = norm(sub(b, a)),
        w = mul(sub(b, a), 1 / len),
        u = unit(cross(w, Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
      const ring = c0 => {
        const v = add_(`VERTEX_POINT('',${pt(add(c0, mul(u, r)))})`);
        return add_(`EDGE_CURVE('',${v},${v},${add_(`CIRCLE('',${place(c0, w, u)},${num(r)})`)},.T.)`);
      };
      const e1 = ring(a),
        e2 = ring(b);
      const loop = (e, sense) => add_(`EDGE_LOOP('',(${add_(`ORIENTED_EDGE('',*,*,${e},${sense})`)}))`);
      const bound = (e, sense) => add_(`FACE_BOUND('',${loop(e, sense)},.T.)`);
      const f1 = add_(`ADVANCED_FACE('',(${bound(e1, ".F.")}),${add_(`PLANE('',${place(a, mul(w, -1), u)})`)},.T.)`),
        f2 = add_(`ADVANCED_FACE('',(${bound(e2, ".T.")}),${add_(`PLANE('',${place(b, w, u)})`)},.T.)`),
        f3 = add_(
          `ADVANCED_FACE('',(${bound(e1, ".T.")},${bound(e2, ".F.")}),${add_(`CYLINDRICAL_SURFACE('',${place(a, w, u)},${num(r)})`)},.T.)`
        );
      return add_(`CLOSED_SHELL('',(${f1},${f2},${f3}))`);
    }
    // a sphere: one face, bounded by a single vertex at its pole
    function ball(c, r) {
      const v = add_(`VERTEX_POINT('',${pt(sub(c, [0, 0, r]))})`);
      const fb = add_(`FACE_BOUND('',${add_(`VERTEX_LOOP('',${v})`)},.T.)`);
      return add_(
        `CLOSED_SHELL('',(${add_(`ADVANCED_FACE('',(${fb}),${add_(`SPHERICAL_SURFACE('',${place(c, [0, 0, 1], [1, 0, 0])},${num(r)})`)},.T.)`)}))`
      );
    }
    let count = 0;
    for (const bd of g.bodies || []) {
      if (bd.shape === "cyl" && norm(sub(bd.b, bd.a)) < 1e-9) continue;
      const shell = bd.shape === "cyl" ? cylinder(bd.a, bd.b, bd.d / 2) : ball(bd.c, bd.d / 2);
      const solid = add_(`MANIFOLD_SOLID_BREP(${q(bd.name)},${shell})`),
        pax = place([0, 0, 0], [0, 0, 1], [1, 0, 0]),
        rep = add_(`ADVANCED_BREP_SHAPE_REPRESENTATION(${q(bd.name)},(${pax},${solid}),${ctx})`);
      const [pd, pds] = product(bd.name);
      add_(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
      const nauo = add_(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${++count}',${q(bd.name)},'',${apd},${pd},$)`);
      const idt = add_(`ITEM_DEFINED_TRANSFORMATION('','',${pax},${aax})`);
      const rel = add_(
        `(REPRESENTATION_RELATIONSHIP('','',${rep},${arep})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${idt})SHAPE_REPRESENTATION_RELATIONSHIP())`
      );
      add_(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(${rel},${add_(`PRODUCT_DEFINITION_SHAPE('','',${nauo})`)})`);
    }
    const ts = (meta.date || new Date()).toISOString().slice(0, 19);
    return (
      [
        "ISO-10303-21;",
        "HEADER;",
        `FILE_DESCRIPTION(('Suspension solid bodies from the FSAE Suspension Solver'),'2;1');`,
        `FILE_NAME(${q(name + ".step")},'${ts}',(''),(''),'FSAE Suspension Solver','FSAE Suspension Solver','');`,
        `FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));`,
        "ENDSEC;",
        "DATA;",
        ...L,
        "ENDSEC;",
        "END-ISO-10303-21;",
      ].join("\n") + "\n"
    );
  }

  // tube bodies at ride height (closed cylinders, real OD) as ASCII STL; STL has no units, so pick the same units on import
  function toSTL(g, meta = {}, seg = 16) {
    const out = [`solid ${(meta.name || "suspension").replace(/\s+/g, "_")}`];
    const tri = (a, b, c) => {
      const nn = unit(cross(sub(b, a), sub(c, a))) || [0, 0, 0];
      out.push(
        `facet normal ${nn.map(num).join(" ")}`,
        " outer loop",
        ...[a, b, c].map(v => `  vertex ${v.map(num).join(" ")}`),
        " endloop",
        "endfacet"
      );
    };
    for (const l of g.lines) {
      if (!l.od) continue;
      const ax = sub(l.b, l.a),
        len = norm(ax);
      if (len < 1e-9) continue;
      const w = mul(ax, 1 / len),
        ref = Math.abs(w[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = unit(cross(w, ref)),
        v = cross(w, u),
        r = l.od / 2;
      const ring = c0 =>
        Array.from({ length: seg }, (_, i) => {
          const t = (2 * Math.PI * i) / seg;
          return add(c0, add(mul(u, r * Math.cos(t)), mul(v, r * Math.sin(t))));
        });
      const A = ring(l.a),
        B = ring(l.b);
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        tri(A[i], A[j], B[j]);
        tri(A[i], B[j], B[i]);
        tri(l.a, A[j], A[i]);
        tri(l.b, B[i], B[j]);
      }
    }
    out.push(`endsolid ${(meta.name || "suspension").replace(/\s+/g, "_")}`);
    return out.join("\n") + "\n";
  }

  root.SuspCAD = { FRAMES, POSES, geometry, toCSV, toIGES, toSTEP, toSTEPSolid, toSTL };
})(typeof window !== "undefined" ? window : globalThis);
