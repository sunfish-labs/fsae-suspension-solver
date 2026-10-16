// 20_panels_pack.js - Packaging tab: link-pair clearances.
function panelPack() {
  const p = ev.pack,
    rear = ev.cfg.axle === "rear";
  const rows = Object.entries(p.pairs)
    .sort((a, b) => a[1][0] - a[1][3] - (b[1][0] - b[1][3]))
    .map(
      ([n, [d, hz, rk, need]]) =>
        `<tr><td>${esc(n)}</td><td class="n">${fmt(d, 1)}</td><td class="n">${fmt(need, 1)}</td><td class="n">${fmt(hz, 0)}</td>${rear ? "" : `<td class="n">${fmt(rk, 0)}</td>`}<td>${d >= need ? `<span class="pill ok">Clear</span>` : `<span class="pill bad">Too close</span>`}</td></tr>`
    )
    .join("");
  const m = ev.metrics,
    extra = [];
  if (m.caliper_rim_margin != null)
    extra.push(
      `Caliper: its outer edge is ${fmt(m.caliper_rim_margin, 1)} mm inside the rim barrel; its envelope is checked against every link above.`
    );
  if (m.hs_plunge != null)
    extra.push(
      `Halfshaft: plunge ${fmt(m.hs_plunge, 1)} mm, worst CV angles ${fmt(m.hs_cv_in_max, 1)}° inboard and ${fmt(m.hs_cv_out_max, 1)}° outboard, tightest link gap ${fmt(m.hs_clearance_margin, 1)} mm beyond what it needs.`
    );
  return `<div class="tbl-wrap"><table class="data"><thead><tr><th>Link pair</th><th class="n">Min gap, mm</th><th class="n">Needs</th><th class="n">At travel</th>${rear ? "" : `<th class="n">At rack</th>`}<th></th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note">Center-line distances, checked at 9 heights from full droop to full bump${rear ? "" : " at 7 rack positions across the full rack travel"}. "Needs" = half of each tube's OD plus ${fmt(ev.cfg.clearance.margin, 0)} mm margin.
  Rim: the farthest joint is ${fmt(p.rim_max, 1)} mm from the wheel axis against a ${fmt(p.rim_radius, 1)} mm rim radius, leaving ${fmt(p.rim_margin, 1)} mm (radial check only, against the rim barrel's inner radius).</p>${extra.map(t => `<p class="note">${esc(t)}</p>`).join("")}
  <h3 class="subh" id="jointsH">Rod ends and bearings: misalignment</h3>${jointTable(ev, { editable: true })}<p class="note">${esc(JOINT_NOTE)}</p>`;
}
