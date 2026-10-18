// 61_justify.js - Design justification (Export menu): for the design event. Every target with its value, the range
// it was held to, whether it is met, why it matters and what sets it, plus the car balance, strength and rules
// summaries, and an empty "our reasoning" line per target for the team to fill in. As a printable page and as Typst
// source (.typ) to edit and compile into the team's own report.
function justifyData() {
  const X = exportScope(),
    M = S.SCHEMA.metrics.corner;
  const corners = X.corners.map(k => ({
    lab: k.lab,
    name: k.c.name || "",
    rows: checkRows(k.e).map(r => ({
      ...r,
      why: (M[r.key] && M[r.key].help) || "",
      moves: (TERM_BY_METRIC[r.key] && TERM_BY_METRIC[r.key].moves) || "",
    })),
    fos: k.L && k.L.checks.length ? Math.min(...k.L.checks.map(q => Math.min(q.sf_buckle, q.sf_yield))) : null,
    fosOk: k.L ? +k.e.cfg.members.sf_target : null,
  }));
  const car_ =
    X.isCar && X.bal
      ? X.bal.checks.map(c => {
          const [lab, unit, dec] = S.CAR_LABELS[c.key];
          return { lab, unit, dec, value: c.value, lo: c.lo, hi: c.hi, status: c.status };
        })
      : [];
  const rules = X.isCar ? trkRules() : null;
  return { X, corners, car: car_, rules };
}
const jStat = s => (s === "PASS" ? "Met" : s === "FAIL" ? "Not met" : s);
function justifyHtml() {
  const D = justifyData(),
    X = D.X;
  const tr = r =>
    `<tr><td><b>${esc(r.lab)}</b>${r.why ? `<br><small>${esc(r.why)}</small>` : ""}${r.moves ? `<br><small><i>Set by:</i> ${esc(r.moves)}</small>` : ""}</td><td class="n">${fmt(r.value, r.dec)} ${esc(r.unit || "")}</td><td>${rngTxt(r.lo, r.hi, r.dec)}</td><td class="${r.status === "PASS" ? "ok" : "bad"}">${jStat(r.status)}</td><td class="why"></td></tr>`;
  let body = `<header><h1>${esc(X.name)}</h1><p>Design justification · ${esc(new Date().toLocaleDateString())} · Wake Forest FSAE Vehicle Dynamics Workbench ${esc(APP_VERSION)}</p></header>
    <p class="note">For each target: the value the design reaches, the range it was held to, why it matters and what sets it. Write the team's reasoning in the last column (why that range, what it traded off, what testing showed). Curves and loads are in the design report.</p>`;
  if (D.car.length)
    body += `<h2>The car</h2><table><thead><tr><th>Target</th><th>Value</th><th>Range</th><th>Status</th><th>Our reasoning</th></tr></thead><tbody>${D.car.map(tr).join("")}</tbody></table>`;
  for (const c of D.corners) {
    const n = c.rows.filter(r => r.status === "PASS").length;
    body += `<h2 class="pb">${esc(c.lab)} corner${c.name ? ": " + esc(c.name) : ""}</h2><p>${n} of ${c.rows.length} targets met${c.fos != null ? ` · lowest link FOS ${fmt(c.fos, 2)} (required ${fmt(c.fosOk, 1)})` : ""}.</p>
      <table><thead><tr><th>Target</th><th>Value</th><th>Range</th><th>Status</th><th>Our reasoning</th></tr></thead><tbody>${c.rows.map(tr).join("")}</tbody></table>`;
  }
  if (D.rules) {
    const k = s => D.rules.filter(r => r.status === s);
    body += `<h2>Rules (FSAE 2027 IC)</h2><p>${k("pass").length} pass, ${k("fail").length} fail, ${k("unknown").length} need input, ${k("manual").length} to check by hand.</p>${
      k("fail").length
        ? `<ul>${k("fail")
            .map(r => `<li class="bad"><b>${esc(r.rule)}</b> ${esc(r.summary)}</li>`)
            .join("")}</ul>`
        : ""
    }`;
  }
  return reportPage(`${X.name} · design justification`, body + `<style>td.why{min-width:180px;border-bottom:1px dotted #9aa}</style>`);
}
// Typst source: same content, markup escaped
const tyEsc = s => String(s ?? "").replace(/([\\#$*_`<>@[\]~=/"'-])/g, "\\$1");
function justifyTyp() {
  const D = justifyData(),
    X = D.X,
    cell = s => `[${tyEsc(s)}]`;
  const rows = L =>
    L.map(
      r =>
        `  [*${tyEsc(r.lab)}*${r.why ? ` \\ #text(size: 8pt)[${tyEsc(r.why)}]` : ""}${r.moves ? ` \\ #text(size: 8pt)[_Set by:_ ${tyEsc(r.moves)}]` : ""}], ${cell(`${fmt(r.value, r.dec)} ${r.unit || ""}`)}, ${cell(rngTxt(r.lo, r.hi, r.dec))}, ${cell(jStat(r.status))}, [_Our reasoning:_ ],`
    ).join("\n");
  const table = L => `#table(columns: (2.2fr, 1fr, 1fr, 0.7fr, 2fr), inset: 5pt, stroke: 0.4pt + gray,
  table.header([*Target*], [*Value*], [*Range*], [*Status*], [*Our reasoning*]),
${rows(L)}
)`;
  let t = `// ${X.name}: design justification, from the Wake Forest FSAE Vehicle Dynamics Workbench ${APP_VERSION}
// Compile with Typst (typst compile this.typ), or paste into typst.app. Fill in "Our reasoning" for each target.
#set page(paper: "us-letter", margin: 0.8in)
#set text(font: "Libertinus Serif", size: 10pt)
#set heading(numbering: "1.")
= ${tyEsc(X.name)}: design justification
For each target: the value the design reaches, the range it was held to, why it matters and what sets it.
`;
  if (D.car.length) t += `\n== The car\n${table(D.car)}\n`;
  for (const c of D.corners)
    t += `\n== ${tyEsc(c.lab)} corner${c.name ? ": " + tyEsc(c.name) : ""}\n${c.rows.filter(r => r.status === "PASS").length} of ${c.rows.length} targets met${c.fos != null ? `; lowest link FOS ${fmt(c.fos, 2)} (required ${fmt(c.fosOk, 1)})` : ""}.\n\n${table(c.rows)}\n`;
  if (D.rules) {
    const k = s => D.rules.filter(r => r.status === s);
    t += `\n== Rules (FSAE 2027 IC)\n${k("pass").length} pass, ${k("fail").length} fail, ${k("unknown").length} need input, ${k("manual").length} to check by hand.\n${k(
      "fail"
    )
      .map(r => `- *${tyEsc(r.rule)}* ${tyEsc(r.summary)}`)
      .join("\n")}\n`;
  }
  return t;
}
$("#xJust").addEventListener("click", () => {
  $("#exMenu").open = false;
  try {
    const b = fileBase(exportScope().name) + "_justification";
    download(b + ".html", new Blob([justifyHtml()], { type: "text/html" }));
    setTimeout(() => download(b + ".typ", new Blob([justifyTyp()], { type: "text/plain" })), 300);
  } catch (x) {
    $("#errBox").insertAdjacentHTML("afterbegin", `<div class="banner bad">Design justification failed: ${esc(x.message)}</div>`);
  }
});
