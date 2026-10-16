# Next to do

Ordered by importance: things that could mislead a student or block the team first, then accuracy of the model,
then extra features, then housekeeping. Team-specific design fixes live in `private/` (never published).

1. **Look over every drawing after the mirror fix (1.1.0).** The 3D view used to draw the car mirrored. All 17
   "Show me" drawings and both challenges still run without errors, but none has been checked by eye since: any
   caption that says left/right, or a label placed for the old view, may now be wrong. Same pass for the phone
   layout of the chassis panel, the misalignment table and the Car-view corner cards.
2. **Try the chassis tools on a real frame, on a normal laptop.** Tested with a box, a plate and a synthetic
   200,000-triangle tube frame (clearance check about 2 s). Rendering a model that size in the headless test
   browser is slow (software graphics); it needs a check on real hardware, with a real team frame.
3. **Switch GitHub Pages to the Actions build** (repo Settings -> Pages -> Source: GitHub Actions; needs the repo
   owner). Then stop committing the 2 MB built `ui/index.html` and drop the "is it up to date" CI step.
4. **Progressive springs and bump stops.** Ride frequency, the loads at full bump and the deflected load cases all
   assume a linear spring with no stop.
5. **Anti-roll bar linkage and tire load sensitivity.** The bar is a stiffness number, not a linkage with its own
   motion ratio; the tire's grip doesn't fall off with load, so the car balance is optimistic at the limit.
6. **Outside validation for loads, ride and the car balance.** Kinematics match KineSolver and hand calculations;
   the rest is checked only against physics identities. Add a rig measurement or another tool's results to
   `validation/` (see the cheap-validation list in the guide).
7. **Clearance to the chassis model: more parts.** Today: wishbone legs, tie rod, pushrod and damper. Add the
   tire and wheel (full lock and bump against the body), the upright and the rocker.
8. **Draw the brake caliper and the halfshaft** in the 3D view and include them in the CAD export (they are
   checked for clearance but not shown).
9. **Joint misalignment: limits per joint in the app** (only in the JSON today), and an option for ball joints
   aligned somewhere other than ride height.
10. **Loads: brackets and fatigue.** The pushrod-mount check is a bare tube (no gusset); no fatigue, weld or tab
    checks.
11. **Housekeeping.** Move CI to `ubuntu-26.04` once a manual run passes (Playwright 1.63 supports it; jobs are
    pinned to 24.04 meanwhile). Create the missing `v0.9.0` tag (needs a token that may push tags). Empty the
    `_to_delete/` folder on the desktop copy.

## Done recently

- Car view: each corner's checks, with buttons into the Front / Rear tabs (1.2.0)
- CI: actions off Node 20, jobs pinned to Ubuntu 24.04, Playwright 1.63 for Ubuntu 26.04 (1.2.0)
- Clearance from every link to the chassis model over travel and steer, both sides, both axles (1.2.0)
