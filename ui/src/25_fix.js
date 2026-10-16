// 25_fix.js - "What moves this?": candidate moves for a failing target, ranked by a quick re-solve.
// ------------------------------------------------------------------ "What moves this?"
// the candidate moves come from schema/moves.json, shared with the command line's advice
const MOVES = S.SCHEMA.moves;
const SPRING_KEYS = new Set(MOVES.spring_metrics);
const GROUPS = MOVES.groups.map(g => ({ id: g.id, pts: g.points.map(k => "hardpoints." + k), axis: "xyz".indexOf(g.axis), name: g.name }));
function candidateMoves(key) {
  const out = [],
    add = (path, axis) => out.push({ id: `${path}.${axis}`, pts: [path], axis, name: pointName(path) });
  const hp = MOVES.hardpoints.map(k => "hardpoints." + k);
  const spr = cfg.spring ? MOVES.spring_points.filter(k => cfg.spring[k] != null).map(k => "spring." + k) : [];
  const springSide = SPRING_KEYS.has(key),
    clearance = key === "link_clearance";
  const pts = springSide ? spr : clearance ? hp.concat(spr) : hp;
  for (const path of pts) {
    if (lockPack && PACKAGING.has(path)) continue;
    for (const ax of [0, 1, 2]) add(path, ax);
  }
  if (!springSide) GROUPS.forEach(gp => out.push({ ...gp }));
  return out;
}
function describeMove(c, mm) {
  const a = Math.abs(mm),
    n = c.name,
    ax = c.axis;
  const what =
    ax === 2
      ? `${mm > 0 ? "Raise" : "Lower"} ${n}`
      : ax === 1
        ? `Move ${n} ${mm > 0 ? "outboard" : "inboard"}`
        : `Move ${n} ${mm > 0 ? "forward" : "rearward"}`;
  return `${what} ${fmt(a, a < 10 ? 1 : 0)} mm`;
}
function movedCfg(base0, c, mm) {
  const nc = JSON.parse(JSON.stringify(base0));
  for (const path of c.pts) {
    const pt = getPath(nc, path);
    pt[c.axis] = +(pt[c.axis] + mm).toFixed(2);
  }
  return nc;
}
function metricFrom(e, key) {
  return key === "link_clearance" ? e.metrics.clearance_margin : e.metrics[key];
}
function failSet(e) {
  return new Set(e.checks.filter(r => r.status === "FAIL").map(r => r.key));
}
const tick = () => new Promise(r => setTimeout(r, 0));
const fixTok = {};
const fixCache = new Map();
async function whatMoves(key, el) {
  const token = (fixTok[key] = (fixTok[key] || 0) + 1),
    cfg0 = JSON.parse(JSON.stringify(cfg)),
    sig = JSON.stringify(cfg0) + "|" + key + "|" + lockPack;
  if (fixCache.has(sig)) {
    el.innerHTML = fixCache.get(sig);
    wireFix(el, key);
    return;
  }
  const row = ev.checks.find(r => r.key === key);
  if (key === "camber" || key === "toe") {
    el.innerHTML = `<p class="note">${key === "camber" ? "Static camber is set with shims between the upright and the ball joints, not by moving hardpoints. Change <b>Camber</b> under Wheel &amp; vehicle." : "Static toe is set by the tie-rod length, not by moving hardpoints. Change <b>Toe</b> under Wheel &amp; vehicle."}</p>`;
    return;
  }
  const need = { steer: key === "ackermann" || key === "turn_radius", pack: key === "link_clearance" };
  const q = c => S.evaluate(c, { full: false, steer: need.steer, pack: need.pack });
  let lo = row.lo,
    hi = row.hi,
    v = row.value;
  if (key === "link_clearance") {
    lo = 0;
    hi = null;
    v = ev.metrics.clearance_margin;
  }
  const failing = row.status === "FAIL";
  const cands = candidateMoves(key),
    res = [];
  el.innerHTML = `<p class="note">Testing ${cands.length} possible moves…</p>`;
  let qb;
  try {
    qb = q(cfg0);
  } catch (e) {
    el.innerHTML = `<p class="note">The current design does not solve: ${esc(e.message)}</p>`;
    return;
  }
  const vb = metricFrom(qb, key),
    fb = failSet(qb),
    delta = 4;
  const win = lo != null && hi != null ? hi - lo : 0;
  const aim = !failing
    ? null
    : lo != null && v < lo
      ? win
        ? lo + 0.2 * win
        : lo + Math.max(0.5, Math.abs(lo) * 0.05)
      : win
        ? hi - 0.2 * win
        : hi - Math.max(0.005, Math.abs(hi) * 0.05);
  let n = 0;
  for (const c of cands) {
    if (token !== fixTok[key]) return;
    if (++n % 3 === 0) {
      el.querySelector(".note").textContent = `Testing move ${n} of ${cands.length}…`;
      await tick();
    }
    let mp;
    try {
      mp = q(movedCfg(cfg0, c, delta));
    } catch (e) {
      continue;
    }
    const sl = (metricFrom(mp, key) - vb) / delta;
    if (!Number.isFinite(sl) || Math.abs(sl) < 1e-9) continue;
    if (!failing) {
      res.push({ c, mm: 5, effect: sl * 5, fails: [...failSet(mp)].filter(k => !fb.has(k) && k !== key) });
      continue;
    }
    let mv = (aim - vb) / sl,
      x0 = 0,
      y0 = vb,
      got = null;
    if (Math.abs(mv) > 40) continue;
    for (let it = 0; it < 4; it++) {
      let m2;
      try {
        m2 = q(movedCfg(cfg0, c, mv));
      } catch (e) {
        mv *= 0.5;
        continue;
      }
      const y = metricFrom(m2, key);
      const inside = (lo == null || y >= lo - 1e-9) && (hi == null || y <= hi + 1e-9);
      if (inside) {
        got = { mv, y, fails: [...failSet(m2)].filter(k => !fb.has(k) && k !== key) };
        break;
      }
      if (!Number.isFinite(y) || Math.abs(y - y0) < 1e-12) break;
      const x1 = mv;
      mv = x1 + ((aim - y) * (x1 - x0)) / (y - y0);
      x0 = x1;
      y0 = y;
      if (Math.abs(mv) > 40) break;
    }
    if (got) res.push({ c, mm: got.mv, val: got.y, fails: got.fails });
  }
  if (token !== fixTok[key]) return;
  let html;
  if (failing) {
    res.sort((a, b) => a.fails.length - b.fails.length || Math.abs(a.mm) - Math.abs(b.mm));
    const top = res.slice(0, 4),
      base0 = failSet(ev),
      [, unit, dec] = row.label ? ["", row.unit, row.dec] : metricLabel(key);
    // verify the shortlist with the full solver, including clearances
    for (const r of top) {
      await tick();
      if (token !== fixTok[key]) return;
      try {
        const fe = S.evaluate(movedCfg(cfg0, r.c, r.mm));
        r.full = fe;
        r.val = metricFrom(fe, key);
        r.fails = [...failSet(fe)].filter(k => !base0.has(k) && k !== key);
        r.ok = !failSet(fe).has(key);
      } catch (e) {
        r.bad = e.message;
      }
    }
    let extra = "";
    if (key === "ride_freq" && ev.ride && cfg.spring) {
      const tgt = lo != null && hi != null ? (lo + hi) / 2 : (lo ?? hi),
        ms = ev.ride._m_sprung,
        MR = ev.metrics.motion_ratio,
        kt = cfg.spring.tire_rate;
      const kr = (ms * (2 * Math.PI * tgt) ** 2) / 1000,
        ks = kr < kt ? (kr * kt) / (kt - kr) / (MR * MR) : NaN;
      if (Number.isFinite(ks))
        extra = `<tr class="fixrow" data-spring="${attr(ks.toFixed(1))}"><td>Change the spring rate to <b>${fmt(ks, 1)} N/mm</b> (${fmt(ks * 5.71, 0)} lbf/in) for ${fmt(tgt, 2)} Hz</td><td class="n">${fmt(tgt, 2)} Hz</td><td><span class="chip ok">none</span></td><td class="acts"><button class="btn small" type="button" data-apply-spring="${attr(ks.toFixed(1))}">Apply</button></td></tr>`;
    }
    html =
      top.length || extra
        ? `<p class="note">Single moves that bring <b>${esc(row.label || metricLabel(key)[0])}</b> into range, re-solved for real and re-checked against every other target. Fewest side effects first.</p>
      <div class="tbl-wrap"><table class="data fixt"><thead><tr><th>Move</th><th class="n">Result</th><th>Side effects</th><th></th></tr></thead><tbody>${extra}${top
        .map(
          (r, i) => `
        <tr class="fixrow" data-i="${attr(i)}"><td>${esc(describeMove(r.c, r.mm))}</td><td class="n">${r.bad ? "–" : fmt(r.val, dec)} ${esc(unit || "")}</td>
        <td>${r.bad ? `<span class="chip bad">does not solve</span>` : r.fails.length ? r.fails.map(k => `<span class="chip bad">breaks ${esc(k === "link_clearance" ? "clearance" : metricLabel(k)[0])}</span>`).join(" ") : `<span class="chip ok">none</span>`}</td>
        <td class="acts">${r.bad ? "" : `<button class="btn small" type="button" data-preview="${attr(i)}">Preview</button><button class="btn small primary" type="button" data-apply="${attr(i)}">Apply</button>`}</td></tr>`
        )
        .join("")}</tbody></table></div>`
        : `<p class="note">No single move within 40 mm fixes this${lockPack ? " with the ball joints locked. Try unlocking packaging points, or change two points" : ". Try changing two points together"}.</p>`;
    el._fix = top;
  } else {
    res.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
    const top = res.slice(0, 5),
      [, unit, dec] = metricLabel(key);
    html = top.length
      ? `<p class="note">This target already passes. These are the biggest levers on it: what +5 mm does (−5 mm does roughly the opposite).</p>
      <div class="tbl-wrap"><table class="data fixt"><thead><tr><th>Move</th><th class="n">Change</th><th>Side effects</th><th></th></tr></thead><tbody>${top
        .map(
          (r, i) => `
        <tr class="fixrow" data-i="${attr(i)}"><td>${esc(describeMove(r.c, 5))}</td><td class="n">${r.effect > 0 ? "+" : ""}${fmt(r.effect, Math.max(dec, 1))} ${esc(unit || "")}</td>
        <td>${r.fails.length ? r.fails.map(k => `<span class="chip bad">breaks ${esc(metricLabel(k)[0])}</span>`).join(" ") : `<span class="chip ok">none</span>`}</td>
        <td class="acts"><button class="btn small" type="button" data-preview="${attr(i)}">Preview</button><button class="btn small primary" type="button" data-apply="${attr(i)}">Apply</button></td></tr>`
        )
        .join("")}</tbody></table></div>`
      : `<p class="note">${lockPack ? "None of the free points changes this. It is set by the locked packaging points (ball joints, contact patch, rocker pivot), which come from the upright and wheel design. Untick the box below to see their effect." : "None of the movable points changes this noticeably."}</p>`;
    el._fix = top.map(r => ({ ...r, mm: 5 }));
  }
  html += `<label class="check small-check"><input type="checkbox" class="lockpack" ${lockPack ? "checked" : ""}> Keep ball joints and rocker pivot fixed (set by upright, wheel and chassis packaging)</label>`;
  fixCache.set(sig, html);
  const fixData = el._fix;
  el.innerHTML = html;
  el._fix = fixData;
  wireFix(el, key);
}
function wireFix(el, key) {
  const list = el._fix || [];
  $$(".fixrow[data-i]", el).forEach(tr => {
    const r = list[+tr.dataset.i];
    if (!r) return;
    tr.addEventListener("mouseenter", () => {
      view.hl = { path: r.c.pts[0], dir: [[0, 1, 2].map(i => (i === r.c.axis ? Math.sign(r.mm) || 1 : 0)), "", themeColors().accent] };
      updateScene();
    });
    tr.addEventListener("mouseleave", () => {
      if (!drawerPath) {
        view.hl = null;
        updateScene();
      }
    });
  });
  $$("[data-preview]", el).forEach(b =>
    b.addEventListener("click", () => {
      const r = list[+b.dataset.preview];
      startPreview(movedCfg(cfg, r.c, r.mm), describeMove(r.c, r.mm));
    })
  );
  $$("[data-apply]", el).forEach(b =>
    b.addEventListener("click", () => {
      const r = list[+b.dataset.apply];
      applyCfg(movedCfg(cfg, r.c, r.mm), describeMove(r.c, r.mm));
    })
  );
  $$("[data-apply-spring]", el).forEach(b =>
    b.addEventListener("click", () => {
      const nc = JSON.parse(JSON.stringify(cfg));
      nc.spring.spring_rate = +b.dataset.applySpring;
      applyCfg(nc, `Spring rate ${b.dataset.applySpring} N/mm`);
    })
  );
  $$(".lockpack", el).forEach(c =>
    c.addEventListener("change", () => {
      setLock(c.checked);
      whatMoves(key, el);
    })
  );
}
function setLock(v) {
  lockPack = v;
  store.set("susp.lockpack", v ? "1" : "0");
  if (drawerPath) openInfluence(drawerPath);
}
const openRows = new Set();
function openFixRow(key) {
  tab = "checks";
  store.set("susp.tab", tab);
  renderTabs();
  showPanel();
  openRows.add(key);
  fixRows.add(key);
  $("#pn_checks").innerHTML = panelChecks();
  wireChecks();
  const box = $(`#pn_checks [data-fixbox="${cssq(key)}"]`);
  if (box) box.closest("tr").scrollIntoView({ block: "center" });
}
