// 69_import.js - Points from CAD: paste or open a SolidWorks point table, check what each point was matched to and
// the axes, see the checks on the result, then apply it to the open design (a corner, or both corners of a car).
const imp = { rows: [], axesSet: false, unitsSet: false, timer: null, build: null, merged: {} };
// the Settings axes as a CAD frame: which of the CAD's axes is forward, up and right
const IMP_FROM_SETTINGS = {
  solver: { fwd: "+X", up: "+Z", right: "+Y" },
  iso: { fwd: "+X", up: "+Z", right: "-Y" },
  sw: { fwd: "+X", up: "+Y", right: "+Z" },
  adams: { fwd: "-X", up: "+Z", right: "+Y" },
};
function impAxes() {
  return { fwd: $("#impFwd").value, up: $("#impUp").value, right: $("#impRight").value };
}
function impSetAxes(a) {
  $("#impFwd").value = a.fwd;
  $("#impUp").value = a.up;
  $("#impRight").value = a.right;
}
// the designs the points can go into: both corners of an open car, or the one open corner
function impTargets() {
  if (car && !chal) return { front: car.front, rear: car.rear };
  return { [cfg.axle]: cfg };
}
function openImport() {
  if (chal) return flash("Leave the challenge first.");
  const opts = () => S.AXIS_SPECS.map(a => `<option value="${a}">${a}</option>`).join("");
  for (const id of ["#impFwd", "#impUp", "#impRight"]) if (!$(id).options.length) $(id).innerHTML = opts();
  if (!imp.axesSet) impSetAxes(IMP_FROM_SETTINGS[SET.axes] || IMP_FROM_SETTINGS.solver);
  $("#impAxle").value = cfg.axle === "rear" ? "rear" : "front";
  $("#impDlg").hidden = false;
  impParse();
  $("#impText").focus();
}
function closeImport() {
  $("#impDlg").hidden = true;
}
// text -> rows with a guessed meaning; a fresh table also gets its units and axes guessed
function impParse() {
  const { rows } = S.parsePointTable($("#impText").value);
  const prev = Object.fromEntries(imp.rows.map(r => [r.name, r]));
  imp.rows = rows.map(r => {
    const c = S.classifyPointName(r.name),
      old = prev[r.name];
    return { ...r, ...c, key: old && old.userKey ? old.key : c.key || "ignore", userKey: old ? old.userKey : false };
  });
  if (imp.rows.length && !imp.unitsSet) $("#impUnits").value = S.guessUnits(imp.rows);
  if (imp.rows.length && !imp.axesSet) {
    const g = S.guessImportAxes(imp.rows, impAxes());
    if (g) impSetAxes(g);
    imp.fwdSure = g ? g.fwdSure : false;
  }
  impRender();
}
function impRender() {
  const rows = imp.rows,
    tbody = rows
      .map(
        (r, i) => `<tr><td class="${r.key === "ignore" ? "unmatched" : ""}">${esc(r.name)}</td>
      <td><select data-imp="${i}" aria-label="What ${attr(r.name)} is"><option value="ignore">(ignore)</option>${S.IMPORT_TARGETS.map(([k, l]) => `<option value="${k}"${k === r.key ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></td>
      <td>${r.axle ? esc(r.axle) : `<span class="muted">${esc($("#impAxle").value)}</span>`}${r.side ? ` · ${esc(r.side)}` : ""}</td>
      <td class="n mono">${r.v.map(x => fmt(x, 3)).join(", ")}</td></tr>`
      )
      .join("");
  $("#impTable").innerHTML = rows.length
    ? `<div class="tbl-wrap"><table class="data"><thead><tr><th>Point in your table</th><th>Is the solver's</th><th>Axle · side</th><th class="n">X, Y, Z as given</th></tr></thead><tbody>${tbody}</tbody></table></div>`
    : `<p class="note">Nothing read yet: paste the table above, or open the CSV the macro wrote.</p>`;
  $$("#impTable [data-imp]").forEach(s =>
    s.addEventListener("change", () => {
      const r = imp.rows[+s.dataset.imp];
      r.key = s.value;
      r.userKey = true;
      impRender();
    })
  );
  impCheck();
}
// build the import, merge it into copies of the open designs and check them
function impCheck() {
  const box = $("#impChecks");
  imp.merged = {};
  if (!imp.rows.length) {
    box.innerHTML = "";
    $("#impApply").disabled = true;
    return;
  }
  const targets = impTargets();
  const b = S.buildImport(imp.rows, {
    units: $("#impUnits").value,
    axes: impAxes(),
    axle: $("#impAxle").value,
    ground: $("#impGround").checked,
    tireRadius: Object.fromEntries(Object.entries(targets).map(([ax, d]) => [ax, d && d.wheel && d.wheel.tire_radius])),
  });
  imp.build = b;
  const notes = b.notes.slice(),
    problems = b.problems.slice(),
    perAxle = [];
  for (const [ax, a] of Object.entries(b.axles)) {
    const d = targets[ax];
    if (!d) {
      problems.push(
        `${ax === "front" ? "Front" : "Rear"} points: the open design is a ${cfg.axle} corner, so they're left out. Open a car file to import both axles at once.`
      );
      continue;
    }
    const m = impMerge(d, a);
    imp.merged[ax] = m.design;
    const issues = [];
    let ev2 = null;
    try {
      const fc = S.finishConfig(m.design);
      for (const [lv, msg] of S.validate(fc)) issues.push([lv, msg]);
      ev2 = S.evaluate(m.design, { full: false, steer: false, pack: false });
    } catch (e) {
      issues.push(["error", e.message]);
    }
    if (ev2 && ax === "front" && ev2.metrics.caster < -1)
      issues.push([
        "error",
        `Caster comes out at ${fmt(ev2.metrics.caster, 1)}°: forward is probably the other way round. Flip "Forward is your".`,
      ]);
    perAxle.push({ ax, a, m, issues, ev: ev2 });
  }
  const li = (cls, t) => `<li class="${cls}">${t}</li>`;
  let h = "";
  for (const { ax, a, m, issues, ev: e2 } of perAxle) {
    const n = Object.keys(a.hardpoints).length + Object.keys(a.spring).length;
    h += `<h3 class="sub-h">${ax === "front" ? "Front" : "Rear"}: ${n} point${n === 1 ? "" : "s"} imported</h3><ul class="impchk">`;
    if (m.kept.length) h += li("muted", `Kept from the current design (not in the table): ${esc(m.kept.join(", "))}.`);
    for (const t of m.notes) h += li("", esc(t));
    for (const [lv, msg] of issues) h += li(lv === "error" ? "bad-t" : "warn-t", `${lv === "error" ? "✕" : "!"} ${esc(msg)}`);
    if (e2)
      h += li(
        "",
        `With these points: roll center ${fmt(e2.metrics.roll_center, 0)} mm, camber gain ${fmt(e2.metrics.camber_gain, 2)}°/in, ${ax === "front" ? `caster ${fmt(e2.metrics.caster, 1)}°, ` : ""}KPI ${fmt(e2.metrics.kpi, 1)}°, track ${fmt(2 * m.design.hardpoints.contact_patch[1], 0)} mm.`
      );
    h += "</ul>";
  }
  if (b.wheelbase && car && !chal) {
    const now = +car.vehicle.wheelbase;
    if (Math.abs(b.wheelbase - now) > 0.5)
      h += `<label class="small-check"><input type="checkbox" id="impWb" checked> Set the wheelbase to ${fmt(b.wheelbase, 1)} mm from the CAD (now ${fmt(now, 1)} mm)</label>`;
    else notes.push(`Wheelbase from the CAD: ${fmt(b.wheelbase, 1)} mm, as in the car file.`);
  }
  if (!imp.fwdSure)
    notes.push(
      "Forward can't be told from one corner's points alone: check the caster and anti-dive look right after applying (a reversed forward flips their signs)."
    );
  const top =
    (problems.length ? `<ul class="impchk">${problems.map(p => li("bad-t", "✕ " + esc(p))).join("")}</ul>` : "") +
    (notes.length ? `<ul class="impchk">${notes.map(p => li("muted", esc(p))).join("")}</ul>` : "");
  box.innerHTML = top + h;
  const blocking = perAxle.some(p => p.issues.some(([lv]) => lv === "error")) || !perAxle.length;
  $("#impApply").disabled = !perAxle.length;
  $("#impApply").textContent = blocking && perAxle.length ? "Apply anyway" : "Apply to the design";
}
// the imported points over a copy of a design: hardpoints replaced one by one, spring points into its spring block
function impMerge(design, a) {
  const d = JSON.parse(JSON.stringify(design)),
    notes = [];
  d.hardpoints = Object.assign({}, d.hardpoints, a.hardpoints);
  const kept = S.HP_ORDER.filter(k => !a.hardpoints[k] && design.hardpoints && design.hardpoints[k]).map(k =>
    k.replace(/_/g, " ").replace("trackrod", "tie rod")
  );
  const spk = Object.keys(a.spring);
  if (spk.length) {
    if (d.spring) Object.assign(d.spring, a.spring);
    else if (a.spring.rod_outboard && a.spring.damper_chassis) {
      d.spring = S.deepMerge(S.SPRING_DEFAULTS, a.spring);
      notes.push("Spring and damper switched on with the starting rates: enter yours under Spring & damper.");
    } else notes.push("Spring points need the pushrod outboard and the damper chassis mount at least: left out.");
    if (d.spring) {
      const rk = ["rocker_pivot", "rocker_rod", "rocker_damper"];
      if (rk.every(k => a.spring[k]) && !d.spring.rocker_axis) d.spring.rocker_axis = [1, 0, 0];
      if (rk.some(k => a.spring[k]) && !a.spring.rocker_axis)
        notes.push("Rocker axis kept from the design: add a point named 'rocker axis' on the pivot bolt's axis to import it too.");
      if (!rk.some(k => d.spring[k])) {
        for (const k of ["rocker_pivot", "rocker_axis", "rocker_rod", "rocker_damper"]) delete d.spring[k];
      }
    }
  }
  return { design: d, kept, notes };
}
function impApply() {
  const targets = impTargets(),
    axes = Object.keys(imp.merged);
  if (!axes.length) return;
  pushHistory();
  for (const ax of axes) {
    const d = targets[ax],
      m = imp.merged[ax];
    d.hardpoints = m.hardpoints;
    if (m.spring) d.spring = m.spring;
  }
  const wb = $("#impWb");
  if (wb && wb.checked && imp.build.wheelbase) {
    car.vehicle.wheelbase = imp.build.wheelbase;
    if (cfg.vehicle) cfg.vehicle.wheelbase = imp.build.wheelbase;
  }
  $("#preset").value = "custom";
  closeImport();
  fillForm();
  run();
  flash(`Imported into the ${axes.join(" and ")} corner${axes.length > 1 ? "s" : ""}. Undo puts it back.`);
}
$("#impText").addEventListener("input", () => {
  clearTimeout(imp.timer);
  imp.timer = setTimeout(impParse, 200);
});
$("#impPick").addEventListener("click", () => $("#impFile").click());
$("#impFile").addEventListener("change", async e => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  $("#impText").value = await f.text();
  imp.unitsSet = false;
  imp.axesSet = false;
  impParse();
});
$("#impMacro").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([SW_MACRO.replace(/\n/g, "\r\n")], { type: "text/plain" }));
  a.download = "ExportHardpoints.bas";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
$("#impUnits").addEventListener("change", () => {
  imp.unitsSet = true;
  impCheck();
});
for (const id of ["#impFwd", "#impUp", "#impRight"])
  $(id).addEventListener("change", () => {
    imp.axesSet = true;
    imp.fwdSure = true;
    impCheck();
  });
$("#impAxle").addEventListener("change", impRender);
$("#impGround").addEventListener("change", impCheck);
$("#impGuess").addEventListener("click", () => {
  const g = S.guessImportAxes(imp.rows, impAxes());
  if (!g) return flash("Needs both ball joints, a contact patch or wheel center, and an inboard pivot to guess.");
  impSetAxes(g);
  imp.axesSet = true;
  imp.fwdSure = g.fwdSure;
  impCheck();
});
$("#impApply").addEventListener("click", impApply);
$("#impCancel").addEventListener("click", closeImport);
$("#impClose").addEventListener("click", closeImport);
$("#impDlg").addEventListener("click", e => {
  if (e.target.id === "impDlg") closeImport();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("#impDlg").hidden) closeImport();
});
