// 62_techpack.js - Tech inspection package (Export menu): what the team hands the inspectors and works through before
// the event. Every rule the workbench checks, with this car's value and status and a box for the evidence (photo,
// drawing, receipt); the items it can't check, to tick by hand; and the suspension fastener schedule (bolt, grade,
// shear, worst load and FOS from the loads, plus grip length, locking and washer columns for the team to fill in).
function techpackHtml() {
  const X = exportScope();
  if (!X.isCar) throw new Error("open the car (Car view): the package covers the whole car");
  const rules = trkRules() || [],
    st = {
      pass: ["✓ Pass", "ok"],
      fail: ["✗ Fail", "bad"],
      unknown: ["Needs input", ""],
      manual: ["☐ Check by hand", ""],
      na: ["Doesn't apply", ""],
    };
  const val = r =>
    r.value == null || typeof r.value === "boolean" || Array.isArray(r.value)
      ? r.note || ""
      : `${fmt(r.value, 1)} ${r.unit || ""}${r.note ? " · " + r.note : ""}`;
  const row = r =>
    `<tr><td><b>${esc(r.rule)}</b></td><td>${esc(r.summary)}</td><td>${esc(val(r))}</td><td class="${st[r.status] ? st[r.status][1] : ""}" style="white-space:nowrap">${st[r.status] ? st[r.status][0] : esc(r.status)}</td><td class="ev"></td></tr>`;
  const auto = rules.filter(r => r.status !== "manual"),
    man = rules.filter(r => r.status === "manual"),
    n = s => rules.filter(r => r.status === s).length;
  let body = `<header><h1>${esc(X.name)}</h1><p>Tech inspection package · ${esc(new Date().toLocaleDateString())} · Wake Forest FSAE Vehicle Dynamics Workbench ${esc(APP_VERSION)}</p></header>
    <p class="pills"><span class="pill okb">${n("pass")} pass</span> <span class="pill ${n("fail") ? "badb" : ""}">${n("fail")} fail</span> <span class="pill">${n("unknown")} need input</span> <span class="pill">${n("manual")} to check by hand</span></p>
    <p class="note">Rules are paraphrased by rule number: read the rulebook for the exact wording. Put the evidence for each line in its last column (a photo, the drawing, a receipt or a measurement) before the event, and bring this sheet to technical inspection.</p>
    <h2>Measured by the workbench</h2><table><thead><tr><th>Rule</th><th>Requirement</th><th>This car</th><th>Status</th><th>Evidence</th></tr></thead><tbody>${auto.map(row).join("")}</tbody></table>
    <h2 class="pb">Check on the car or in CAD</h2><table><thead><tr><th>Rule</th><th>Requirement</th><th>Note</th><th>Status</th><th>Checked by, date</th></tr></thead><tbody>${man.map(row).join("")}</tbody></table>`;
  // the suspension fastener schedule, from each corner's loads
  const END = {
    upper_front: "Upper wishbone",
    upper_rear: "Upper wishbone",
    lower_front: "Lower wishbone",
    lower_rear: "Lower wishbone",
    tie_rod: "Tie rod",
    pushrod: "Pushrod",
  };
  body += `<h2 class="pb">Suspension fastener schedule</h2><p class="note">One row per bolted joint at each end of each link. Bolt, grade and shear from the design file; worst load and bolt FOS from the load cases. Fill in the grip length (the unthreaded shank must carry the shear, not the threads), the nut and locking method (nyloc only below 80 °C; safety wire or all-metal lock nuts near the exhaust and brakes) and the washer (larger than the rod end's ball on a captured joint). Critical fasteners: see T.8 and V.3.1.5.</p>`;
  for (const k of X.corners) {
    const mem = k.e.cfg.members,
      bolt = `${fmt(+mem.bolt_dia, 2)} mm ${esc(String(mem.bolt_grade || ""))}`,
      sh = +(mem.bolt_shear_planes || 2) === 2 ? "double" : "single";
    const rows = (k.L ? k.L.parts : [])
      .flatMap(p => {
        const lab = k.e.cfg.axle === "rear" && p.member === "tie_rod" ? "Toe link" : END[p.member] || p.member,
          leg = /^(upper|lower)_/.test(p.member) ? ` (${memLabel(p.member, k.e).toLowerCase()})` : "";
        return [
          [`${lab}${leg}, inboard`, p],
          [`${lab}${leg}, outboard`, p],
        ];
      })
      .map(
        ([w, p]) =>
          `<tr><td>${esc(w)}</td><td>${bolt}</td><td>${sh}</td><td class="n">${fmt(p.peak, 0)} <small>(${esc(p.p_case || "")})</small></td><td class="n ${p.sf_bolt != null && p.sf_bolt < +mem.sf_target ? "bad" : ""}">${p.sf_bolt != null ? fmt(p.sf_bolt, 1) : "–"}</td><td></td><td></td><td></td></tr>`
      )
      .join("");
    body += `<h3>${esc(k.lab)} corner (×2, left and right)</h3><table><thead><tr><th>Joint</th><th>Bolt</th><th>Shear</th><th>Worst load, N</th><th>Bolt FOS</th><th>Grip length</th><th>Nut / locking</th><th>Washer</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  return reportPage(
    `${X.name} · tech inspection package`,
    body +
      `<style>td.ev{min-width:160px;border-bottom:1px dotted #9aa}.pill{border:1px solid #ccd;border-radius:10px;padding:1px 8px}.okb{background:#dcf0e3}.badb{background:#f8d7d3}</style>`
  );
}
$("#xTech").addEventListener("click", () => {
  $("#exMenu").open = false;
  try {
    download(fileBase(exportScope().name) + "_tech_package.html", new Blob([techpackHtml()], { type: "text/html" }));
  } catch (x) {
    $("#errBox").insertAdjacentHTML("afterbegin", `<div class="banner bad">Tech inspection package: ${esc(x.message)}</div>`);
  }
});
