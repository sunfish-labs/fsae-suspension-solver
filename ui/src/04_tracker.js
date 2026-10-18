// 04_tracker.js - Tech inspection tracker: every area the inspectors check, with an owner, a status and notes, and the
// percentage done. It lives in the team settings (encrypted, team/settings.enc), so the team sees it and only the admin
// changes it; changes reach the team when the admin commits a new settings.enc. Seed: schema/tracker_seed.json.
const TRK_STATUS = [
  ["todo", "To do"],
  ["doing", "Doing"],
  ["done", "Done"],
  ["na", "N/A"],
];
const TRK_HOW = { solver: "Workbench", car: "On the car", cad: "CAD", docs: "Paperwork" };
const trk = { q: "", st: "" };
const trkItems = () => (TEAM.data && Array.isArray(TEAM.data.tracker) ? TEAM.data.tracker : []);
const trkSeed = () => (window.SUSP_SCHEMA && window.SUSP_SCHEMA.tracker_seed) || { areas: [], items: [] };
function trkPct(list) {
  const live = list.filter(i => i.status !== "na"),
    done = live.filter(i => i.status === "done").length;
  return { done, n: live.length, pct: live.length ? Math.round((100 * done) / live.length) : 0 };
}
function trkBar(list) {
  const n = list.length || 1,
    c = s => list.filter(i => (i.status || "todo") === s).length;
  return `<div class="trkbar">${["done", "doing", "na"].map(s => `<span class="s-${s}" style="width:${(100 * c(s)) / n}%"></span>`).join("")}</div>`;
}
// the workbench's own verdict on a tracker item: the rules rows whose rule numbers match the item's, from the design
// open now (pass / fail / input / hand), or null when it measures nothing for that item
function trkRules() {
  try {
    if (!car || chal) return null;
    const r = carRes || evalCar(),
      rs = S.RULESETS.fsae_2027_ic;
    if (!rs || !r.F.ev || !r.R.ev) return null;
    const F = r.F.ev,
      R = r.R.ev;
    return S.checkRules(
      rs,
      S.ruleValues(F.cfg, F, R.cfg, R, r.bal, car.layout || null, car.cockpit || null, groundPointsFor(F, R), car.brake_system || null)
    );
  } catch (e) {
    return null;
  }
}
const ruleToks = s => (String(s || "").match(/[A-Z]{1,2}\.\d+(?:\.\d+)*/g) || []).map(t => t + ".");
function trkAuto(it, rows) {
  if (!rows || !(it.how || []).includes("solver")) return null;
  const mine = ruleToks(it.rule);
  if (!mine.length) return null;
  const hit = rows.filter(r => ruleToks(r.rule).some(t => mine.some(m => t.startsWith(m) || m.startsWith(t))));
  if (!hit.length) return null;
  const has = s => hit.some(r => r.status === s);
  const st = has("fail") ? "fail" : has("unknown") ? "input" : hit.every(r => r.status === "pass" || r.status === "na") ? "pass" : "hand";
  const why = hit
    .filter(r => r.status === (st === "input" ? "unknown" : st === "hand" ? "manual" : st))
    .map(r => `${r.rule}: ${r.summary}`);
  return { st, n: hit.length, why };
}
const TRK_AUTO = {
  pass: ["✓ Workbench: pass", "ok"],
  fail: ["✗ Workbench: fail", "bad"],
  input: ["Workbench: needs input", "neutral"],
  hand: ["Workbench: check by hand", "neutral"],
};
function openTracker() {
  $("#trkDlg").hidden = false;
  renderTracker();
}
function renderTracker() {
  const box = $("#trkBody");
  if (!box) return;
  const items = trkItems(),
    admin = TEAM.admin,
    areas = [...new Set(trkSeed().areas.concat(items.map(i => i.area)))];
  if (!items.length) {
    box.innerHTML = admin
      ? `<p class="note">No tracker yet.</p><div class="laybtns"><button class="btn primary" type="button" id="trkSeed">Start from the FSAE 2027 checklist</button><button class="btn" type="button" id="trkImp">Import a tracker file…</button><input type="file" id="trkFile" accept=".json" hidden></div>
        <p class="note">Then Download settings.enc (Settings → Team) and commit it so the team sees it.</p>`
      : `<p class="note">The team's admin hasn't set up the tracker yet.</p>`;
    wireTracker(box);
    return;
  }
  const rules = trkRules(),
    autos = items.map(i => trkAuto(i, rules)),
    nAuto = autos.filter(a => a && (a.st === "pass" || a.st === "fail")).length;
  const T = trkPct(items),
    q = trk.q.toLowerCase(),
    shown = items.filter(
      i =>
        (!trk.st || (trk.st === "open" ? i.status !== "done" && i.status !== "na" : (i.status || "todo") === trk.st)) &&
        (!q || `${i.rule} ${i.item} ${i.owner || ""} ${i.note || ""} ${i.area}`.toLowerCase().includes(q))
    );
  const row = it => {
    const k = items.indexOf(it),
      st = it.status || "todo";
    return `<div class="trkrow" data-status="${attr(st)}"><div class="trkrule">${esc(it.rule || "")}</div>
      <div class="trkwhat"><p>${esc(it.item)}</p><div>${(it.how || []).map(h => `<span class="trktag${h === "solver" ? " sol" : ""}">${esc(TRK_HOW[h] || h)}</span>`).join("")}${autos[k] ? ` <span class="pill ${TRK_AUTO[autos[k].st][1]} trkauto" title="${attr(autos[k].why.join("\n") || "From the design open now")}">${TRK_AUTO[autos[k].st][0]}</span>` : ""}</div>
      ${admin ? `<input class="trknote" type="text" data-trk="${k}" data-tk="note" value="${attr(it.note || "")}" placeholder="Notes" aria-label="Notes">` : it.note ? `<p class="note">${esc(it.note)}</p>` : ""}</div>
      <div>${admin ? `<input type="text" data-trk="${k}" data-tk="owner" value="${attr(it.owner || "")}" placeholder="Owner" aria-label="Owner">` : `<span class="muted">${esc(it.owner || "no owner")}</span>`}</div>
      <div class="seg trkseg" role="group" aria-label="Status">${TRK_STATUS.map(([s, l]) => `<button type="button" class="${s}" data-trk="${k}" data-ts="${s}" aria-pressed="${st === s}"${admin ? "" : " disabled"}>${l}</button>`).join("")}</div></div>`;
  };
  box.innerHTML = `<div class="trksum"><div><div class="trkpct">${T.pct}%<small> done · ${T.done} of ${T.n}</small></div>${trkBar(items)}
      <p class="note">${items.filter(i => i.status === "doing").length} in progress · ${items.filter(i => (i.status || "todo") === "todo").length} not started · ${items.filter(i => i.status !== "done" && i.status !== "na" && !(i.owner || "").trim()).length} open with no owner</p></div>
    <div class="trkareas">${areas
      .filter(a => items.some(i => i.area === a))
      .map(a => {
        const L = items.filter(i => i.area === a),
          P = trkPct(L);
        return `<div><div class="al"><b>${esc(a)}</b><span>${P.done}/${P.n}</span></div>${trkBar(L)}</div>`;
      })
      .join("")}</div></div>
    <div class="trktools"><input type="search" id="trkQ" placeholder="Search items, rules, owners" value="${attr(trk.q)}" aria-label="Search">
      <select id="trkSt" aria-label="Status"><option value="">Any status</option><option value="open">Not done yet</option>${TRK_STATUS.map(([s, l]) => `<option value="${s}"${trk.st === s ? " selected" : ""}>${l}</option>`).join("")}</select>
      ${admin && nAuto ? `<button class="btn small" type="button" id="trkAutoSet" title="Pass → Done, fail → Doing, for the items the workbench measures">Set ${nAuto} statuses from the workbench</button>` : ""}
      ${admin ? `<button class="btn small" type="button" id="trkAdd">Add an item</button><button class="btn small" type="button" id="trkDl">Download settings.enc</button>` : ""}</div>
    <p class="note">${rules ? `Workbench results come from the design open now (${esc(car.name || "car")}): they update as it changes.` : "Open a car (Car view) to see the workbench's results on its items."}</p>
    ${admin ? `<p class="note">You're the admin: changes save in this browser at once; the team sees them after you commit the new settings.enc.</p>` : `<p class="note">Read-only: the team's admin updates the tracker.</p>`}
    ${
      areas
        .filter(a => shown.some(i => i.area === a))
        .map(
          a =>
            `<section class="trkarea"><h3>${esc(a)}</h3>${shown
              .filter(i => i.area === a)
              .map(row)
              .join("")}</section>`
        )
        .join("") || `<p class="note">Nothing matches.</p>`
    }`;
  if (trk.st) $("#trkSt").value = trk.st;
  wireTracker(box);
}
function trkSave(fn) {
  return teamEdit(d => {
    if (!Array.isArray(d.tracker)) d.tracker = [];
    fn(d.tracker);
  }).then(renderTracker);
}
function wireTracker(box) {
  const on = (id, f) => {
    const el = $("#" + id, box);
    if (el) el.onclick = f;
  };
  on("trkSeed", () =>
    trkSave(t => t.push(...trkSeed().items.map(i => Object.assign({ status: "todo", owner: "", note: "" }, JSON.parse(JSON.stringify(i))))))
  );
  on("trkImp", () => $("#trkFile", box).click());
  const f = $("#trkFile", box);
  if (f)
    f.onchange = async () => {
      try {
        const j = JSON.parse(await f.files[0].text()),
          list = Array.isArray(j) ? j : j.tracker;
        if (!Array.isArray(list)) throw new Error("no tracker list in that file");
        trkSave(t => t.push(...list));
      } catch (e) {
        box.insertAdjacentHTML("afterbegin", `<div class="banner bad">That file doesn't load: ${esc(e.message)}</div>`);
      }
    };
  on("trkDl", teamDownload);
  on("trkAutoSet", () => {
    const rows = trkRules();
    trkSave(t =>
      t.forEach(it => {
        const a = trkAuto(it, rows);
        if (a && a.st === "pass") it.status = "done";
        else if (a && a.st === "fail") it.status = "doing";
      })
    );
  });
  on("trkAdd", () => {
    const item = window.prompt("What has to be true? (e.g. Fire extinguishers mounted)");
    if (item)
      trkSave(t =>
        t.push({ id: "u" + Date.now(), area: "Equipment and markings", rule: "", item, how: ["car"], status: "todo", owner: "", note: "" })
      );
  });
  const q = $("#trkQ", box);
  if (q)
    q.oninput = () => {
      trk.q = q.value;
      renderTracker();
      const q2 = $("#trkQ");
      q2.focus();
      q2.setSelectionRange(q2.value.length, q2.value.length);
    };
  const st = $("#trkSt", box);
  if (st)
    st.onchange = () => {
      trk.st = st.value;
      renderTracker();
    };
  $$("[data-ts]", box).forEach(b => (b.onclick = () => trkSave(t => (t[+b.dataset.trk].status = b.dataset.ts))));
  $$("input[data-tk]", box).forEach(i => (i.onchange = () => trkSave(t => (t[+i.dataset.trk][i.dataset.tk] = i.value.trim()))));
}
function wireTrackerDlg() {
  $("#btnTracker").addEventListener("click", openTracker);
  $("#trkClose").addEventListener("click", () => ($("#trkDlg").hidden = true));
  $("#trkDlg").addEventListener("click", e => {
    if (e.target.id === "trkDlg") $("#trkDlg").hidden = true;
  });
}
