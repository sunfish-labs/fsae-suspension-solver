// 20_panels_spring.js - Spring & damper tab: rocker drawing, motion ratio, damping.
function rockerSvg() {
  const sp = ev.spring,
    rows = ev.rows;
  if (!sp) return "";
  let k = sp.direct ? [1, 0, 0] : sp.k.slice(),
    c = sp.direct ? sp.dch : sp.c;
  let v = V.sub([0, 0, 1], V.mul(k, k[2]));
  if (V.norm(v) < 1e-6) v = V.sub([0, 1, 0], V.mul(k, k[1]));
  v = V.unit(v);
  let u = V.cross(v, k);
  if (u[1] < 0) {
    u = V.mul(u, -1);
    k = V.mul(k, -1);
  }
  const P = q => [V.dot(V.sub(q, c), u), V.dot(V.sub(q, c), v)];
  const picks = [
    [0, "full droop", "2 3"],
    [Math.floor(rows.length / 2), "ride height", ""],
    [rows.length - 1, "full bump", "6 3"],
  ];
  const sts = picks.map(([i]) => rows[i]._spring);
  const allp = sts.flatMap(st => [P(st.rod_in), P(st.damper_out)]).concat([P(sp.dch), [0, 0]]);
  const xs = allp.map(p => p[0]),
    ys = allp.map(p => p[1]);
  const pad = 45,
    x0 = Math.min(...xs) - pad,
    x1 = Math.max(...xs) + pad,
    y0 = Math.min(...ys) - pad,
    y1 = Math.max(...ys) + pad;
  const W = x1 - x0,
    H = y1 - y0,
    X = p => (p[0] - x0).toFixed(1),
    Y = p => (y1 - p[1]).toFixed(1);
  let s = `<svg viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" role="img" aria-label="Rocker at droop, ride height and bump" style="max-height:340px;min-height:220px">`;
  picks.forEach(([, lab, dash], j) => {
    const st = sts[j],
      ro = P(st.rod_out),
      ri = P(st.rod_in),
      dout = P(st.damper_out),
      dc = P(sp.dch);
    s += `<line x1="${attr(X(ri))}" y1="${attr(Y(ri))}" x2="${attr(X(ro))}" y2="${attr(Y(ro))}" stroke="var(--bad)" stroke-width="2.5" ${dash ? `stroke-dasharray="${attr(dash)}"` : ""}/>`;
    s += `<line x1="${attr(X(dout))}" y1="${attr(Y(dout))}" x2="${attr(X(dc))}" y2="${attr(Y(dc))}" stroke="var(--s3)" stroke-width="${attr(j === 1 ? 7 : 4)}" opacity="${attr(j === 1 ? 0.7 : 0.45)}" ${dash ? `stroke-dasharray="${attr(dash)}"` : ""}/>`;
    if (!sp.direct)
      s += `<polygon points="${X([0, 0])},${Y([0, 0])} ${X(ri)},${Y(ri)} ${X(dout)},${Y(dout)}" fill="var(--accent)" fill-opacity="${attr(j === 1 ? 0.35 : 0.1)}" stroke="var(--accent)" stroke-width="2" ${dash ? `stroke-dasharray="${attr(dash)}"` : ""}/>`;
  });
  if (!sp.direct) s += `<circle cx="${attr(X([0, 0]))}" cy="${attr(Y([0, 0]))}" r="4.5" fill="var(--ink)"/>`;
  s += `</svg>`;
  return `<div class="chart"><h3>Rocker plane, looking along the pivot bolt</h3><p class="cap">Solid = ride height, dotted = full droop, dashed = full bump. Red = pushrod, green = damper, gold = rocker.</p>${s}</div>`;
}
// damper force against shaft speed: low-speed slope up to the knee, high-speed slope above (bilinear)
function damperForce(cl, ch, knee, v) {
  const a = Math.min(v, knee);
  return (cl * a + ch * Math.max(0, v - knee)) / 1000;
}
function dampingBlock() {
  const rd = ev.ride,
    sc = ev.cfg.spring,
    knee = +sc.damper_knee || 50;
  const z = k => (rd[k] == null ? `<span class="muted">–</span>` : fmt(rd[k], 2));
  const has = sc.damper_bump_low || sc.damper_rebound_low || sc.damper_bump_high || sc.damper_rebound_high;
  const v = Array.from({ length: 31 }, (_, i) => i * 10),
    tl = rd.damper_c_low_target,
    th = rd.damper_c_high_target;
  const series = [{ name: "target", x: v, y: v.map(q => damperForce(tl, th, knee, q)), color: "var(--base)", dash: "4 3", w: 1.5 }];
  if (sc.damper_bump_low)
    series.push({
      name: "bump",
      x: v,
      y: v.map(q => damperForce(+sc.damper_bump_low, +(sc.damper_bump_high || sc.damper_bump_low), knee, q)),
      color: "var(--s1)",
    });
  if (sc.damper_rebound_low)
    series.push({
      name: "rebound",
      x: v,
      y: v.map(q => damperForce(+sc.damper_rebound_low, +(sc.damper_rebound_high || sc.damper_rebound_low), knee, q)),
      color: "var(--s2)",
      dash: "6 3",
    });
  return `<h3 class="sub-h">Damping</h3>
  <div class="kv">
    <div><span>Critical damping at the wheel (body)</span><b>${fmt(rd.c_crit, 0)} <small>N s/m</small></b></div>
    <div><span>Critical damping at the wheel (wheel hop)</span><b>${fmt(rd.c_crit_hop, 0)} <small>N s/m</small></b></div>
    <div><span>Damper rate for ζ ${fmt(+sc.target_zeta_low || 0.7, 2)} (low-speed)</span><b>${fmt(tl, 0)} <small>N s/m</small></b></div>
    <div><span>Damper rate for ζ ${fmt(+sc.target_zeta_high || 0.35, 2)} (high-speed)</span><b>${fmt(th, 0)} <small>N s/m</small></b></div></div>
  ${
    has
      ? `<div class="tbl-wrap"><table class="data"><thead><tr><th>Damping ratio</th><th class="n">Low-speed (body)</th><th class="n">High-speed</th></tr></thead><tbody>
    <tr><td>Bump</td><td class="n">${z("zeta_bump_low")}</td><td class="n">${z("zeta_bump_high")}</td></tr>
    <tr><td>Rebound</td><td class="n">${z("zeta_rebound_low")}</td><td class="n">${z("zeta_rebound_high")}</td></tr>
    <tr><td>Wheel hop (bump, high-speed)</td><td class="n"></td><td class="n">${z("zeta_hop")}</td></tr></tbody></table></div>`
      : `<p class="note">Enter the damper's bump and rebound slopes (inputs → Pushrod, rocker &amp; damper → Damping) to see its damping ratios. The rates above are what would hit the targets.</p>`
  }
  <div class="charts">${chart({ title: "Damper force vs shaft speed, N", cap: `dashed = rates for the damping-ratio targets; knee at ${fmt(knee, 0)} mm/s`, xlabel: "shaft speed, mm/s", series })}</div>
  <p class="note">ζ = damper rate × MR² ÷ critical damping. Common starting points: about 0.6–0.8 at low speed (body control), 0.3–0.4 at high speed (bumps), with rebound stiffer than bump.
  Critical damping uses the ride rate (spring and tire in series) and the sprung mass of this corner; wheel hop uses the unsprung mass on spring + tire.</p>`;
}
function panelSpring() {
  if (!ev.spring)
    return `<p class="note">Turn on "Model the spring and damper" in the inputs to get motion ratio, ride frequency, damper stroke checks and member loads.</p>`;
  const rd = ev.ride,
    m = ev.metrics,
    sc = ev.cfg.spring,
    rows = ev.rows,
    x = rows.map(r => r.dz);
  const [lo, mid, hi] = rd._damper_len_range;
  const e2e = sc.damper_eye_to_eye,
    stroke = sc.damper_stroke;
  const kv = (lab, k, unit, dec) => (m[k] == null ? "" : `<div><span>${lab}</span><b>${fmt(m[k], dec)} <small>${unit}</small></b></div>`);
  const bRows = base && base.ride ? base.rows : null;
  return `<div class="kv">
    ${kv("Motion ratio (damper/wheel)", "motion_ratio", "", 3)}${kv("MR change over travel", "mr_progression", "%", 1)}
    ${kv("Wheel rate", "wheel_rate", "N/mm", 1)}${kv("Ride rate with tire", "ride_rate", "N/mm", 1)}
    ${kv("Ride frequency", "ride_freq", "Hz", 2)}${kv(`Spring for ${fmt(sc.target_freq_hz, 1)} Hz`, "spring_for_target", "N/mm", 1)}
    ${kv("Spring force at ride height", "static_spring_force", "N", 0)}${kv("Damper stroke used", "damper_used", "mm", 1)}
    ${kv("Damper at ride height", "damper_static_pos", "% of stroke", 0)}${kv("Room to full extension", "damper_topout", "mm", 1)}
    ${kv("Room to full compression", "damper_bottomout", "mm", 1)}${kv("Rocker rotation", "rocker_rot", "deg", 1)}
    ${kv("Worst transmission angle", "trans_min", "deg", 0)}${kv("Pushrod angle", "rod_angle", "deg", 0)}
    <div><span>Wheel-hop frequency</span><b>${fmt(rd.hop_freq, 1)} <small>Hz</small></b></div></div>
  <p class="note">Damper length ${fmt(hi, 1)} / ${fmt(mid, 1)} / ${fmt(lo, 1)} mm at full droop / ride height / full bump${e2e && stroke ? `; the damper is ${fmt(e2e, 0)} mm extended and ${fmt(e2e - stroke, 0)} mm closed` : ". Add the damper's eye-to-eye length and stroke to check top-out and bottom-out"}.
  ${rd._arm_rod ? `Rocker arms ${fmt(rd._arm_rod, 1)} mm (pushrod side) and ${fmt(rd._arm_damper, 1)} mm (damper side).` : ""}</p>
  ${dampingBlock()}
  <div class="charts">
    ${rockerSvg()}
    ${chart({
      title: "Motion ratio",
      cap: "damper travel per wheel travel",
      xlabel: "wheel travel, mm",
      marker: pose.dz,
      series: [
        ...(bRows
          ? [{ name: "baseline", x: bRows.map(r => r.dz), y: bRows.map(r => r.motion_ratio), color: C.base, dash: "4 3", w: 1.5 }]
          : []),
        { name: bRows ? "current" : null, x, y: rows.map(r => r.motion_ratio), color: C.s1 },
      ],
    })}
    ${chart({
      title: "Damper length, mm",
      cap: e2e && stroke ? "shaded = usable stroke" : "",
      xlabel: "wheel travel, mm",
      marker: pose.dz,
      band: e2e && stroke ? [e2e - stroke, e2e] : null,
      series: [{ x, y: rows.map(r => r.damper_len), color: C.s3 }],
    })}
    ${
      rows[0].trans_rod != null
        ? chart({
            title: "Rocker transmission angles, deg",
            cap: "90 = best leverage, keep above 45",
            xlabel: "wheel travel, mm",
            marker: pose.dz,
            band: [45, 90],
            series: [
              { name: "pushrod", x, y: rows.map(r => r.trans_rod), color: C.s2 },
              { name: "damper", x, y: rows.map(r => r.trans_damper), color: C.s3, dash: "5 3" },
            ],
          })
        : ""
    }
  </div>`;
}
