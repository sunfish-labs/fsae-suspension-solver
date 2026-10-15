// ------------------------------------------------------------------ Learn tab
const TERMS = window.SUSP_TERMS || [];
const TERM_BY_METRIC = Object.fromEntries(TERMS.filter(t => t.metric).map(t => [t.metric, t]));
let learnQ = "";
function termValue(t) {
  if (!t.metric || !ev) return "";
  const v = ev.metrics[t.metric]; if (v == null || Number.isNaN(v)) return "";
  const [, unit, dec] = metricLabel(t.metric);
  return `<span class="valchip">This design: <b>${fmt(v, dec)}</b> ${esc(unit)}</span>`;
}
function panelLearn() {
  const cats = [...new Set(TERMS.map(t => t.cat))];
  return `<div class="learnbar"><input id="learnQ" class="num learnq" type="search" placeholder="Search terms, e.g. scrub, roll center, motion ratio" aria-label="Search the glossary" value="${esc(learnQ)}">
    <span class="note"><button class="lnk" type="button" id="learnChal">Ready to practice? Try a challenge.</button> Every "Show me" draws the idea on the 3D corner above. Click any joint in the 3D view to see what moving it does.</span></div>
    <nav class="catnav">${cats.map(c => `<a href="#cat_${c.replace(/\W+/g, "_")}">${esc(c)}</a>`).join("")}</nav>
    ${cats.map(c => `<section class="cat" id="cat_${c.replace(/\W+/g, "_")}"><h3 class="sub-h">${esc(c)}</h3><div class="terms">${TERMS.filter(t => t.cat === c).map(t => `
      <article class="term" id="term_${t.id}" data-text="${esc((t.name + " " + (t.aka || "") + " " + t.def).toLowerCase())}">
        <h4>${esc(t.name)}${t.aka ? ` <small>${esc(t.aka)}</small>` : ""}</h4>
        <p>${esc(t.def)}</p>
        ${t.conv ? `<p class="kv2"><b>Sign:</b> ${esc(t.conv)}</p>` : ""}
        ${t.moves ? `<p class="kv2"><b>What moves it:</b> ${esc(t.moves)}</p>` : ""}
        <div class="tact">${termValue(t)}${t.show ? `<button class="btn small" type="button" data-show="${t.show}">Show me</button>` : ""}${t.metric && ev && ev.checks.some(r => r.key === t.metric) ? `<button class="btn small" type="button" data-fixkey="${t.metric}">What moves this?</button>` : ""}</div>
      </article>`).join("")}</div></section>`).join("")}`;
}
function wireLearn() {
  const q = $("#learnQ"); if (!q) return;
  const filter = () => { learnQ = q.value.trim().toLowerCase(); $$("#pn_learn .term").forEach(a => a.hidden = !!learnQ && !a.dataset.text.includes(learnQ)); $$("#pn_learn .cat").forEach(c => c.hidden = !$$(".term", c).some(a => !a.hidden)); };
  q.addEventListener("input", filter); filter();
  const lc = $("#learnChal"); if (lc) lc.onclick = () => { openChallenges(); window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" }); };
  $$("#pn_learn [data-show]").forEach(b => b.addEventListener("click", () => showMe(b.dataset.show)));
  $$("#pn_learn [data-fixkey]").forEach(b => b.addEventListener("click", () => openFixRow(b.dataset.fixkey)));
}
function openTerm(id) { tab = "learn"; renderTabs(); showPanel(); const el = $("#term_" + id); if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1500); } }

