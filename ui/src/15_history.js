// ------------------------------------------------------------------ history: undo / redo for every change
// A snapshot is taken just before each change: typing in any field (a burst of keystrokes in one box counts as one
// step), target ranges, car settings, applied moves, opening a design or example. Undo / Redo buttons in the header,
// Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z (or Ctrl+Y) when the cursor is not in a text box.
const hist = { undo: [], redo: [], last: 0, lastEl: null, restoring: false };
function snapshot() {
  return chal
    ? { kind: "cfg", cfg: JSON.stringify(cfg) }
    : {
        kind: "car",
        view: axleView,
        car: JSON.stringify({
          name: car.name,
          vehicle: car.vehicle,
          arb: car.arb,
          car_targets: car.car_targets,
          layout: car.layout,
          drivetrain: car.drivetrain,
          cockpit: car.cockpit,
          ground_points: car.ground_points,
          brake_system: car.brake_system,
          src: car.src,
          front: car.front,
          rear: car.rear,
        }),
      };
}
function pushHistory(el) {
  if (hist.restoring || !cfg || (!chal && !car)) return;
  const now = Date.now();
  if (el && el === hist.lastEl && now - hist.last < 1500) {
    hist.last = now;
    return;
  } // same box, same burst
  hist.undo.push(snapshot());
  if (hist.undo.length > 100) hist.undo.shift();
  hist.redo.length = 0;
  hist.last = now;
  hist.lastEl = el || null;
  syncUndoButtons();
}
function resetHistory() {
  hist.undo.length = 0;
  hist.redo.length = 0;
  hist.lastEl = null;
  syncUndoButtons();
}
function restoreSnapshot(s) {
  hist.restoring = true;
  try {
    if (s.kind === "cfg") cfg = JSON.parse(s.cfg);
    else {
      const raw = JSON.parse(s.car);
      car = carFrom(raw);
      if (raw.src) car.src = raw.src;
      axleView = s.view;
      cfg = car[axleView === "rear" ? "rear" : "front"];
      applyViewClasses();
    }
    preview = null;
    $("#pvbar").hidden = true;
    savedSpring = null;
    savedRocker = null;
    $("#preset").value = "custom";
    fillForm();
    run();
    if (drawerPath) openInfluence(drawerPath);
  } finally {
    hist.restoring = false;
  }
}
function undo() {
  if (!hist.undo.length) return;
  hist.redo.push(snapshot());
  restoreSnapshot(hist.undo.pop());
  hist.lastEl = null;
  syncUndoButtons();
  flash("Undone");
}
function redo() {
  if (!hist.redo.length) return;
  hist.undo.push(snapshot());
  restoreSnapshot(hist.redo.pop());
  hist.lastEl = null;
  syncUndoButtons();
  flash("Redone");
}
function syncUndoButtons() {
  const u = $("#btnUndo"),
    r = $("#btnRedo");
  if (u) u.hidden = !hist.undo.length;
  if (r) r.hidden = !hist.redo.length;
}
// record before any model-bound field changes (capture phase runs before the field's own handler)
function recordEdit(e) {
  const t = e.target;
  if (!t || !t.dataset || hist.restoring) return;
  const d = t.dataset;
  if (
    d.path ||
    d.cpath ||
    d.ctg ||
    d.tkey ||
    d.chpath ||
    d.ren !== undefined ||
    d.lay !== undefined ||
    d.ck !== undefined ||
    d.gp !== undefined ||
    d.br !== undefined ||
    t.id === "springOn" ||
    t.id === "rockerOn"
  )
    pushHistory(t);
}
document.addEventListener("input", recordEdit, true);
document.addEventListener("change", recordEdit, true);
document.addEventListener("keydown", e => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
  const a = document.activeElement,
    tag = a ? a.tagName : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (a && a.isContentEditable)) return; // let the box handle its own undo
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if ((k === "z" && e.shiftKey) || k === "y") {
    e.preventDefault();
    redo();
  }
});
