// 18_results.js - The results tabs and renderAll: status pills, which panel shows.
// ------------------------------------------------------------------ results
const MOTION = ["heave", "roll", "steer"];
let lastMotion = "heave";
const TAB_BAR = [
  ["checks", "Targets"],
  ["motion", "Motion"],
  ["spring", "Spring & damper"],
  ["loads", "Loads"],
  ["pack", "Packaging"],
  ["compare", "Compare"],
];
const TABS = [
  ["checks", "Targets"],
  ["heave", "Heave"],
  ["roll", "Roll"],
  ["steer", "Steering"],
  ["spring", "Spring & damper"],
  ["loads", "Loads"],
  ["pack", "Packaging"],
  ["compare", "Compare"],
  ["learn", "Learn"],
];
function renderTabs() {
  const fails = ev && !err ? ev.checks.filter(c => c.status === "FAIL").length : 0,
    cur = MOTION.includes(tab) ? "motion" : tab;
  if (MOTION.includes(tab)) lastMotion = tab;
  const bar = TAB_BAR.concat(tab === "learn" ? [["learn", "Learn"]] : []);
  $("#tabs").innerHTML = bar
    .map(
      ([k, t]) =>
        `<button role="tab" type="button" id="tab_${k}" aria-selected="${attr(cur === k)}" aria-controls="pn_${k === "motion" ? lastMotion : k}" data-tab="${attr(k)}">${t}${k === "checks" && fails ? `<span class="dot" aria-label="${fails} failing"></span>` : ""}</button>`
    )
    .join("");
  $$("#tabs button").forEach(b =>
    b.addEventListener("click", () => {
      tab = b.dataset.tab === "motion" ? lastMotion : b.dataset.tab;
      store.set("susp.tab", tab);
      renderTabs();
      showPanel();
    })
  );
}
function motionSeg(k) {
  const items = [
    ["heave", "Heave"],
    ["roll", "Roll"],
  ].concat(cfg && cfg.axle === "rear" ? [] : [["steer", "Steering"]]);
  return `<div class="seg msub" role="group" aria-label="Motion">${items.map(([v, t]) => `<button type="button" data-msub="${attr(v)}" aria-pressed="${attr(v === k)}">${t}</button>`).join("")}</div>`;
}
function showPanel() {
  $$("#panels > .panel").forEach(p => (p.hidden = p.dataset.tab !== tab));
}

function renderAll(ms) {
  renderTabs();
  syncUndoButtons();
  const P = $("#panels");
  if (err) {
    $("#status").innerHTML = `<span class="pill bad">No solution</span>`;
    $("#errBox").innerHTML = `<div class="banner bad"><b>The solver could not finish.</b> ${esc(err.message)}</div>`;
    return;
  }
  const issues = S.validate(ev.cfg);
  if (cfg.targets_file && !cfg._team_targets)
    issues.push([
      "warn",
      `This design uses the team targets file "${cfg.targets_file}". The browser can't read files by path: click Open JSON and choose that file to apply your team's target ranges.`,
    ]);
  $("#errBox").innerHTML = issues.length
    ? `<div class="banner ${issues.some(i => i[0] === "error") ? "bad" : "warn"}"><b>Input checks</b><ul>${issues.map(i => `<li>${i[0] === "error" ? "<b>Error:</b> " : ""}${esc(i[1])}</li>`).join("")}</ul></div>`
    : "";
  const n = ev.checks.filter(c => c.status !== "n/a"),
    np = n.filter(c => c.status === "PASS").length;
  const m = ev.metrics;
  const minFos = loads ? Math.min(...loads.checks.map(c => Math.min(c.sf_buckle, c.sf_yield))) : null;
  $("#status").innerHTML =
    `<span class="pill ${np === n.length ? "ok" : "bad"}"><span class="big">${np}/${n.length}</span> targets met</span>` +
    (m.ride_freq != null ? `<span class="pill neutral">Ride ${fmt(m.ride_freq, 2)} Hz</span>` : "") +
    (m.motion_ratio != null ? `<span class="pill neutral">MR ${fmt(m.motion_ratio, 3)}</span>` : "") +
    (minFos != null ? `<span class="pill ${minFos >= ev.cfg.members.sf_target ? "ok" : "bad"}">Min FOS ${fmt(minFos, 2)}</span>` : "") +
    (loads && loads.bending_check
      ? `<span class="pill ${loads.bending_check.sf >= ev.cfg.members.sf_target ? "ok" : "warn"}" title="The pushrod mount bending the wishbone leg (Loads tab)">Mount bending FOS ${fmt(loads.bending_check.sf, 2)}</span>`
      : "") +
    (loads && loads.compliance
      ? (() => {
          const c = loads.compliance,
            ok = c.toe_ok && c.camber_ok;
          return `<span class="pill ${ok ? "ok" : "warn"}" title="Toe change from links and mounts flexing, worst cornering / braking case (Loads tab)">Compliance toe ${fmt(c.worst_toe.toe, 2)}°</span>`;
        })()
      : "") +
    (base
      ? `<span class="pill neutral">Baseline: ${esc(baseName)} <button class="btn small" id="btnClearBase" type="button" style="margin-left:4px">Clear</button></span>`
      : `<button class="btn small pinbtn" id="btnBase" type="button" title="Freeze these results; your next edits then show as changes and dashed curves">Pin as baseline</button>`);
  const pb = $("#btnBase");
  if (pb)
    pb.addEventListener("click", () => {
      if (!ev || err) return;
      base = ev;
      baseName = cfg.name || "pinned design";
      renderAll(0);
    });
  const cb = $("#btnClearBase");
  if (cb)
    cb.addEventListener("click", () => {
      base = null;
      renderAll(0);
    });
  P.innerHTML = TABS.map(
    ([k]) => `<div class="panel" role="tabpanel" id="pn_${k}" aria-labelledby="tab_${k}" data-tab="${attr(k)}"></div>`
  ).join("");
  $("#pn_checks").innerHTML = panelChecks();
  $("#pn_heave").innerHTML = motionSeg("heave") + panelHeave();
  $("#pn_roll").innerHTML = motionSeg("roll") + panelRoll();
  $("#pn_steer").innerHTML = motionSeg("steer") + panelSteer();
  $("#pn_spring").innerHTML = panelSpring();
  $("#pn_loads").innerHTML = panelLoads();
  $("#pn_pack").innerHTML = panelPack();
  wireJointSelects($("#pn_pack"));
  $("#pn_compare").innerHTML = panelCompare();
  $("#pn_learn").innerHTML = panelLearn();
  wireChecks();
  wireLearn();
  wireCompare();
  updateRail();
  showPanel();
}
