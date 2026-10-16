// 20_panels_motion.js - Motion tab: heave, roll and steering curves.
const C = { s1: "var(--s1)", s2: "var(--s2)", s3: "var(--s3)", base: "var(--base)" };
function panelHeave() {
  const rows = ev.rows,
    br = base ? base.rows : null,
    m = ev.metrics,
    T = ev.cfg.sweep.travel;
  const r0 = rs => rs.reduce((a, r) => (Math.abs(r.dz) < Math.abs(a.dz) ? r : a));
  const toe0 = r0(rows).toe,
    cpy0 = r0(rows).cp_y,
    btoe0 = br ? r0(br).toe : 0,
    bcpy0 = br ? r0(br).cp_y : 0;
  const nm = !!br;
  const mk = (title, cap, get, bget) =>
    chart({
      title,
      cap,
      xlabel: "wheel travel, mm (+ bump)",
      marker: pose.dz,
      series: [
        ...(br ? [{ name: nm ? "baseline" : null, x: br.map(r => r.dz), y: br.map(bget || get), color: C.base, dash: "4 3", w: 1.5 }] : []),
        { name: nm ? "current" : null, x: rows.map(r => r.dz), y: rows.map(get), color: C.s1 },
      ],
    });
  const anti =
    ev.cfg.axle === "front"
      ? mk("Anti-dive, %", `${fmt(m.antidive, 1)} % at ride height`, r => r.antidive)
      : chart({
          title: "Anti-squat / anti-lift, %",
          cap: `${fmt(m.antisquat, 1)} / ${fmt(m.antilift, 1)} % at ride height`,
          xlabel: "wheel travel, mm",
          marker: pose.dz,
          series: [
            { name: "anti-squat", x: rows.map(r => r.dz), y: rows.map(r => r.antisquat), color: C.s1 },
            { name: "anti-lift", x: rows.map(r => r.dz), y: rows.map(r => r.antilift), color: C.s2, dash: "5 3" },
          ],
        });
  return `<div class="kv">
    <div><span>Camber gain</span><b>${fmt(m.camber_gain, 3)} <small>deg/in</small></b></div>
    <div><span>Bump steer slope</span><b>${fmt(m.bump_steer, 3)} <small>deg/in</small></b></div>
    <div><span>Max toe change</span><b>${fmt(m.bump_steer_max, 3)} <small>deg</small></b></div>
    <div><span>Front-view swing arm</span><b>${fmt(m.fvsa, 0)} <small>mm</small></b></div>
    <div><span>Roll center range</span><b>${fmt(m.rc_min, 0)}…${fmt(m.rc_max, 0)} <small>mm</small></b></div>
    <div><span>Track change</span><b>${fmt(m.track_change, 2)} <small>mm</small></b></div></div>
  <div class="charts">
    ${mk("Camber, deg", `gain ${fmt(m.camber_gain, 3)} deg/in`, r => r.camber)}
    ${mk(
      "Toe change, deg (+ in)",
      `max ${fmt(m.bump_steer_max, 3)} deg over ±${T} mm`,
      r => r.toe - toe0,
      r => r.toe - btoe0
    )}
    ${mk("Roll center height, mm", "above ground", r => r.roll_center)}
    ${mk("Caster, deg", "", r => r.caster)}
    ${mk("KPI, deg", "", r => r.kpi)}
    ${mk("Scrub radius, mm", "", r => r.scrub)}
    ${mk("Mechanical trail, mm", "from the current contact patch", r => r.trail)}
    ${anti}
    ${mk(
      "Contact patch sideways shift, mm",
      `total ${fmt(m.track_change, 2)} mm`,
      r => r.cp_y - cpy0,
      r => r.cp_y - bcpy0
    )}
  </div>`;
}
function panelRoll() {
  const R = ev.roll,
    m = ev.metrics,
    bR = base ? base.roll : null;
  const x = R.map(r => r.roll);
  const bser = get => (bR ? [{ name: "baseline", x: bR.map(r => r.roll), y: bR.map(get), color: C.base, dash: "4 3", w: 1.5 }] : []);
  return `<div class="kv">
    <div><span>Roll camber (outer, to ground)</span><b>${fmt(m.roll_camber, 3)} <small>deg/deg</small></b></div>
    <div><span>Outer camber at ${fmt(m.roll_max_deg, 1)}° roll</span><b>${fmt(m.roll_camber_max, 2)} <small>deg</small></b></div>
    <div><span>Roll center sideways shift</span><b>${fmt(m.rc_lat, 1)} <small>mm/deg</small></b></div>
    <div><span>Roll center height at max roll</span><b>${fmt(m.rc_height_roll, 1)} <small>mm</small></b></div>
    <div><span>Roll steer (outer)</span><b>${fmt(m.roll_steer, 3)} <small>deg/deg</small></b></div></div>
  <div class="charts">
    ${chart({
      title: "Camber to ground, deg",
      cap: "1.0 deg/deg roll camber = wheel leans with the body",
      xlabel: "body roll, deg (+ right wheel outer)",
      series: [
        ...bser(r => r.camber_outer),
        { name: "outer", x, y: R.map(r => r.camber_outer), color: C.s1 },
        { name: "inner", x, y: R.map(r => r.camber_inner), color: C.s2, dash: "5 3" },
      ],
    })}
    ${chart({
      title: "Roll center height, mm",
      cap: "kinematic, above the ground line",
      xlabel: "body roll, deg",
      series: [...bser(r => r.rc_height), { name: bR ? "current" : null, x, y: R.map(r => r.rc_height), color: C.s1 }],
    })}
    ${chart({
      title: "Roll center sideways position, mm",
      cap: "+ = toward the outer wheel",
      xlabel: "body roll, deg",
      series: [...bser(r => r.rc_lateral), { name: bR ? "current" : null, x, y: R.map(r => r.rc_lateral), color: C.s1 }],
    })}
  </div>
  <p class="note">Roll is modeled as equal and opposite wheel travel with the left wheel mirrored. The force-based roll center moves once the tires are loaded unevenly.</p>`;
}
function panelSteer() {
  if (!ev.steer)
    return `<p class="note">Steering applies to the front axle. On the rear axle the toe link is fixed, so there is no steering sweep.</p>`;
  const st = ev.steer,
    m = ev.metrics,
    x = st.map(r => r.rack);
  const r25i = S.rackForAngle(st, "inner", 25),
    r25o = S.rackForAngle(st, "outer", 25);
  const ack = st.filter(r => Number.isFinite(r.ackermann));
  const cf = ev.cfg.vehicle.rack_c_factor;
  return `<div class="kv">
    <div><span>Ackermann at ${fmt(ev.cfg.sweep.ackermann_at_outer_deg, 0)}° outer</span><b>${fmt(m.ackermann, 0)} <small>%</small></b></div>
    <div><span>Turning radius, outer wheel</span><b>${fmt(m.turn_radius, 2)} <small>m</small></b></div>
    <div><span>Inner / outer at full rack</span><b>${fmt(st[st.length - 1].inner, 1)} / ${fmt(st[st.length - 1].outer, 1)} <small>deg</small></b></div>
    <div><span>Rack for 25° inner</span><b>${r25i == null ? "> range" : fmt(r25i, 1)} <small>${r25i == null ? "" : "mm"}</small></b></div>
    <div><span>Rack for 25° outer</span><b>${r25o == null ? "> range" : fmt(r25o, 1)} <small>${r25o == null ? "" : "mm"}</small></b></div>
    <div><span>Steering arm</span><b>${fmt(m.steer_arm, 1)} <small>mm</small></b></div>
    ${cf ? `<div><span>Steering wheel, center to lock</span><b>${fmt((ev.cfg.sweep.rack_travel / cf) * 360, 0)} <small>deg</small></b></div>` : ""}</div>
  <div class="charts">
    ${chart({
      title: "Wheel steer angle, deg",
      xlabel: "rack travel, mm",
      marker: Math.abs(pose.rack),
      series: [
        { name: "inner", x, y: st.map(r => r.inner), color: C.s1 },
        { name: "outer", x, y: st.map(r => r.outer), color: C.s2, dash: "5 3" },
      ],
    })}
    ${chart({
      title: "Ackermann, %",
      cap: "target band shaded",
      xlabel: "outer wheel angle, deg",
      band: S.defaultTargets(ev.cfg).ackermann,
      series: [{ x: ack.map(r => r.outer), y: ack.map(r => r.ackermann), color: C.s1 }],
    })}
    ${chart({
      title: "Camber while steering, deg",
      xlabel: "rack travel, mm",
      series: [
        { name: "inner", x, y: st.map(r => r.camber_inner), color: C.s1 },
        { name: "outer", x, y: st.map(r => r.camber_outer), color: C.s2, dash: "5 3" },
      ],
    })}
  </div>
  <p class="note">Turning radius is the outer front wheel's path at full rack, with no tire slip. Compare its diameter with the tightest hairpin in the current FSAE rules.</p>`;
}