// ------------------------------------------------------------------ "What moves this?"
const SPRING_KEYS = new Set(["motion_ratio", "mr_progression", "damper_margin", "damper_topout", "damper_bottomout", "damper_static_pos", "trans_min", "rod_angle", "rocker_rot", "ride_freq", "damper_used"]);
const GROUPS = [
  { id: "grp_lower_z", pts: ["hardpoints.lower_inboard_front", "hardpoints.lower_inboard_rear"], axis: 2, name: "both lower inboard pivots" },
  { id: "grp_upper_z", pts: ["hardpoints.upper_inboard_front", "hardpoints.upper_inboard_rear"], axis: 2, name: "both upper inboard pivots" },
  { id: "grp_lower_y", pts: ["hardpoints.lower_inboard_front", "hardpoints.lower_inboard_rear"], axis: 1, name: "both lower inboard pivots" },
  { id: "grp_upper_y", pts: ["hardpoints.upper_inboard_front", "hardpoints.upper_inboard_rear"], axis: 1, name: "both upper inboard pivots" },
  { id: "grp_tierod_z", pts: ["hardpoints.trackrod_inboard", "hardpoints.trackrod_outboard"], axis: 2, name: "the whole tie rod" },
];
function candidateMoves(key) {
  const out = [], add = (path, axis) => out.push({ id: `${path}.${axis}`, pts: [path], axis, name: pointName(path) });
  const hp = ["upper_inboard_front", "upper_inboard_rear", "lower_inboard_front", "lower_inboard_rear", "trackrod_inboard", "trackrod_outboard", "upper_outboard", "lower_outboard"].map(k => "hardpoints." + k);
  const spr = cfg.spring ? ["rod_outboard", "rocker_rod", "rocker_damper", "damper_chassis", "rocker_pivot"].filter(k => cfg.spring[k] != null).map(k => "spring." + k) : [];
  const springSide = SPRING_KEYS.has(key), clearance = key === "link_clearance";
  const pts = springSide ? spr : clearance ? hp.concat(spr) : hp;
  for (const path of pts) { if (lockPack && PACKAGING.has(path)) continue; for (const ax of [0, 1, 2]) add(path, ax); }
  if (!springSide) GROUPS.forEach(gp => out.push({ ...gp }));
  return out;
}
function describeMove(c, mm) {
  const a = Math.abs(mm), n = c.name, ax = c.axis;
  const what = ax === 2 ? `${mm > 0 ? "Raise" : "Lower"} ${n}` : ax === 1 ? `Move ${n} ${mm > 0 ? "outboard" : "inboard"}` : `Move ${n} ${mm > 0 ? "forward" : "rearward"}`;
  return `${what} ${fmt(a, a < 10 ? 1 : 0)} mm`;
}
function movedCfg(base0, c, mm) {
  const nc = JSON.parse(JSON.stringify(base0));
  for (const path of c.pts) { const pt = getPath(nc, path); pt[c.axis] = +(pt[c.axis] + mm).toFixed(2); }
  return nc;
}
function metricFrom(e, key) { return key === "link_clearance" ? e.metrics.clearance_margin : e.metrics[key]; }
function failSet(e) { return new Set(e.checks.filter(r => r.status === "FAIL").map(r => r.key)); }
const tick = () => new Promise(r => setTimeout(r, 0));
const fixTok = {};
const fixCache = new Map();
async function whatMoves(key, el) {
  const token = (fixTok[key] = (fixTok[key] || 0) + 1), cfg0 = JSON.parse(JSON.stringify(cfg)), sig = JSON.stringify(cfg0) + "|" + key + "|" + lockPack;
  if (fixCache.has(sig)) { el.innerHTML = fixCache.get(sig); wireFix(el, key); return; }
  const row = ev.checks.find(r => r.key === key);
  if (key === "camber" || key === "toe") {
    el.innerHTML = `<p class="note">${key === "camber" ? "Static camber is set with shims between the upright and the ball joints, not by moving hardpoints. Change <b>Camber</b> under Wheel &amp; vehicle." : "Static toe is set by the tie-rod length, not by moving hardpoints. Change <b>Toe</b> under Wheel &amp; vehicle."}</p>`; return; }
  const need = { steer: key === "ackermann" || key === "turn_radius", pack: key === "link_clearance" };
  const q = (c) => S.evaluate(c, { full: false, steer: need.steer, pack: need.pack });
  let lo = row.lo, hi = row.hi, v = row.value;
  if (key === "link_clearance") { lo = 0; hi = null; v = ev.metrics.clearance_margin; }
  const failing = row.status === "FAIL";
  const cands = candidateMoves(key), res = [];
  el.innerHTML = `<p class="note">Testing ${cands.length} possible moves…</p>`;
  let qb; try { qb = q(cfg0); } catch (e) { el.innerHTML = `<p class="note">The current design does not solve: ${esc(e.message)}</p>`; return; }
  const vb = metricFrom(qb, key), fb = failSet(qb), delta = 4;
  const win = lo != null && hi != null ? hi - lo : 0;
  const aim = !failing ? null : (lo != null && v < lo) ? (win ? lo + 0.2 * win : lo + Math.max(0.5, Math.abs(lo) * 0.05)) : (win ? hi - 0.2 * win : hi - Math.max(0.005, Math.abs(hi) * 0.05));
  let n = 0;
  for (const c of cands) {
    if (token !== fixTok[key]) return;
    if (++n % 3 === 0) { el.querySelector(".note").textContent = `Testing move ${n} of ${cands.length}…`; await tick(); }
    let mp; try { mp = q(movedCfg(cfg0, c, delta)); } catch (e) { continue; }
    const sl = (metricFrom(mp, key) - vb) / delta; if (!Number.isFinite(sl) || Math.abs(sl) < 1e-9) continue;
    if (!failing) { res.push({ c, mm: 5, effect: sl * 5, fails: [...failSet(mp)].filter(k => !fb.has(k) && k !== key) }); continue; }
    let mv = (aim - vb) / sl, x0 = 0, y0 = vb, got = null;
    if (Math.abs(mv) > 40) continue;
    for (let it = 0; it < 4; it++) {
      let m2; try { m2 = q(movedCfg(cfg0, c, mv)); } catch (e) { mv *= 0.5; continue; }
      const y = metricFrom(m2, key);
      const inside = (lo == null || y >= lo - 1e-9) && (hi == null || y <= hi + 1e-9);
      if (inside) { got = { mv, y, fails: [...failSet(m2)].filter(k => !fb.has(k) && k !== key) }; break; }
      if (!Number.isFinite(y) || Math.abs(y - y0) < 1e-12) break;
      const x1 = mv; mv = x1 + (aim - y) * (x1 - x0) / (y - y0); x0 = x1; y0 = y;
      if (Math.abs(mv) > 40) break;
    }
    if (got) res.push({ c, mm: got.mv, val: got.y, fails: got.fails });
  }
  if (token !== fixTok[key]) return;
  let html;
  if (failing) {
    res.sort((a, b) => a.fails.length - b.fails.length || Math.abs(a.mm) - Math.abs(b.mm));
    const top = res.slice(0, 4), base0 = failSet(ev), [, unit, dec] = row.label ? ["", row.unit, row.dec] : metricLabel(key);
    // verify the shortlist with the full solver, including clearances
    for (const r of top) {
      await tick(); if (token !== fixTok[key]) return;
      try { const fe = S.evaluate(movedCfg(cfg0, r.c, r.mm)); r.full = fe; r.val = metricFrom(fe, key); r.fails = [...failSet(fe)].filter(k => !base0.has(k) && k !== key); r.ok = !failSet(fe).has(key); } catch (e) { r.bad = e.message; }
    }
    let extra = "";
    if (key === "ride_freq" && ev.ride && cfg.spring) {
      const tgt = lo != null && hi != null ? (lo + hi) / 2 : (lo ?? hi), ms = ev.ride._m_sprung, MR = ev.metrics.motion_ratio, kt = cfg.spring.tire_rate;
      const kr = ms * (2 * Math.PI * tgt) ** 2 / 1000, ks = kr < kt ? (kr * kt / (kt - kr)) / (MR * MR) : NaN;
      if (Number.isFinite(ks)) extra = `<tr class="fixrow" data-spring="${ks.toFixed(1)}"><td>Change the spring rate to <b>${fmt(ks, 1)} N/mm</b> (${fmt(ks * 5.71, 0)} lbf/in) for ${fmt(tgt, 2)} Hz</td><td class="n">${fmt(tgt, 2)} Hz</td><td><span class="chip ok">none</span></td><td class="acts"><button class="btn small" type="button" data-apply-spring="${ks.toFixed(1)}">Apply</button></td></tr>`;
    }
    html = top.length || extra ? `<p class="note">Single moves that bring <b>${esc(row.label || metricLabel(key)[0])}</b> into range, re-solved for real and re-checked against every other target. Fewest side effects first.</p>
      <div class="tbl-wrap"><table class="data fixt"><thead><tr><th>Move</th><th class="n">Result</th><th>Side effects</th><th></th></tr></thead><tbody>${extra}${top.map((r, i) => `
        <tr class="fixrow" data-i="${i}"><td>${esc(describeMove(r.c, r.mm))}</td><td class="n">${r.bad ? "–" : fmt(r.val, dec)} ${esc(unit || "")}</td>
        <td>${r.bad ? `<span class="chip bad">does not solve</span>` : r.fails.length ? r.fails.map(k => `<span class="chip bad">breaks ${esc(k === "link_clearance" ? "clearance" : metricLabel(k)[0])}</span>`).join(" ") : `<span class="chip ok">none</span>`}</td>
        <td class="acts">${r.bad ? "" : `<button class="btn small" type="button" data-preview="${i}">Preview</button><button class="btn small primary" type="button" data-apply="${i}">Apply</button>`}</td></tr>`).join("")}</tbody></table></div>`
      : `<p class="note">No single move within 40 mm fixes this${lockPack ? " with the ball joints locked. Try unlocking packaging points, or change two points" : ". Try changing two points together"}.</p>`;
    el._fix = top;
  } else {
    res.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
    const top = res.slice(0, 5), [, unit, dec] = metricLabel(key);
    html = top.length ? `<p class="note">This target already passes. These are the biggest levers on it: what +5 mm does (−5 mm does roughly the opposite).</p>
      <div class="tbl-wrap"><table class="data fixt"><thead><tr><th>Move</th><th class="n">Change</th><th>Side effects</th><th></th></tr></thead><tbody>${top.map((r, i) => `
        <tr class="fixrow" data-i="${i}"><td>${esc(describeMove(r.c, 5))}</td><td class="n">${r.effect > 0 ? "+" : ""}${fmt(r.effect, Math.max(dec, 1))} ${esc(unit || "")}</td>
        <td>${r.fails.length ? r.fails.map(k => `<span class="chip bad">breaks ${esc(metricLabel(k)[0])}</span>`).join(" ") : `<span class="chip ok">none</span>`}</td>
        <td class="acts"><button class="btn small" type="button" data-preview="${i}">Preview</button><button class="btn small primary" type="button" data-apply="${i}">Apply</button></td></tr>`).join("")}</tbody></table></div>`
      : `<p class="note">${lockPack ? "None of the free points changes this. It is set by the locked packaging points (ball joints, contact patch, rocker pivot), which come from the upright and wheel design. Untick the box below to see their effect." : "None of the movable points changes this noticeably."}</p>`;
    el._fix = top.map(r => ({ ...r, mm: 5 }));
  }
  html += `<label class="check small-check"><input type="checkbox" class="lockpack" ${lockPack ? "checked" : ""}> Keep ball joints and rocker pivot fixed (set by upright, wheel and chassis packaging)</label>`;
  fixCache.set(sig, html);
  const fixData = el._fix;
  el.innerHTML = html; el._fix = fixData; wireFix(el, key);
}
function wireFix(el, key) {
  const list = el._fix || [];
  $$(".fixrow[data-i]", el).forEach(tr => {
    const r = list[+tr.dataset.i]; if (!r) return;
    tr.addEventListener("mouseenter", () => { view.hl = { path: r.c.pts[0], dir: [[0, 1, 2].map(i => (i === r.c.axis ? Math.sign(r.mm) || 1 : 0)), "", themeColors().accent] }; updateScene(); });
    tr.addEventListener("mouseleave", () => { if (!drawerPath) { view.hl = null; updateScene(); } });
  });
  $$("[data-preview]", el).forEach(b => b.addEventListener("click", () => { const r = list[+b.dataset.preview]; startPreview(movedCfg(cfg, r.c, r.mm), describeMove(r.c, r.mm)); }));
  $$("[data-apply]", el).forEach(b => b.addEventListener("click", () => { const r = list[+b.dataset.apply]; applyCfg(movedCfg(cfg, r.c, r.mm), describeMove(r.c, r.mm)); }));
  $$("[data-apply-spring]", el).forEach(b => b.addEventListener("click", () => { const nc = JSON.parse(JSON.stringify(cfg)); nc.spring.spring_rate = +b.dataset.applySpring; applyCfg(nc, `Spring rate ${b.dataset.applySpring} N/mm`); }));
  $$(".lockpack", el).forEach(c => c.addEventListener("change", () => { setLock(c.checked); whatMoves(key, el); }));
}
function setLock(v) { lockPack = v; store.set("susp.lockpack", v ? "1" : "0"); if (drawerPath) openInfluence(drawerPath); }
const openRows = new Set();
function openFixRow(key) {
  tab = "checks"; store.set("susp.tab", tab); renderTabs(); showPanel();
  openRows.add(key); fixRows.add(key); $("#pn_checks").innerHTML = panelChecks(); wireChecks();
  const box = $(`#pn_checks [data-fixbox="${key}"]`);
  if (box) box.closest("tr").scrollIntoView({ block: "center" });
}

