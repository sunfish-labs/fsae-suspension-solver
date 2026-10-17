// ------------------------------------------------------------------ settings and the coordinates as shown
// SET: this browser's settings (Settings dialog), kept in localStorage. The solver works in its own frame: X forward,
// Y right (outboard on the right-hand corner), Z up from the ground, each corner's X from its own contact patch. What
// the app shows and takes can be another frame: dispPt / undispPt convert at the edge, so files, the solver and the
// exports keep the solver frame. space: "front" / "rear" (a corner's own coordinates) or "car" (the car frame: the
// front corner's X, the rear axle one wheelbase behind).
// The team frame (05_frame.js, frame.py): ISO 8855 with the origin under the front axle. Files are saved in it, and
// the screen shows it unless someone picks other axes here for themselves.
const SET_VERSION = 2;
const SET_DEFAULTS = {
  axes: "iso",
  origin: "car",
  advanced: false,
  tabs: { motion: true, spring: true, loads: true, pack: true, compare: true },
  quality: "high",
  tips: true,
};
const SET = (() => {
  let s = {};
  try {
    s = JSON.parse(store.get("susp.settings") || "{}") || {};
  } catch (e) {
    s = {};
  }
  // a first visit starts simple; someone who already has work saved here keeps every input in view
  if (s.advanced == null && store.get("susp.cfg")) s.advanced = true;
  // settings from before the team frame: move them onto it once (it is what the files now use)
  if (!(s.v >= SET_VERSION)) Object.assign(s, { axes: "iso", origin: "car", v: SET_VERSION });
  return Object.assign({}, SET_DEFAULTS, s, { tabs: Object.assign({}, SET_DEFAULTS.tabs, s.tabs || {}) });
})();
function saveSettings() {
  store.set("susp.settings", JSON.stringify(SET));
}
// axes as shown, from the solver's (x, y, z); the same choices as the CAD export
const FRAME_AXES = {
  solver: {
    label: "X forward, Y right, Z up (the solver's own)",
    f: ([x, y, z]) => [x, y, z],
    inv: ([a, b, c]) => [a, b, c],
    names: ["X fwd", "Y right", "Z up"],
  },
  iso: {
    label: "ISO 8855: X forward, Y left, Z up (the team frame: files use it; each corner shown as the left-hand one)",
    f: ([x, y, z]) => [x, -y, z],
    inv: ([a, b, c]) => [a, -b, c],
    names: ["X fwd", "Y left", "Z up"],
  },
  sw: {
    label: "X forward, Y up, Z right (SolidWorks default)",
    f: ([x, y, z]) => [x, z, y],
    inv: ([a, b, c]) => [a, c, b],
    names: ["X fwd", "Y up", "Z right"],
  },
  adams: {
    label: "X rearward, Y right, Z up (ADAMS)",
    f: ([x, y, z]) => [-x, y, z],
    inv: ([a, b, c]) => [-a, b, c],
    names: ["X rear", "Y right", "Z up"],
  },
};
const frameAxes = () => FRAME_AXES[SET.axes] || FRAME_AXES.solver;
// ISO 8855 shows each corner as the car's left-hand one, which is the solver's right-hand corner mirrored: Y keeps its
// sign for corner points; car-level points (layout, ground points, the car view) are where they really are
const axesFor = space => (SET.axes === "iso" && space !== "car" ? FRAME_AXES.solver : frameAxes());
// the shift from a space's stored X to the shown X (the car-frame origin is the front axle, on the ground). A corner
// from a team-frame file is already measured from the front axle (the rear one wheelbase on); an older one is moved
// by its contact patch, the same way it is saved (05_frame.js cornerOut)
function frameShift(space) {
  if (SET.origin !== "car") return 0;
  const front = car && !chal ? car.front : cfg,
    xf = front && front.hardpoints ? front.hardpoints.contact_patch[0] : 0;
  if (space === "rear") {
    const rear = car && !chal ? car.rear : cfg,
      wb = ((car && !chal ? car.vehicle : cfg && cfg.vehicle) || {}).wheelbase || 1550;
    if (rear && rear._frame === S.FRAME) return -wb;
    return -(rear && rear.hardpoints ? rear.hardpoints.contact_patch[0] : 0) - wb;
  }
  if (front && front._frame === S.FRAME) return 0;
  return -xf;
}
function dispPt(p, space = "car") {
  const s = frameShift(space);
  return axesFor(space).f([+p[0] + s, +p[1], +p[2]]);
}
function undispPt(p, space = "car") {
  const q = axesFor(space).inv(p.map(Number));
  return [q[0] - frameShift(space), q[1], q[2]];
}
const dispDir = (v, space = "corner") => axesFor(space).f(v.map(Number));
const undispDir = (v, space = "corner") => axesFor(space).inv(v.map(Number));
function frameAxisName(j) {
  return "XYZ"[j];
}
function frameNote(space = "car") {
  const a = frameAxes().label,
    o =
      SET.origin === "car"
        ? "origin on the ground under the front axle, on the centerline"
        : space === "car"
          ? "X from the front corner's own zero, Y = 0 on the centerline, Z = 0 on the ground"
          : "X from this corner's own zero, Y = 0 on the centerline, Z = 0 on the ground";
  return `Coordinates: ${a}; ${o}; mm (Settings → Coordinates).`;
}
function frameShort() {
  return frameAxes().names.join(", ");
}
// which form fields are points (shifted and turned) or directions (only turned): path "a.b.j" -> {base, j, kind}
const POINT_PATHS =
  /^(hardpoints\.\w+|spring\.(rod_outboard|rocker_pivot|rocker_rod|rocker_damper|damper_chassis)|arb\.(link_outboard|arm_tip|bar_pivot)|halfshaft\.(diff_output|cv_outboard))\.([012])$/;
const DIR_PATHS = /^(spring\.rocker_axis|arb\.bar_axis|rack_direction)\.([012])$/;
function framePath(path) {
  let m = POINT_PATHS.exec(path);
  if (m) return { base: m[1], j: +m[5], kind: "pt" };
  m = DIR_PATHS.exec(path);
  if (m) return { base: m[1], j: +m[2], kind: "dir" };
  return null;
}
const frameIsDefault = () => SET.axes === "solver" && SET.origin !== "car";
// the screen shows exactly what the saved files hold (the team frame)
const frameIsTeam = () => SET.axes === "iso" && SET.origin === "car";
