// 20_panels_checks.js - Targets tab: every check with its range, help and the "What moves this?" button.
function metricLabel(k) {
  return S.METRICS[k] || [k, "", 2];
}
const fixRows = new Set();
function checkHelp(key) {
  const t = TERM_BY_METRIC[key];
  return t ? t.def : HELP[key] || "";
}
function panelChecks() {
  const bm = base ? base.metrics : null,
    ncol = bm ? 6 : 4;
  let rows = "";
  for (const c of ev.checks) {
    const [lab, unit, dec] = c.label ? [c.label, c.unit, c.dec] : metricLabel(c.key);
    const editable = !c.label,
      open = openRows.has(c.key);
    const st =
      c.status === "PASS"
        ? `<span class="pill ok">Met</span>`
        : c.status === "FAIL"
          ? `<span class="pill bad">Not met</span>`
          : `<span class="pill neutral">n/a</span>`;
    const rng = editable
      ? `<span class="rng"><input class="num" type="number" step="any" data-tkey="${attr(c.key)}" data-i="0" value="${attr(c.lo == null ? "" : +(+c.lo).toFixed(3))}" aria-label="${esc(lab)} minimum" placeholder="–"> to <input class="num" type="number" step="any" data-tkey="${attr(c.key)}" data-i="1" value="${attr(c.hi == null ? "" : +(+c.hi).toFixed(3))}" aria-label="${esc(lab)} maximum" placeholder="–"></span>`
      : `≥ ${fmt(c.lo, 1)}`;
    let bcol = "";
    if (bm) {
      const bv = c.key === "link_clearance" ? base.metrics.clearance_min : bm[c.key];
      const d = c.value != null && bv != null ? c.value - bv : null;
      bcol = `<td class="n">${fmt(bv, dec)}</td><td class="n ${d > 0 ? "delta-up" : d < 0 ? "delta-dn" : ""}">${d == null || Math.abs(d) < 10 ** -(dec + 1) ? "–" : (d > 0 ? "+" : "") + fmt(d, dec)}</td>`;
    }
    const fixBtn =
      c.status === "n/a" || chal
        ? ""
        : `<button class="btn small ${c.status === "FAIL" ? "primary" : ""}" type="button" data-fixgo="${attr(c.key)}">${c.status === "FAIL" ? "Fix: what moves this?" : "What moves this?"}</button>`;
    rows += `<tr class="clickable${open ? " open" : ""}" data-help="${attr(c.key)}" aria-expanded="${attr(open)}"><td><span class="caret" aria-hidden="true">${open ? "▾" : "▸"}</span> ${esc(lab)}</td><td class="n">${fmt(c.value, dec)} <span class="muted">${unit}</span></td><td>${rng}</td>${bcol}<td>${st}</td></tr>`;
    const t = TERM_BY_METRIC[c.key],
      show = t && t.show;
    rows += `<tr class="help" data-helprow="${attr(c.key)}"${open ? "" : " hidden"}><td colspan="${attr(ncol)}">
      <p class="hdef">${esc(checkHelp(c.key))}</p>
      <div class="tact">${show ? `<button class="btn small" type="button" data-show="${attr(show)}">Show me</button>` : ""}${t ? `<button class="lnk" type="button" data-term="${attr(t.id)}">More in Learn</button>` : ""}${fixBtn}</div>
      <div class="fixbox" data-fixbox="${attr(c.key)}"></div></td></tr>`;
  }
  return `<div class="tbl-wrap"><table class="data"><thead><tr><th>Target</th><th class="n">Value</th><th>Allowed range</th>${bm ? `<th class="n">Baseline</th><th class="n">Change</th>` : ""}<th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note">Click a row to see what the number means, draw it on the 3D view, or find which hardpoint moves fix it. Edit a range to change the target for this design (saved in the JSON under <span class="mono">targets</span>).</p>`;
}
function wireChecks() {
  $$("#pn_checks tr.clickable").forEach(tr =>
    tr.addEventListener("click", e => {
      if (e.target.tagName === "INPUT") return;
      const k = tr.dataset.help,
        h = $(`#pn_checks tr[data-helprow="${cssq(k)}"]`);
      if (!h) return;
      h.hidden = !h.hidden;
      if (h.hidden) {
        openRows.delete(k);
        fixRows.delete(k);
      } else openRows.add(k);
      tr.classList.toggle("open", !h.hidden);
      tr.setAttribute("aria-expanded", String(!h.hidden));
      $(".caret", tr).textContent = h.hidden ? "▸" : "▾";
    })
  );
  $$("#pn_checks input[data-tkey]").forEach(inp =>
    inp.addEventListener("change", () => {
      const k = inp.dataset.tkey,
        cur = S.defaultTargets(ev.cfg)[k] || [null, null];
      const v = inp.value === "" ? null : +inp.value;
      const nv = cur.slice();
      nv[+inp.dataset.i] = v;
      cfg.targets = cfg.targets || {};
      cfg.targets[k] = nv;
      schedule();
    })
  );
  $$("#pn_checks [data-show]").forEach(b => b.addEventListener("click", () => showMe(b.dataset.show)));
  $$("#pn_checks [data-term]").forEach(b => b.addEventListener("click", () => openTerm(b.dataset.term)));
  $$("#pn_checks [data-fixgo]").forEach(b =>
    b.addEventListener("click", () => {
      const k = b.dataset.fixgo;
      fixRows.add(k);
      b.hidden = true;
      whatMoves(k, $(`#pn_checks [data-fixbox="${cssq(k)}"]`));
    })
  );
  // keep "What moves this?" results open across re-solves
  for (const k of fixRows) {
    const box = $(`#pn_checks [data-fixbox="${cssq(k)}"]`);
    if (box && ev.checks.some(c => c.key === k && c.status !== "n/a")) {
      const b = $(`#pn_checks [data-fixgo="${cssq(k)}"]`);
      if (b) b.hidden = true;
      whatMoves(k, box);
    } else fixRows.delete(k);
  }
}