// ------------------------------------------------------------------ preview, apply, undo
function startPreview(nc, label) {
  try { preview = { cfg: nc, ev: S.evaluate(nc), label }; } catch (e) { preview = null; $("#errBox").insertAdjacentHTML("afterbegin", `<div class="banner bad">That move cannot be solved: ${esc(e.message)}</div>`); return; }
  const fails0 = failSet(ev), fails1 = failSet(preview.ev), passN = preview.ev.checks.filter(r => r.status === "PASS").length, tot = preview.ev.checks.filter(r => r.status !== "n/a").length;
  const newly = [...fails1].filter(k => !fails0.has(k)), fixed = [...fails0].filter(k => !fails1.has(k));
  $("#pvbar").innerHTML = `<span><b>Preview:</b> ${esc(label)} · ${passN}/${tot} targets met${fixed.length ? ` · fixes ${fixed.map(k => esc(k === "link_clearance" ? "clearance" : metricLabel(k)[0])).join(", ")}` : ""}${newly.length ? ` · <span class="bad-t">breaks ${newly.map(k => esc(k === "link_clearance" ? "clearance" : metricLabel(k)[0])).join(", ")}</span>` : ""}</span>
    <span class="pvbtns"><button class="btn small primary" type="button" id="pvApply">Apply</button><button class="btn small" type="button" id="pvDiscard">Discard</button></span>`;
  $("#pvbar").hidden = false; $("#ovcap").hidden = true;
  $("#pvApply").onclick = () => applyCfg(preview.cfg, preview.label);
  $("#pvDiscard").onclick = () => endPreview();
  updateScene();
}
function endPreview() { preview = null; $("#pvbar").hidden = true; $("#ovcap").hidden = !view.overlay; updateScene(); }
function applyCfg(nc, label) {
  pushHistory();
  if (!err && ev && !chal) { base = ev; baseName = "before: " + label; }
  preview = null; $("#pvbar").hidden = true;
  cfg = JSON.parse(JSON.stringify(nc)); $("#preset").value = "custom";
  fillForm(); run();
  if (drawerPath) openInfluence(drawerPath);
}

