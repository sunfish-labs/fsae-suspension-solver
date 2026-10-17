// ------------------------------------------------------------------ the Settings dialog (⚙ in the top bar)
function qualityRatio() {
  const d = window.devicePixelRatio || 1;
  return SET.quality === "low" ? Math.min(0.75, d) : SET.quality === "normal" ? 1 : Math.min(2, d);
}
const themeNow = () => document.documentElement.getAttribute("data-theme") || "";
function syncSettingsForm() {
  $$("#setDlg [data-theme-set]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.themeSet === themeNow())));
  $("#setAxes").value = SET.axes;
  $("#setOrigin").value = SET.origin;
  $("#setAdv").checked = !!SET.advanced;
  $$("#setDlg [data-settab]").forEach(c => (c.checked = SET.tabs[c.dataset.settab] !== false));
  $("#setQuality").value = SET.quality;
  $("#setTips").checked = !!SET.tips;
}
// apply the settings to the page; rerun when the coordinates changed (the tables and the 3D axes follow)
function applySettings({ rerun = true } = {}) {
  document.body.classList.toggle("simple", !SET.advanced);
  $("#advHint").hidden = !!SET.advanced;
  $("#hpHint").textContent = "mm · " + frameShort() + (frameIsTeam() ? " · as in the files" : " · this screen only (files: ISO 8855)");
  const k = $("#vaxkey");
  if (k) {
    k.textContent = frameAxes().names.join(" · ");
    k.title = `${frameNote(cfg && cfg.axle ? cfg.axle : "car")} Hover over any joint or the chassis to read its coordinates.`;
  }
  if (typeof three !== "undefined" && three) {
    three.renderer.setPixelRatio(qualityRatio());
    const cv = three.cv;
    if (cv.clientWidth && cv.clientHeight) three.renderer.setSize(cv.clientWidth, cv.clientHeight, false);
    makeTriad();
    three.need = true;
  }
  if (
    tab &&
    TAB_BAR.some(([t]) => t === (MOTION.includes(tab) ? "motion" : tab)) &&
    SET.tabs[MOTION.includes(tab) ? "motion" : tab] === false
  )
    tab = "checks";
  if (rerun && cfg) {
    fillForm();
    run();
  }
}
function setSetting(fn) {
  fn();
  saveSettings();
  syncSettingsForm();
  applySettings();
}
function openSettings() {
  syncSettingsForm();
  $("#setDlg").hidden = false;
  setTimeout(() => $("#setClose").focus(), 0);
}
function wireSettings() {
  $("#setAxes").innerHTML = ["iso", "solver", "sw", "adams"]
    .map(k => [k, FRAME_AXES[k]])
    .map(([k, f]) => `<option value="${attr(k)}">${esc(f.label)}</option>`)
    .join("");
  $("#btnSettings").addEventListener("click", openSettings);
  $("#setClose").addEventListener("click", () => ($("#setDlg").hidden = true));
  $("#setDlg").addEventListener("click", e => {
    if (e.target.id === "setDlg") $("#setDlg").hidden = true;
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("#setDlg").hidden) $("#setDlg").hidden = true;
  });
  $$("#setDlg [data-theme-set]").forEach(b =>
    b.addEventListener("click", () => {
      const t = b.dataset.themeSet;
      if (t) document.documentElement.setAttribute("data-theme", t);
      else document.documentElement.removeAttribute("data-theme");
      store.set("susp.theme", t);
      syncSettingsForm();
      if (cfg) run(); // the 3D view picks up the theme's colors
    })
  );
  $("#setAxes").addEventListener("change", e => setSetting(() => (SET.axes = e.target.value)));
  $("#setOrigin").addEventListener("change", e => setSetting(() => (SET.origin = e.target.value)));
  $("#setAdv").addEventListener("change", e => setSetting(() => (SET.advanced = e.target.checked)));
  $("#advShow").addEventListener("click", () => setSetting(() => (SET.advanced = true)));
  $$("#setDlg [data-settab]").forEach(c => c.addEventListener("change", () => setSetting(() => (SET.tabs[c.dataset.settab] = c.checked))));
  $("#setQuality").addEventListener("change", e => setSetting(() => (SET.quality = e.target.value)));
  $("#setTips").addEventListener("change", e => setSetting(() => (SET.tips = e.target.checked)));
  $("#setReset").addEventListener("click", () =>
    setSetting(() => {
      Object.assign(SET, JSON.parse(JSON.stringify(SET_DEFAULTS)), { advanced: true });
    })
  );
  $("#setClear").addEventListener("click", async () => {
    if (!window.confirm("Clear the design, the chassis model and the settings saved in this browser? Save your JSON first.")) return;
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith("susp.")) localStorage.removeItem(k);
    } catch (e) {
      /* storage blocked */
    }
    try {
      if (typeof chassis !== "undefined" && chassis.base && $("#fmRemove")) $("#fmRemove").click();
    } catch (e) {
      /* no chassis */
    }
    location.reload();
  });
  syncSettingsForm();
  applySettings({ rerun: false });
}
