// 61_justify.js - Design justification (Export menu): for the design event. Every target with its value, the range
// it was held to, whether it is met, why it matters and what sets it, plus the car balance, strength and rules
// summaries, and an empty "our reasoning" line per target for the team to fill in. As a printable page and as Typst
// source (.typ) to edit and compile into the team's own report.
// the team's reasoning, from the car file's "justification" block: {"summary": text, "car.<key>": text,
// "front.<key>": text, "rear.<key>": text}; keys are the metric keys (schema/metrics.json)
function justifyData() {
  const X = exportScope(),
    J = (car && car.justification) || {},
    why = (sec, key) => J[`${sec}.${key}`] || "",
    M = S.SCHEMA.metrics.corner;
  const corners = X.corners.map(k => ({
    lab: k.lab,
    name: k.c.name || "",
    rows: checkRows(k.e).map(r => ({
      ...r,
      why: (M[r.key] && M[r.key].help) || "",
      moves: (TERM_BY_METRIC[r.key] && TERM_BY_METRIC[r.key].moves) || "",
      reason: why(k.lab.toLowerCase(), r.key),
    })),
    fos: k.L && k.L.checks.length ? Math.min(...k.L.checks.map(q => Math.min(q.sf_buckle, q.sf_yield))) : null,
    fosOk: k.L ? +k.e.cfg.members.sf_target : null,
  }));
  const car_ =
    X.isCar && X.bal
      ? X.bal.checks.map(c => {
          const [lab, unit, dec] = S.CAR_LABELS[c.key];
          return { lab, unit, dec, value: c.value, lo: c.lo, hi: c.hi, status: c.status, reason: why("car", c.key) };
        })
      : [];
  const rules = X.isCar ? trkRules() : null;
  return { X, corners, car: car_, rules, summary: J.summary || "" };
}
// the key hand calculations, with this design's numbers put in: [title, plain-text line, Typst math, note]
function justifyCalcs(D) {
  const out = [],
    f = (v, d = 1) => fmt(v, d);
  for (const k of D.X.corners) {
    const e = k.e,
      R = e.ride,
      sc = e.cfg.spring,
      v = e.cfg.vehicle,
      L = k.L;
    if (R && sc) {
      const share = e.cfg.axle === "front" ? v.weight_front : 1 - v.weight_front,
        ks = +sc.spring_rate;
      out.push([
        `${k.lab}: wheel rate`,
        `K_w = k_s · MR² = ${f(ks, 1)} · ${f(R.motion_ratio, 3)}² = ${f(R.wheel_rate, 1)} N/mm`,
        `K_w = k_s dot "MR"^2 = ${f(ks, 1)} dot ${f(R.motion_ratio, 3)}^2 = ${f(R.wheel_rate, 1)} "N/mm"`,
        "Spring rate times the motion ratio squared, at ride height.",
      ]);
      out.push([
        `${k.lab}: ride rate (wheel and tire in series)`,
        `K_r = K_w·K_t / (K_w + K_t) = ${f(R.wheel_rate, 1)}·${f(+sc.tire_rate, 0)} / (${f(R.wheel_rate, 1)} + ${f(+sc.tire_rate, 0)}) = ${f(R.ride_rate, 1)} N/mm`,
        `K_r = (K_w K_t)/(K_w + K_t) = (${f(R.wheel_rate, 1)} dot ${f(+sc.tire_rate, 0)})/(${f(R.wheel_rate, 1)} + ${f(+sc.tire_rate, 0)}) = ${f(R.ride_rate, 1)} "N/mm"`,
        "",
      ]);
      out.push([
        `${k.lab}: sprung mass of one corner`,
        `m_s = m·w / 2 − m_u = ${f(v.mass, 0)}·${f(share, 3)} / 2 − ${f(+sc.unsprung_mass, 1)} = ${f(R._m_sprung, 1)} kg`,
        `m_s = (m w)/2 - m_u = (${f(v.mass, 0)} dot ${f(share, 3)})/2 - ${f(+sc.unsprung_mass, 1)} = ${f(R._m_sprung, 1)} "kg"`,
        "Car mass with driver times this axle's weight share, half per side, less the unsprung mass.",
      ]);
      out.push([
        `${k.lab}: ride frequency`,
        `f = (1/2π)·√(K_r / m_s) = (1/2π)·√(${f(R.ride_rate * 1000, 0)} N/m / ${f(R._m_sprung, 1)} kg) = ${f(R.ride_freq, 2)} Hz`,
        `f = 1/(2 pi) sqrt(K_r / m_s) = 1/(2 pi) sqrt((${f(R.ride_rate * 1000, 0)} "N/m")/(${f(R._m_sprung, 1)} "kg")) = ${f(R.ride_freq, 2)} "Hz"`,
        "",
      ]);
    }
    if (L && L.checks.length) {
      const q = L.checks.reduce((a, b) => (b.sf_buckle < a.sf_buckle ? b : a)),
        E = +e.cfg.members.E,
        id = q.od - 2 * q.wall,
        I = (Math.PI / 64) * (q.od ** 4 - id ** 4);
      out.push([
        `${k.lab}: buckling of the most loaded link in compression (${memLabel(q.member, e).toLowerCase()})`,
        `I = π/64·(OD⁴ − ID⁴) = π/64·(${f(q.od, 2)}⁴ − ${f(id, 2)}⁴) = ${f(I, 0)} mm⁴; P_cr = π²·E·I / L² = π²·${f(E, 0)}·${f(I, 0)} / ${f(q.length, 0)}² = ${f(q.Pcr, 0)} N; FOS = P_cr / P = ${f(q.Pcr, 0)} / ${f(q.compression, 0)} = ${f(q.sf_buckle, 2)}`,
        `I = pi/64 (D^4 - d^4) = pi/64 (${f(q.od, 2)}^4 - ${f(id, 2)}^4) = ${f(I, 0)} "mm"^4 \\ P_"cr" = (pi^2 E I)/L^2 = (pi^2 dot ${f(E, 0)} dot ${f(I, 0)})/${f(q.length, 0)}^2 = ${f(q.Pcr, 0)} "N" \\ "FOS" = P_"cr"/P = ${f(q.Pcr, 0)}/${f(q.compression, 0)} = ${f(q.sf_buckle, 2)}`,
        `Pinned ends; worst compression ${f(q.compression, 0)} N in the ${q.c_case} case.`,
      ]);
    }
  }
  const B = D.X.isCar ? D.X.bal : null;
  if (B && B.Kf + B.Kr > 0) {
    const simple = (B.ms * 9.81 * (B.arm / 1000)) / (B.Kf + B.Kr);
    out.push([
      "Car: roll gradient",
      `φ/a_y ≈ m_s·g·d / (K_φf + K_φr) = ${f(B.ms, 0)}·9.81·${f(B.arm / 1000, 3)} / (${f(B.Kf, 0)} + ${f(B.Kr, 0)}) = ${f(simple, 2)} deg/g (full model, with tire squash: ${f(B.grad, 2)})`,
      `phi/a_y approx (m_s g d)/(K_(phi f) + K_(phi r)) = (${f(B.ms, 0)} dot 9.81 dot ${f(B.arm / 1000, 3)})/(${f(B.Kf, 0)} + ${f(B.Kr, 0)}) = ${f(simple, 2)} "deg/g"`,
      `d = roll moment arm (CG height above the roll axis), K = each axle's roll stiffness in N m/deg with springs, bars and tires. The workbench's full model gives ${f(B.grad, 2)} deg/g.`,
    ]);
  }
  return out;
}
const jStat = s => (s === "PASS" ? "Met" : s === "FAIL" ? "Not met" : s);
function justifyHtml() {
  const D = justifyData(),
    X = D.X;
  const tr = r =>
    `<tr><td><b>${esc(r.lab)}</b>${r.why ? `<br><small>${esc(r.why)}</small>` : ""}${r.moves ? `<br><small><i>Set by:</i> ${esc(r.moves)}</small>` : ""}</td><td class="n">${fmt(r.value, r.dec)} ${esc(r.unit || "")}</td><td>${rngTxt(r.lo, r.hi, r.dec)}</td><td class="${r.status === "PASS" ? "ok" : "bad"}">${jStat(r.status)}</td><td class="why">${esc(r.reason || "")}</td></tr>`;
  let body = `<header><h1>${esc(X.name)}</h1><p>Design justification · ${esc(new Date().toLocaleDateString())} · Wake Forest FSAE Vehicle Dynamics Workbench ${esc(APP_VERSION)}</p></header>
    <p class="note">For each target: the value the design reaches, the range it was held to, why it matters and what sets it. Write the team's reasoning in the last column (why that range, what it traded off, what testing showed). Curves and loads are in the design report.</p>${D.summary ? `<h2>Design summary</h2><p>${esc(D.summary)}</p>` : ""}`;
  if (D.car.length)
    body += `<h2>The car</h2><table><thead><tr><th>Target</th><th>Value</th><th>Range</th><th>Status</th><th>Our reasoning</th></tr></thead><tbody>${D.car.map(tr).join("")}</tbody></table>`;
  for (const c of D.corners) {
    const n = c.rows.filter(r => r.status === "PASS").length;
    body += `<h2 class="pb">${esc(c.lab)} corner${c.name ? ": " + esc(c.name) : ""}</h2><p>${n} of ${c.rows.length} targets met${c.fos != null ? ` · lowest link FOS ${fmt(c.fos, 2)} (required ${fmt(c.fosOk, 1)})` : ""}.</p>
      <table><thead><tr><th>Target</th><th>Value</th><th>Range</th><th>Status</th><th>Our reasoning</th></tr></thead><tbody>${c.rows.map(tr).join("")}</tbody></table>`;
  }
  const C = justifyCalcs(D);
  if (C.length)
    body += `<h2 class="pb">Key calculations</h2><p class="note">The workbench's numbers, worked by hand so a judge can follow them.</p>${C.map(([t, l, , n]) => `<h3>${esc(t)}</h3><p class="mono">${esc(l)}</p>${n ? `<p class="note">${esc(n)}</p>` : ""}`).join("")}`;
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
        `  [*${tyEsc(r.lab)}*${r.why ? ` \\ #text(size: 8pt)[${tyEsc(r.why)}]` : ""}${r.moves ? ` \\ #text(size: 8pt)[_Set by:_ ${tyEsc(r.moves)}]` : ""}], ${cell(`${fmt(r.value, r.dec)} ${r.unit || ""}`)}, ${cell(rngTxt(r.lo, r.hi, r.dec))}, ${cell(jStat(r.status))}, [${r.reason ? tyEsc(r.reason) : "_Our reasoning:_ "}],`
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
${D.summary ? `\n== Design summary\n${tyEsc(D.summary)}\n` : ""}`;
  if (D.car.length) t += `\n== The car\n${table(D.car)}\n`;
  for (const c of D.corners)
    t += `\n== ${tyEsc(c.lab)} corner${c.name ? ": " + tyEsc(c.name) : ""}\n${c.rows.filter(r => r.status === "PASS").length} of ${c.rows.length} targets met${c.fos != null ? `; lowest link FOS ${fmt(c.fos, 2)} (required ${fmt(c.fosOk, 1)})` : ""}.\n\n${table(c.rows)}\n`;
  const C = justifyCalcs(D);
  if (C.length)
    t += `\n== Key calculations\nThe workbench's numbers, worked by hand.\n${C.map(([ti, , m, n]) => `\n=== ${tyEsc(ti)}\n$ ${m} $\n${n ? tyEsc(n) + "\n" : ""}`).join("")}`;
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
