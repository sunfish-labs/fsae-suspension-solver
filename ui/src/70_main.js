// ------------------------------------------------------------------ toolbar
function loadCfg(raw, name, opts = {}) {
  pushHistory();
  teamFileOpened();
  try {
    S.finishConfig(raw);
  } catch (e) {
    $("#jsonMsg").textContent = e.message;
    return false;
  }
  cfg = JSON.parse(JSON.stringify(raw));
  for (const k of ["wheel", "vehicle", "sweep", "clearance", "loads", "members"]) cfg[k] = S.deepMerge(S.DEFAULTS[k], cfg[k] || {});
  if (!cfg.rack_direction) cfg.rack_direction = [0, 1, 0];
  if (cfg.spring) cfg.spring = S.deepMerge(S.SPRING_DEFAULTS, cfg.spring);
  S.cornerIn(cfg); // a team-frame file into the solver's frame (no-op for one already in it)
  savedSpring = null;
  savedRocker = null;
  if (car && !chal) {
    const ax = cfg.axle === "rear" ? "rear" : "front";
    car.vehicle = cfg.vehicle;
    car[ax] = cfg;
    car[ax === "front" ? "rear" : "front"].vehicle = car.vehicle;
    car.src[ax] = name || cfg.name || "";
    if (axleView !== "car" || opts.toView) {
      axleView = opts.toView || ax;
      store.set("susp.view", axleView);
    }
    applyViewClasses();
  }
  fillForm();
  run();
  return true;
}
{
  const grp = (lab, f) => {
    const o = PRESETS.map((p, i) => [p, i]).filter(([p]) => f(p.cfg));
    return o.length
      ? `<optgroup label="${attr(lab)}">${o.map(([p, i]) => `<option value="${attr(i)}">${esc(p.label)}</option>`).join("")}</optgroup>`
      : "";
  };
  $("#preset").innerHTML =
    grp("Whole cars", isCarRaw) +
    grp("Front corners", c => c.hardpoints && c.axle !== "rear") +
    grp("Rear corners", c => c.hardpoints && c.axle === "rear") +
    `<option value="custom" hidden>Your edits</option>`;
}
$("#preset").addEventListener("change", e => {
  if (e.target.value === "custom") return;
  if (chal) exitChallenge(true);
  view.target = null;
  const p = PRESETS[+e.target.value];
  if (isCarRaw(p.cfg)) {
    axleView = "car";
    store.set("susp.view", "car");
    applyViewClasses();
    loadCar(p.cfg, p.label);
  } else loadCfg(p.cfg, p.label, { toView: p.cfg.axle === "rear" ? "rear" : "front" });
});
function flash(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => (t.hidden = true), 2200);
}
$("#fileIn").addEventListener("change", async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const raw = JSON.parse(await busy(f.text()));
    if (isCarRaw(raw)) {
      if (chal) exitChallenge(true);
      axleView = "car";
      store.set("susp.view", "car");
      applyViewClasses();
      if (loadCar(raw, f.name)) $("#preset").value = "custom";
    } else if (
      !raw.hardpoints &&
      (raw.front || raw.rear || raw.targets || Object.values(raw).some(v => Array.isArray(v) && v.length === 2))
    ) {
      // team targets sit between the general ranges and the design's own; saved files keep only the link (targets_file)
      const apply = c => {
        const t = S.targetsFromFile(raw, c.axle);
        delete t._note;
        c._team_targets = t;
        if (!c.targets_file) c.targets_file = f.name;
        return t;
      };
      const t = apply(cfg);
      if (car && axleView === "car") apply(car.rear === cfg ? car.front : car.rear);
      $("#preset").value = "custom";
      run();
      $("#errBox").insertAdjacentHTML(
        "afterbegin",
        `<div class="banner warn">Applied ${Object.keys(t).length} target ranges from ${esc(f.name)}. Saved designs keep a link to it (<span class="mono">targets_file</span>), so later changes to the team file still apply; your own edits to a range are saved with the design and win.</div>`
      );
    } else {
      if (chal) exitChallenge(true);
      view.target = null;
      if (loadCfg(raw, f.name, { toView: raw.axle === "rear" ? "rear" : "front" })) $("#preset").value = "custom";
    }
  } catch (ex) {
    $("#errBox").innerHTML = `<div class="banner bad">${esc(f.name)} is not a valid config: ${esc(ex.message)}</div>`;
  }
  e.target.value = "";
});
$("#carFile").addEventListener("change", async e => {
  const f = e.target.files[0],
    ax = carSlotPending;
  e.target.value = "";
  if (!f || !ax) return;
  try {
    const raw = JSON.parse(await busy(f.text()));
    if (isCarRaw(raw)) {
      loadCar(raw, f.name);
      return;
    }
    if (!raw.hardpoints) throw new Error("no hardpoints in this file");
    const note = raw.axle && raw.axle !== ax ? ` It was saved as a ${raw.axle} corner and is now used as the ${ax}.` : "";
    loadCfg(Object.assign({}, raw, { axle: ax }), f.name, { toView: "car" });
    $("#preset").value = "custom";
    $("#errBox").insertAdjacentHTML(
      "afterbegin",
      `<div class="banner warn">Opened ${esc(f.name)} as the ${ax} corner. Its vehicle settings (mass, CG, wheelbase…) now apply to the whole car.${note}</div>`
    );
  } catch (ex) {
    $("#errBox").innerHTML = `<div class="banner bad">${esc(f.name)} is not a valid design: ${esc(ex.message)}</div>`;
  }
});
$$("#axleSeg button").forEach(b =>
  b.addEventListener("click", () => {
    if (chal) return;
    setView(b.dataset.ax);
  })
);
$("#btnCopy").addEventListener("click", async e => {
  const txt = JSON.stringify(exportCurrent(), null, 2);
  $("#xmenu").open = false;
  try {
    await navigator.clipboard.writeText(txt);
    flash("Copied the JSON");
  } catch (ex) {
    if (axleView === "car") setView("front");
    $("#cardJson").open = true;
    $("#jsonBox").focus();
    $("#jsonBox").select();
    flash("Copy blocked by the browser: select the JSON box and copy");
  }
});
// Save JSON: a real file on the user's computer. Chrome/Edge can save straight back to the file that was opened;
// other browsers download a copy. Hidden only inside sandboxed embeds, where downloads are blocked.
let framed = false;
try {
  framed = window.self !== window.top;
} catch (e) {
  framed = true;
}
let fileHandle = null;
if (!framed) {
  $("#btnDownload").hidden = false;
  if (window.showSaveFilePicker) $("#btnSaveAs").hidden = false;
  $("#btnSaveAs").addEventListener("click", () => {
    fileHandle = null;
    $("#btnDownload").click();
  });
  $("#btnDownload").addEventListener("click", async () => {
    const txt = JSON.stringify(exportCurrent(), null, 2),
      name = ((axleView === "car" && car && !chal ? car.name : cfg.name) || "design").replace(/[^\w.-]+/g, "_") + ".json";
    try {
      if (window.showSaveFilePicker) {
        if (!fileHandle)
          fileHandle = await window.showSaveFilePicker({
            suggestedName: name,
            types: [{ description: "Design JSON", accept: { "application/json": [".json"] } }],
          });
        const w = await fileHandle.createWritable();
        await w.write(txt);
        await w.close();
        $("#xmenu").open = false;
        flash("Saved to " + fileHandle.name);
        return;
      }
    } catch (ex) {
      if (ex && ex.name === "AbortError") return;
      fileHandle = null;
    }
    const blob = new Blob([txt], { type: "application/json" }),
      a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    $("#xmenu").open = false;
  });
}
// first-visit card, shown on every visit until "Don't show this again" is ticked
function openWelcome() {
  $("#welcome").hidden = false;
  $("#wHide").checked = store.get("susp.hideWelcome") === "1";
  setTimeout(() => $("#wExplore").focus(), 0);
}
function closeWelcome() {
  store.set("susp.hideWelcome", $("#wHide").checked ? "1" : "0");
  $("#welcome").hidden = true;
}
$("#btnStart").addEventListener("click", () => {
  $("#learnMenu").open = false;
  openWelcome();
});
$("#btnChal").addEventListener("click", () => {
  $("#learnMenu").open = false;
  openChallenges();
});
document.addEventListener("click", e => {
  const m = $("#learnMenu");
  if (m.open && !m.contains(e.target)) m.open = false;
});
function openLearn() {
  if (chal) {
    // in a challenge the glossary opens below the goals; the focus view steps aside for it
    document.body.classList.remove("focus");
    renderFocus();
  } else if (axleView === "car") setView("front");
  tab = "learn";
  renderTabs();
  showPanel();
  $("#tabs").scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
}
$("#btnLearn").addEventListener("click", () => {
  $("#learnMenu").open = false;
  openLearn();
});
$("#wClose").addEventListener("click", closeWelcome);
$("#welcome").addEventListener("click", e => {
  if (e.target.id === "welcome") closeWelcome();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !$("#welcome").hidden) closeWelcome();
});
$("#wExplore").addEventListener("click", () => {
  closeWelcome();
  if (!chal) {
    $("#preset").value = String(PRESETS.findIndex(p => isCarRaw(p.cfg)));
    $("#preset").dispatchEvent(new Event("change"));
  }
});
$("#wOpen").addEventListener("click", () => {
  closeWelcome();
  $("#fileIn").click();
});
$("#wChal").addEventListener("click", () => {
  closeWelcome();
  openChallenges();
});
$("#wLearn").addEventListener("click", () => {
  closeWelcome();
  openLearn();
});
$("#btnApplyJson").addEventListener("click", () => {
  try {
    const raw = JSON.parse($("#jsonBox").value);
    if (loadCfg(raw)) {
      $("#jsonMsg").textContent = "Applied.";
      $("#preset").value = "custom";
    }
  } catch (ex) {
    $("#jsonMsg").textContent = "Not valid JSON: " + ex.message;
  }
});
$("#btnUndo").addEventListener("click", () => undo());
$("#btnRedo").addEventListener("click", () => redo());

