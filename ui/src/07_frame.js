// ------------------------------------------------------------------ coordinates as shown (Settings → Coordinates)
// The solver works in its own frame: X forward, Y right (outboard on the right-hand corner), Z up from the ground,
// each corner's X from its own contact patch. What the app shows and takes can be another frame; dispPt / undispPt
// convert at the edge, so files and the solver keep the solver frame. space: "front" / "rear" (a corner's own
// coordinates) or "car" (the car frame: the front corner's X, the rear axle one wheelbase behind).
function dispPt(p, space = "car") {
  return p.slice();
}
function undispPt(p, space = "car") {
  return p.slice();
}
function frameAxisName(j) {
  return "XYZ"[j];
}
function frameNote(space = "car") {
  return "Coordinates: X forward (from the front axle), Y right, Z up from the ground, mm.";
}
