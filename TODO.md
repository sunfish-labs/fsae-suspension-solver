# Next to do

Ordered by importance: things that could mislead a student or block the team first, then accuracy of the model,
then extra features, then housekeeping. Team-specific design fixes live in `private/` (never published).

1. **Measure the car (validation/MEASURING.md).** Every model is now cross-checked by an independent one; what
   is left is reality. The bump sweep and the twist test on corner scales are the cheapest and check the most
   (kinematics, motion ratio, springs and bars). Put the results in `private/validation/`.
2. **Clearance to the chassis model: more parts.** Today: wishbone legs, tie rod, pushrod and damper. Add the
   tire and wheel (full lock and bump against the body), the upright and the rocker.
3. **Draw the brake caliper and the halfshaft** in the 3D view and include them in the CAD export (they are
   checked for clearance but not shown).
4. **Joint misalignment: limits per joint in the app** (only in the JSON today), and an option for ball joints
   aligned somewhere other than ride height.
5. **Loads: brackets and fatigue.** The pushrod-mount check is a bare tube (no gusset); no fatigue, weld or tab
   checks.
6. **Wheel rate: include the preload term?** Spring preload x the motion ratio's change adds 1.4-1.7 % to the
   wheel rate on the examples (more with a strongly rising rocker). Left out, as in most hand calculations; decide
   once a bench measurement (test 3) shows whether it matters for your car.
7. **Housekeeping.** CI can move to `ubuntu-26.04` whenever you like: a manual run there passed on 1.2.0 (jobs
   stay pinned to 24.04 until then). Create the missing `v0.9.0` tag (needs a token that may push tags). Empty the
   `_to_delete/` folder on the desktop copy.

## Done recently

- GitHub Pages builds and publishes the site from Actions on every push; the built `ui/index.html` is no longer
  committed (`python3 susp_solver.py ui` builds it)
- Independent models for loads (displacement method, five corner layouts) and the car balance (full-car matrix
  model); the car balance now includes the tires squashing under the geometric load transfer (about 10 % more roll
  on the example cars); measurement guide and rig-to-reference script (1.4.0)
- Drawings checked by eye after the mirror fix: anti-dive/squat drawing reframed so its lines clear the caption, a
  stray letter removed from the challenge header, the chassis gap field no longer wraps on phones (1.3.1)
- Chassis tools on a real laptop (Apple M2, Chrome): synthetic tube frames of 14k / 113k / 410k triangles load in
  0.03 / 0.06 / 0.2 s, the view stays at 60 fps, hover 2 / 5 / 13 ms, clearance check 0.2 / 0.5 / 1.5 s (1.3.1)
- Dual-rate springs and bump stops; anti-roll bar linkage geometry; tire load sensitivity and the limit balance (1.3.0)
- Car view: each corner's checks, with buttons into the Front / Rear tabs (1.2.0)
- CI: actions off Node 20, jobs pinned to Ubuntu 24.04, Playwright 1.63 for Ubuntu 26.04 (1.2.0)
- Clearance from every link to the chassis model over travel and steer, both sides, both axles (1.2.0)
