// ------------------------------------------------------------------ compare
// Saved designs (kept in this browser) side by side with the live design: every target and key metric with its
// change from a chosen reference, the hardpoints that differ, overlaid curves, and optional ghosts in the 3D view.
const CMP_COLORS = ["#2F5D7C", "#9E7E38", "#4C7A5A", "#7a4fd0", "#b3261e"];
let cmp = (() => { try { return JSON.parse(store.get("susp.cmp") || "[]"); } catch (e) { return []; } })();
let cmpRef = -1, cmpOnlyDiff = false;
const cmpGhost = new Set();
const cmpCache = new Map();
function cmpSave() { store.set("susp.cmp", JSON.stringify(cmp)); }
function cmpAdd(name, c) {
  if (cmp.length >= 4) cmp.shift();
  let nm = name || "Design", i = 2; while (cmp.some(q => q.name === nm)) nm = `${name} (${i++})`;
  cmp.push({ name: nm, cfg: JSON.parse(JSON.stringify(c)) }); cmpSave();
}
function cmpEval(c) {
  const key = JSON.stringify(c); if (cmpCache.has(key)) return cmpCache.get(key);
  let r; try { const e = S.evaluate(c); const l = e.spring ? S.runLoads(e.cfg, e.susp, e.spring) : null; r = { ev: e, loads: l }; } catch (e) { r = { err: e.message }; }
  if (cmpCache.size > 30) cmpCache.clear(); cmpCache.set(key, r); return r;
}
function cmpCols() {   // live design first, then saved ones
  return [{ name: "Current (live)", color: "var(--s1)", hex: CMP_COLORS[0], r: { ev, loads }, live: true }]
    .concat(cmp.map((q, i) => ({ name: q.name, color: CMP_COLORS[i + 1], hex: CMP_COLORS[i + 1], r: cmpEval(q.cfg), idx: i })));
}
const CMP_EXTRA = [["fvsa", "Front-view swing arm"], ["track_change", ""], ["roll_camber", ""], ["steer_arm", ""], ["turn_radius", ""], ["motion_ratio", ""], ["mr_progression", ""], ["wheel_rate", ""], ["damper_used", ""], ["rocker_rot", ""]];
function panelCompare() {
  const cols = cmpCols(), ok = cols.filter(c => c.r && c.r.ev), refC = cols[cmpRef + 1] && cmpRef + 1 < cols.length ? cols[cmpRef + 1] : cols[0];
  const presetOpts = PRESETS.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join("");
  const head = `<div class="cmpbar">
    <span class="cmpadd"><input class="num cmpname" id="cmpName" type="text" placeholder="Name, e.g. raised pivots" aria-label="Name for the saved design" value="${esc(cfg.name || "")}"><button class="btn small primary" type="button" id="cmpSaveCur">Save current design</button></span>
    <select class="sel cmpsel" id="cmpPreset" aria-label="Add an example design"><option value="">Add an example…</option>${presetOpts}</select>
    <button class="btn small" type="button" id="cmpFileBtn">Add from file…</button><input type="file" id="cmpFile" accept=".json,application/json" multiple hidden>
    ${cmp.length ? `<button class="btn small" type="button" id="cmpCsv">Copy table (CSV)</button><button class="btn small" type="button" id="cmpClear">Remove all</button>` : ""}</div>`;
  if (!cmp.length) return head + `<p class="note">Save the design on screen, add an example or open design files to compare up to four designs with the live one: every target side by side with the change from a reference, the hardpoints that differ, the curves overlaid, and ghosts in the 3D view. Saved designs stay in this browser only.</p>`;
  const legend = `<div class="cmpleg">${cols.map((c, j) => `<div class="cmpcol" style="--c:${c.hex}">
      <span class="sw"></span>${c.live ? `<b>${esc(c.name)}</b>` : `<input class="num cmpren" type="text" value="${esc(c.name)}" data-ren="${c.idx}" aria-label="Rename">`}
      <label class="small-check"><input type="radio" name="cmpref" value="${j - 1}" ${refC === c ? "checked" : ""}> reference</label>
      ${c.live ? "" : `<label class="small-check"><input type="checkbox" data-ghost="${c.idx}" ${cmpGhost.has(c.idx) ? "checked" : ""}> 3D</label>
      <button class="btn small" type="button" data-load="${c.idx}" title="Make this the design you are editing">Load</button><button class="btn small" type="button" data-del="${c.idx}" aria-label="Remove">✕</button>`}
      ${c.r && c.r.err ? `<span class="bad-t">does not solve</span>` : ""}</div>`).join("")}</div>`;
  // metric rows
  const keys = [...new Set(ok.flatMap(c => c.r.ev.checks.map(r => r.key)))];
  CMP_EXTRA.forEach(([k]) => { if (!keys.includes(k) && ok.some(c => c.r.ev.metrics[k] != null)) keys.push(k); });
  const val = (c, k) => k === "min_fos" ? (c.r.loads ? Math.min(...c.r.loads.checks.map(q => Math.min(q.sf_buckle, q.sf_yield))) : null) : k === "link_clearance" ? c.r.ev.metrics.clearance_min : c.r.ev.metrics[k];
  if (ok.some(c => c.r.loads)) keys.push("min_fos");
  const lab = (k) => k === "min_fos" ? ["Lowest member FOS", "", 2] : k === "link_clearance" ? ["Min link clearance", "mm", 1] : metricLabel(k);
  let rows = "";
  const met = cols.map(c => c.r && c.r.ev ? `${c.r.ev.checks.filter(r => r.status === "PASS").length}/${c.r.ev.checks.filter(r => r.status !== "n/a").length}` : "–");
  rows += `<tr class="sumrow"><td>Targets met</td>${met.map(m => `<td class="n"><b>${m}</b></td>`).join("")}</tr>`;
  for (const k of keys) {
    const [L, unit, dec] = lab(k), rv = refC.r && refC.r.ev ? val(refC, k) : null;
    const vals = cols.map(c => c.r && c.r.ev ? val(c, k) : null);
    if (cmpOnlyDiff && vals.every(v => v == null || rv == null || Math.abs(v - rv) < 10 ** -(dec + 1) * 5)) continue;
    rows += `<tr><td>${esc(L)} <span class="muted">${esc(unit)}</span></td>${cols.map((c, j) => {
      const v = vals[j]; if (v == null || !Number.isFinite(v)) return `<td class="n muted">–</td>`;
      const ck = c.r.ev.checks.find(r => r.key === k), st = k === "min_fos" ? (v >= c.r.ev.cfg.members.sf_target ? "PASS" : "FAIL") : ck ? ck.status : null;
      const dlt = c !== refC && rv != null && Number.isFinite(rv) ? v - rv : null;
      return `<td class="n ${st === "PASS" ? "cpass" : st === "FAIL" ? "cfail" : ""}">${fmt(v, dec)}${dlt != null && Math.abs(dlt) >= 10 ** -(dec + 1) * 5 ? `<small class="${dlt > 0 ? "delta-up" : "delta-dn"}">${dlt > 0 ? "+" : ""}${fmt(dlt, dec)}</small>` : ""}</td>`; }).join("")}</tr>`;
  }
  const table = `<div class="tbl-wrap"><table class="data cmpt"><thead><tr><th>Metric</th>${cols.map(c => `<th class="n" style="--c:${c.hex}"><span class="sw"></span>${esc(c.name)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Green = meets that design's own target, red = misses it. Small numbers are the change from the reference. <label class="small-check" style="display:inline-flex"><input type="checkbox" id="cmpDiff" ${cmpOnlyDiff ? "checked" : ""}> only rows that differ</label></p>`;
  // hardpoint differences
  const hpRows = [];
  const allPts = S.HP_ORDER.map(k => "hardpoints." + k).concat(S.SPRING_POINTS.map(k => "spring." + k));
  const cfgOf = (c) => c.live ? cfg : cmp[c.idx].cfg, refCfg = cfgOf(refC);
  for (const p of allPts) for (let i = 0; i < 3; i++) {
    const rv = (getPath(refCfg, p) || [])[i];
    const vs = cols.map(c => (getPath(cfgOf(c), p) || [])[i]);
    if (vs.every(v => v == null || rv == null || Math.abs(v - rv) < 0.05)) continue;
    hpRows.push(`<tr><td>${esc(pointName(p))} <b class="axis${i}">${"XYZ"[i]}</b></td>${vs.map((v, j) => v == null ? `<td class="n muted">–</td>` : `<td class="n">${fmt(v, 1)}${cols[j] !== refC && rv != null && Math.abs(v - rv) >= 0.05 ? `<small class="${v > rv ? "delta-up" : "delta-dn"}">${v > rv ? "+" : ""}${fmt(v - rv, 1)}</small>` : ""}</td>`).join("")}</tr>`);
  }
  const hp = `<h3 class="sub-h">Hardpoints that differ from the reference, mm</h3>${hpRows.length ? `<div class="tbl-wrap"><table class="data cmpt"><thead><tr><th>Point</th>${cols.map(c => `<th class="n" style="--c:${c.hex}"><span class="sw"></span>${esc(c.name)}</th>`).join("")}</tr></thead><tbody>${hpRows.join("")}</tbody></table></div>` : `<p class="note">All hardpoints match the reference.</p>`}`;
  // curves
  const ser = (get, xget, rowsOf) => ok.map(c => { const rs = rowsOf(c.r.ev); return rs ? { name: null, x: rs.map(xget), y: rs.map(get(rs)), color: c.color, w: c === refC ? 2.6 : 1.8, dash: c.live ? null : null } : null; }).filter(Boolean);
  const heave = (e) => e.rows, roll = (e) => e.roll, steer = (e) => e.steer ? e.steer.filter(r => Number.isFinite(r.ackermann)) : null;
  const toe0 = (rs) => { const r0 = rs.reduce((a, r) => Math.abs(r.dz) < Math.abs(a.dz) ? r : a); return (r) => r.toe - r0.toe; };
  const charts = `<h3 class="sub-h">Curves</h3><div class="charts">
    ${chart({ title: "Camber, deg", xlabel: "wheel travel, mm", series: ser(() => r => r.camber, r => r.dz, heave) })}
    ${chart({ title: "Toe change, deg", xlabel: "wheel travel, mm", series: ser(toe0, r => r.dz, heave) })}
    ${chart({ title: "Roll center height, mm", xlabel: "wheel travel, mm", series: ser(() => r => r.roll_center, r => r.dz, heave) })}
    ${chart({ title: "Roll center sideways, mm", xlabel: "body roll, deg", series: ser(() => r => r.rc_lateral, r => r.roll, roll) })}
    ${ok.some(c => c.r.ev.steer) ? chart({ title: "Ackermann, %", xlabel: "outer wheel angle, deg", series: ser(() => r => r.ackermann, r => r.outer, steer) }) : ""}
    ${ok.some(c => c.r.ev.spring) ? chart({ title: "Motion ratio", xlabel: "wheel travel, mm", series: ser(() => r => r.motion_ratio, r => r.dz, (e) => e.spring ? e.rows : null) }) : ""}
  </div>`;
  return head + legend + table + hp + charts;
}
function wireCompare() {
  const P = $("#pn_compare"); if (!P) return;
  const rerender = () => { P.innerHTML = panelCompare(); wireCompare(); updateScene(); };
  $("#cmpSaveCur", P).onclick = () => { cmpAdd($("#cmpName").value.trim() || cfg.name || "Saved design", cfg); rerender(); };
  $("#cmpPreset", P).onchange = (e) => { const p = PRESETS[+e.target.value]; if (p) { cmpAdd(p.label, p.cfg); rerender(); } };
  $("#cmpFileBtn", P).onclick = () => $("#cmpFile").click();
  $("#cmpFile", P).onchange = async (e) => {
    for (const f of e.target.files) { try { const raw = JSON.parse(await f.text()); if (!raw.hardpoints) continue; S.finishConfig(JSON.parse(JSON.stringify(raw))); cmpAdd(raw.name || f.name.replace(/\.json$/i, ""), raw); } catch (ex) { /* skip files that are not designs */ } }
    rerender();
  };
  const csv = $("#cmpCsv", P); if (csv) csv.onclick = async () => {
    const t = $("table.cmpt", P), lines = $$("tr", t).map(tr => $$("th,td", tr).map(c => `"${c.textContent.replace(/\s+/g, " ").trim().replace(/"/g, '""')}"`).join(","));
    try { await navigator.clipboard.writeText(lines.join("\n")); csv.textContent = "Copied"; } catch (ex) { csv.textContent = "Copy blocked by the browser"; }
    setTimeout(() => { csv.textContent = "Copy table (CSV)"; }, 1800);
  };
  const clr = $("#cmpClear", P); if (clr) clr.onclick = () => { cmp = []; cmpGhost.clear(); cmpRef = -1; cmpSave(); rerender(); };
  $$("[data-ren]", P).forEach(inp => inp.addEventListener("change", () => { cmp[+inp.dataset.ren].name = inp.value.trim() || cmp[+inp.dataset.ren].name; cmpSave(); rerender(); }));
  $$("input[name=cmpref]", P).forEach(r => r.addEventListener("change", () => { cmpRef = +r.value; rerender(); }));
  $$("[data-ghost]", P).forEach(cb => cb.addEventListener("change", () => { const i = +cb.dataset.ghost; cb.checked ? cmpGhost.add(i) : cmpGhost.delete(i); updateScene(); }));
  $$("[data-del]", P).forEach(b => b.addEventListener("click", () => { const i = +b.dataset.del; cmp.splice(i, 1); cmpGhost.clear(); if (cmpRef >= i) cmpRef = -1; cmpSave(); rerender(); }));
  $$("[data-load]", P).forEach(b => b.addEventListener("click", () => { const q = cmp[+b.dataset.load]; if (chal) exitChallenge(true); undoStack.push(JSON.parse(JSON.stringify(cfg))); view.target = null; loadCfg(JSON.parse(JSON.stringify(q.cfg))); $("#preset").value = "custom"; }));
  const od = $("#cmpDiff", P); if (od) od.onchange = () => { cmpOnlyDiff = od.checked; rerender(); };
}
function drawCompareGhosts(dyn, col) {
  for (const i of cmpGhost) {
    const q = cmp[i]; if (!q) continue; const r = cmpEval(q.cfg); if (!r.ev) continue;
    try { const s2 = r.ev.susp, x2 = s2.pose(pose.dz, pose.rack), o2 = s2.observe(x2, pose.dz, pose.rack), st2 = r.ev.spring ? r.ev.spring.state(x2, rad0(pose.dz)) : null;
      dyn.add(buildCorner(r.ev, o2, st2, { col, ghost: true, ghostCol: CMP_COLORS[i + 1] })); } catch (e) { /* that pose is out of reach for this design */ }
  }
}

