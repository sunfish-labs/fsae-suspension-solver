// 22_learn.js - Learn tab: the glossary with live values.
// ------------------------------------------------------------------ Learn tab
// each glossary term's live value comes from the metric that names it as its term (schema/metrics.json)
const TERMS = (window.SUSP_TERMS || []).map(t =>
  Object.assign({}, t, { metric: Object.keys(S.SCHEMA.metrics.corner).find(k => S.SCHEMA.metrics.corner[k].term === t.id) || null })
);
const TERM_BY_METRIC = Object.fromEntries(TERMS.filter(t => t.metric).map(t => [t.metric, t]));
let learnQ = "";
function termValue(t) {
  if (!t.metric || !ev) return "";
  const v = ev.metrics[t.metric];
  if (v == null || Number.isNaN(v)) return "";
  const [, unit, dec] = metricLabel(t.metric);
  return `<span class="valchip">This design: <b>${fmt(v, dec)}</b> ${esc(unit)}</span>`;
}
function panelLearn() {
  const cats = [...new Set(TERMS.map(t => t.cat))];
  return `<div class="learnbar"><input id="learnQ" class="num learnq" type="search" placeholder="Search terms, e.g. scrub, roll center, motion ratio" aria-label="Search the glossary" value="${esc(learnQ)}">
    <span class="note"><button class="lnk" type="button" id="learnChal">Ready to practice? Try a challenge.</button> Every "Show me" draws the idea on the 3D corner above. Click any joint in the 3D view to see what moving it does.</span></div>
    <nav class="catnav">${cats.map(c => `<a href="#cat_${c.replace(/\W+/g, "_")}">${esc(c)}</a>`).join("")}</nav>
    ${cats
      .map(
        c =>
          `<section class="cat" id="cat_${c.replace(/\W+/g, "_")}"><h3 class="sub-h">${esc(c)}</h3><div class="terms">${TERMS.filter(
            t => t.cat === c
          )
            .map(
              t => `
      <article class="term" id="term_${t.id}" data-text="${esc((t.name + " " + (t.aka || "") + " " + t.def).toLowerCase())}">
        <h4>${esc(t.name)}${t.aka ? ` <small>${esc(t.aka)}</small>` : ""}</h4>
        <p>${esc(t.def)}</p>
        ${t.conv ? `<p class="kv2"><b>Sign:</b> ${esc(t.conv)}</p>` : ""}
        ${t.moves ? `<p class="kv2"><b>What moves it:</b> ${esc(t.moves)}</p>` : ""}
        <div class="tact">${termValue(t)}${t.show ? `<button class="btn small" type="button" data-show="${attr(t.show)}">Show me</button>` : ""}${t.metric && ev && ev.checks.some(r => r.key === t.metric) ? `<button class="btn small" type="button" data-fixkey="${attr(t.metric)}">What moves this?</button>` : ""}</div>
      </article>`
            )
            .join("")}</div></section>`
      )
      .join("")}`;
}
function wireLearn() {
  const q = $("#learnQ");
  if (!q) return;
  const filter = () => {
    learnQ = q.value.trim().toLowerCase();
    $$("#pn_learn .term").forEach(a => (a.hidden = !!learnQ && !a.dataset.text.includes(learnQ)));
    $$("#pn_learn .cat").forEach(c => (c.hidden = !$$(".term", c).some(a => !a.hidden)));
  };
  q.addEventListener("input", filter);
  filter();
  const lc = $("#learnChal");
  if (lc)
    lc.onclick = () => {
      openChallenges();
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    };
  $$("#pn_learn [data-show]").forEach(b => b.addEventListener("click", () => showMe(b.dataset.show)));
  $$("#pn_learn [data-fixkey]").forEach(b => b.addEventListener("click", () => openFixRow(b.dataset.fixkey)));
}
function openTerm(id) {
  tab = "learn";
  renderTabs();
  showPanel();
  const el = $("#term_" + id);
  if (el) {
    el.scrollIntoView({ block: "center" });
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1500);
  }
}