// ------------------------------------------------------------------ influence drawer
let drawerPath = null;
function influenceMetrics() {
  const list = ["roll_center", "rc_lat", "camber_gain", "roll_camber", "bump_steer", "bump_steer_curve"];
  list.push(cfg.axle === "front" ? "antidive" : "antisquat");
  if (cfg.axle === "front") list.push("caster", "kpi", "scrub", "trail", "ackermann");
  list.push("track_change");
  if (cfg.spring) list.push("motion_ratio", "mr_progression", "trans_min");
  return list.filter(k => ev && ev.metrics[k] != null);
}
function openInfluence(path) {
  if (!ev || err || !path) return;
  if (typeof tipSeen === "function") tipSeen();
  if (!influenceAllowed(path)) {
    const hb = $("#chHints"); if (hb) { hb.insertAdjacentHTML("afterbegin", `<p class="chint lockmsg">The influence panel unlocks with the last hint. Try reasoning it out first!</p>`); hb.scrollIntoView({ block: "nearest" }); }
    return;
  }
  drawerPath = path;
  const dr = $("#drawer"); dr.hidden = false; $("#vwrap").classList.add("open");
  const chalAx = chal ? (chal.def.unlock.includes(path) ? chal.def.axes : []) : [0, 1, 2];
  const pt = getPath(cfg, path), locked = (lockPack && PACKAGING.has(path) && !chal) || !chalAx.length, isSpring = path.startsWith("spring.");
  const dirs = [[2, "Up", "Raise"], [1, "Out", "Outboard"], [0, "Fwd", "Forward"]];
  const front = cfg.axle === "front";
  let rows = "", qb, effects = [];
  try {
    qb = S.evaluate(cfg, { full: false, steer: front, pack: false });
    for (const [ax] of dirs) { const c = { pts: [path], axis: ax }; try { effects.push(S.evaluate(movedCfg(cfg, c, 5), { full: false, steer: front, pack: false })); } catch (e) { effects.push(null); } }
  } catch (e) { dr.innerHTML = `<p class="note">${esc(e.message)}</p>`; return; }
  const fb = failSet(qb), keys = influenceMetrics();
  if (isSpring) keys.sort((a, b) => (SPRING_KEYS.has(b) ? 1 : 0) - (SPRING_KEYS.has(a) ? 1 : 0));
  const tg = S.defaultTargets(ev.cfg);
  for (const k of keys) {
    const [lab, , dec] = metricLabel(k), b0 = qb.metrics[k];
    const cells = effects.map(e => {
      if (!e) return `<td class="n muted">–</td>`;
      const d = e.metrics[k] - b0; if (!Number.isFinite(d)) return `<td class="n muted">–</td>`;
      const t = tg[k], span = t && t[0] != null && t[1] != null ? Math.abs(t[1] - t[0]) : Math.max(Math.abs(b0) * 0.5, 10 ** -dec * 20);
      const strength = Math.min(1, Math.abs(d) / (span * 0.25 || 1));
      const breaks = e.checks.some(r => r.key === k && r.status === "FAIL") && !fb.has(k);
      return `<td class="n${breaks ? " brk" : ""}" style="--s:${strength.toFixed(2)}" data-sign="${d > 0 ? "+" : d < 0 ? "-" : "0"}">${Math.abs(d) < 10 ** -(dec + 1) ? "·" : (d > 0 ? "+" : "") + fmt(d, Math.max(dec, 1))}</td>`;
    }).join("");
    const tid = (TERM_BY_METRIC[k] || {}).id;
    rows += `<tr><td>${tid ? `<button class="lnk" type="button" data-term="${tid}">${esc(lab)}</button>` : esc(lab)}</td><td class="n muted">${fmt(ev.metrics[k], dec)}</td>${cells}</tr>`;
  }
  dr.innerHTML = `<div class="drhead"><div><h3>${esc(pointName(path))}</h3><p class="note mono">${esc(path.replace("hardpoints.", ""))} · ${pt.map(v => fmt(v, 1)).join(", ")}</p></div><button class="btn small" type="button" id="drClose" aria-label="Close">✕</button></div>
    ${locked ? (chal ? `<p class="lockmsg">This point is fixed in this challenge. The effects below are for learning.</p>` : `<p class="lockmsg">Locked: usually set by the ${isSpring ? "chassis" : "upright and wheel"} package. The effects below are for learning. <button class="lnk" type="button" id="drUnlock">Unlock</button></p>`) : ""}
    <p class="note">What moving this point <b>5 mm</b> does. Color strength = size of the change; red outline = a target that would start failing. Moving the other way does roughly the opposite.</p>
    <div class="tbl-wrap"><table class="data inf"><thead><tr><th>Metric</th><th class="n">Now</th>${dirs.map(([, lab]) => `<th class="n">${lab} 5</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>
    ${locked ? "" : `<div class="tact drpv"><span class="note">Preview a 5 mm move:</span>${dirs.filter(([ax]) => chalAx.includes(ax)).map(([ax, , long]) => `<button class="btn small" type="button" data-pv="${ax}">${long}</button>`).join("")}</div>`}`;
  $("#drClose").onclick = closeInfluence;
  const ul = $("#drUnlock"); if (ul) ul.onclick = () => setLock(false);
  $$("#drawer [data-pv]").forEach(b => b.addEventListener("click", () => { const ax = +b.dataset.pv, c = { pts: [path], axis: ax, name: pointName(path) }; startPreview(movedCfg(cfg, c, 5), describeMove(c, 5)); }));
  $$("#drawer [data-term]").forEach(b => b.addEventListener("click", () => { if (b.dataset.term) openTerm(b.dataset.term); }));
  view.hl = { path }; updateScene();
}
function closeInfluence() { drawerPath = null; $("#drawer").hidden = true; $("#vwrap").classList.remove("open"); view.hl = null; updateScene(); }

