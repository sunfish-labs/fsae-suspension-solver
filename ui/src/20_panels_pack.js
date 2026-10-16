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
  return `<div class="tbl-wrap"><table class="data"><thead><tr><th>Link pair</th><th class="n">Min gap, mm</th><th class="n">Needs</th><th class="n">At travel</th>${rear ? "" : `<th class="n">At rack</th>`}<th></th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note">Center-line distances, checked at full droop, ride height and full bump${rear ? "" : " with full left and right rack"}. "Needs" = half of each tube's OD plus ${fmt(ev.cfg.clearance.margin, 0)} mm margin.
  Rim: the farthest joint is ${fmt(p.rim_max, 1)} mm from the wheel axis against a ${fmt(p.rim_radius, 1)} mm rim radius, leaving ${fmt(p.rim_margin, 1)} mm (radial check only).</p>`;
}