document.addEventListener("input", e => {
  if (e.target.dataset && e.target.dataset.path) $("#preset").value = "custom";
});

// ------------------------------------------------------------------ boot
buildForm();
initThree();
const savedTab = store.get("susp.tab");
if (savedTab && TABS.some(t => t[0] === savedTab) && savedTab !== "learn") tab = savedTab;
$("#panels").addEventListener("click", e => {
  const b = e.target.closest("[data-msub]");
  if (!b) return;
  tab = b.dataset.msub;
  store.set("susp.tab", tab);
  renderTabs();
  showPanel();
});
wireExport();
wireCad();
wireChassis();
$("#dmChassis").addEventListener("click", () => {
  $("#dispMenu").open = false;
  openChassis();
});
{
  const dm = $("#dispMenu");
  document.addEventListener("click", e => {
    if (dm.open && !dm.contains(e.target)) dm.open = false;
  });
}
wireSettings();
teamBoot();
// boot: the saved car if there is one; else an old single-corner draft inside the example car; else the example car
{
  const ex = exampleCarRaw(),
    savedCar = store.get("susp.car"),
    saved = store.get("susp.cfg");
  let ok = false;
  if (savedCar) {
    try {
      const raw = JSON.parse(savedCar);
      if (isCarRaw(raw)) {
        car = carFrom(raw);
        car.src = { front: "your edits", rear: "your edits" };
        ok = true;
      }
    } catch (e) {
      /* bad draft */
    }
  }
  if (!ok) car = carFrom(ex);
  if (!["car", "front", "rear"].includes(axleView)) axleView = "car";
  cfg = car[axleView === "rear" ? "rear" : "front"];
  if (!ok && saved) {
    try {
      const raw = JSON.parse(saved);
      S.finishConfig(JSON.parse(saved));
      const c = cornerFrom(raw);
      car[c.axle === "rear" ? "rear" : "front"] = c;
      car.vehicle = c.vehicle;
      car.front.vehicle = car.rear.vehicle = c.vehicle;
      car.src[c.axle] = "your edits";
      cfg = car[axleView === "rear" ? "rear" : "front"];
    } catch (e) {
      /* ignore */
    }
  }
  $("#preset").value = ok || saved ? "custom" : String(PRESETS.findIndex(p => p.cfg === ex));
  applyViewClasses();
  fillForm();
  run();
}
$("#vhint").hidden = store.get("susp.tipSeen") === "1";
if (store.get("susp.hideWelcome") !== "1") openWelcome();
