// ---------------------------------------------------------------- the team frame for files (mirrors susp/frame.py)
// Files carry "frame": "iso8855": ISO 8855 axes (X forward, Y left, Z up, mm), origin on the ground under the front
// axle, on the centerline. Each corner is the car's left-hand one, so it maps onto the solver's right-hand corner with
// Y unchanged; the rear corner's X moves by the wheelbase. Car-level points (layout, ground points, driver and hoops)
// keep X and change the sign of Y. No "frame" = the solver's own frame (older files), loaded unchanged.
const FRAME = "iso8855";
const FRAME_LABEL = "ISO 8855: X forward, Y left, Z up, mm; origin on the ground under the front axle, on the centerline";
const CORNER_POINTS = {
  hardpoints: null,
  spring: ["rod_outboard", "rocker_pivot", "rocker_rod", "rocker_damper", "damper_chassis"],
  arb: ["link_outboard", "arm_tip", "bar_pivot"],
  halfshaft: ["diff_output", "cv_outboard"],
};
function cornerPoints(cfg) {
  const out = [];
  for (const [blk, keys] of Object.entries(CORNER_POINTS)) {
    const b = cfg[blk];
    if (!b || typeof b !== "object" || Array.isArray(b)) continue;
    for (const k of keys || Object.keys(b)) if (Array.isArray(b[k]) && b[k].length === 3) out.push([blk, k]);
  }
  return out;
}
function checkFrame(f) {
  if (f != null && f !== FRAME)
    throw new SolveError(`frame must be "${FRAME}" (ISO 8855, origin under the front axle) or left out (the solver's own frame)`);
}
// a merged corner config from its file's frame into the solver's, in place
function cornerIn(cfg) {
  const f = cfg.frame;
  delete cfg.frame;
  checkFrame(f);
  if (f !== FRAME) return cfg;
  if (cfg.axle === "rear") {
    const wb = +cfg.vehicle.wheelbase;
    for (const [blk, k] of cornerPoints(cfg)) cfg[blk][k] = [+cfg[blk][k][0] + wb, cfg[blk][k][1], cfg[blk][k][2]];
  }
  cfg._frame = FRAME;
  return cfg;
}
// a corner (solver frame) as it goes into a file: a converted copy carrying "frame"
function cornerOut(cfg) {
  const out = JSON.parse(JSON.stringify(cfg)),
    wb = cfg.axle === "rear" ? +cfg.vehicle.wheelbase : 0,
    dx = cfg._frame === FRAME ? -wb : -+cfg.hardpoints.contact_patch[0] - wb;
  for (const [blk, k] of cornerPoints(out)) out[blk][k] = [Math.round((+out[blk][k][0] + dx) * 1e6) / 1e6, out[blk][k][1], out[blk][k][2]];
  delete out._frame;
  return Object.assign({ frame: FRAME }, out);
}
// every car-level point of a car file through fn([x, y, z]), in place
function carPoints(raw, fn) {
  const lay = raw.layout;
  if (lay && Array.isArray(lay.components))
    for (const c of lay.components) if (c && Array.isArray(c.at) && c.at.length === 3) c.at = fn(c.at);
  for (const g of raw.ground_points || []) if (g && Array.isArray(g.at) && g.at.length === 3) g.at = fn(g.at);
  const ck = raw.cockpit;
  if (ck && typeof ck === "object")
    for (const [k, v] of Object.entries(ck)) {
      if (Array.isArray(v) && v.length === 2) {
        const p = fn([v[0], 0, v[1]]);
        ck[k] = [p[0], p[2]];
      } else if ((k === "pedal_face_x" || k === "wheel_front_x") && typeof v === "number") ck[k] = fn([v, 0, 0])[0];
    }
}
const flipY = p => [+p[0], -+p[1] + 0, +p[2]];
// a car file's car-level points into the solver's car frame (a copy); its corners convert in cornerIn
function carIn(raw) {
  checkFrame(raw.frame);
  const out = JSON.parse(JSON.stringify(raw));
  if (raw.frame === FRAME) carPoints(out, flipY);
  return out;
}
// car-level points (solver car frame) into the team frame, in place; fromTeam: they came from a team-frame file
function carOut(raw, frontCfg, fromTeam) {
  const dx = fromTeam ? 0 : -+frontCfg.hardpoints.contact_patch[0];
  carPoints(raw, p => [Math.round((+p[0] + dx) * 1e6) / 1e6, -+p[1] + 0, +p[2]]);
  return raw;
}
