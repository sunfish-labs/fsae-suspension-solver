# Next to do

The goal for this season: the team designs the car in SolidWorks, and this tool verifies it (suspension geometry,
clearances, part strength, rules) so the suspension passes, while teaching the newer members a little along the way.
Designing from scratch in the tool is for future seasons. Team-specific design fixes live in `private/` (never
published).

Effort is working time including tests, docs and shipping: XS under 1 h, S 1-3 h, M half a day, L 1-2 days,
XL 3+ days.

## This season: needed for a passing car

1. ~~**Guardrails**~~ (done in 1.12.0). A clear message when a design can't be solved, including the pushrod-on-upright path; the
   browser's singular-matrix test as strict as Python's; sweep step counts validated; a warning when the wishbones
   are nearly parallel (the roll center jumps around); a note when a bump case is skipped because the wheel can't
   reach that travel; a note that the combined design loads ask for more grip than the tire has, on purpose; the
   small accessibility fixes (accent contrast, live status and error regions, a mark on failing cells besides color).
2. ~~**SolidWorks to solver in one step**~~ (done in 1.13.0; try the macro on the real model). Paste or upload a points table in the browser (today: command line
   only), pick the SolidWorks axes, with sanity checks (swapped points, contact patch off the ground, wrong axle) and a
   one-page how-to for exporting the hardpoints from SolidWorks. Needs: one real export from the team's model.
3. ~~**Whole-car check page and report**~~ (done in 1.14.0). Every check on the car on one page: geometry targets, clearances (links,
   rim, caliper, frame STL, layout parts), part strength, rules, roll balance; each pass / fail / needs input / check
   yourself, with one line on why it matters and a link to the glossary. Prints as a sign-off report for design
   reviews and the design event.
4. ~~**Bought-part ratings**~~ (done in 1.20.0). Ball joints, damper eyes, the rocker pivot bearing and spherical bearings against
   their catalog ratings, like the rod ends. Needs: part numbers or ratings.
5. ~~**Ground clearance rule**~~ (done in 1.15.0). No solid part but the tires touches the ground at full bump with braking pitch and
   roll.
6. ~~**Frame-based rules**~~ (done in 1.16.0: side impact structure, hoop angles, braces, belt angles; the rules have no 5th percentile template to check). Lower side impact structure height and the 5th percentile template, from side-view
   points like the roll hoops. Needs: those points off the frame.
7. ~~**Anti-roll bar in the cornering loads**~~ (done in 1.17.0; the link pulling on an arm or upright is still left to FEA). The bar's share in the cornering cases, so the tube and tab checks
   aren't optimistic with a bar (the simpler version of the full rolled cases below).
8. ~~**Frame stiffness input**~~ (done in 1.18.0). The frame's torsional stiffness as one number: is it stiff enough for the
   suspension's roll stiffness, and what it does to the LLTD. Needs: an estimate from SolidWorks Simulation or a rule
   of thumb.

## This season, if there's time

9. **Jig and tolerance report** (M). Which hardpoints need precise fixturing for the team's fabrication tolerance.
10. **Competition setup sheet** (M). Alignment, ride height, spring preload and bar setting per corner, printable.
11. **"Start here" tour** (S). Five minutes on reading the check page and what each area means.
12. **Housekeeping** (XS, done by hand). Create the missing `v0.9.0` tag on GitHub (Releases -> Draft a new release ->
    tag `v0.9.0`, target commit `e3fee2a`); delete the old desktop copy (the GitHub Desktop clone replaces it).

## Future seasons

- **Guided design workflow** (L): the steps in design order with live status and a "go there" button, for a team
  designing in the tool from the start.
- **Rolled and combined load cases** (L-XL): the cornering cases solved with the body rolled and the wheel moved, the
  bar's link load and aero.
- **Frame torsional stiffness from the tube centerlines** (XL): a 3D frame solved in the browser, feeding the LLTD.
- **Tire model with camber** (M-L): grip that depends on camber, not Pacejka. Needs tire data (TTC).
- **Bill of materials** (M): rod ends, bolts, tube cut lengths, tabs.
- **Rocker, the next step** (M): an aluminum fatigue screen and the bar link's load when it's driven from the rocker.
- **Keyboard and screen-reader control of the 3D view** (M); **phone layout** (S).
- **Team sharing of private design files** (L): Google Drive sign-in, if passing JSON files around gets painful.
- **More rules checks** as data arrives: cockpit openings, the 2027 Q&A.
- **Fatigue from logged loads** (needs a car, see below).

## When there is a car (or a test corner)

- **Measure it (validation/MEASURING.md).** Every model is cross-checked by an independent one; what is left is
  reality. The bump sweep and the twist test on corner scales are the cheapest and check the most. A single corner
  built from plywood or 3D-printed parts on a bench works for the bump sweep and the motion ratio.
- **Wheel rate with or without the preload term:** a bench wheel-rate test settles whether `wheel_rate` or
  `wheel_rate_preload` matches.
- **Fatigue from logged loads:** once the car logs damper or strain data, count the cycles (rainflow) and add up the
  damage (Miner) instead of the stated-cycle screen.

## Done recently

- Frame stiffness in the car balance: LLTD with a twisting frame, stiffness ratio, bar effect (1.18.0)
- Anti-roll bar in the cornering loads: its share, drop link, twist, and the rocker with it (1.17.0)
- Frame and harness rules from side-view points: 13 more automatic checks (1.16.0)
- Ground clearance rule over every body position the dampers allow, from the lowest points and the frame model (1.15.0)
- Design check: every check on the car on one page with why it matters and where to fix it, and a printable
  sign-off report (1.14.0)
- Points from CAD: a SolidWorks point table into the open design, with name matching, axes and units guessed,
  checks before applying, and a SolidWorks macro that writes the table (1.13.0)
- Guardrails: singular link layouts refused on both statics paths, sweep steps checked, near-parallel arms
  warned, skipped bump cases and over-grip design loads noted, accessibility fixes (1.12.0)
- Rocker strength: pin holes (bearing, tear-out) and arm bending from the plates' sizes and alloy (1.11.0)
- Driver template and roll hoops in side view: seven more rules checks (F.5.6 to F.5.9) and a drawing (1.10.0)
- Rules check against the Formula SAE Rules 2027 (IC) by rule number: twelve automatic checks and a checklist (1.9.0)
- Vehicle layout (mass, CG, inertia from a parts list, boxes in 3D, clearance to the parts) and the drivetrain's
  acceleration run; a Settings panel with the coordinates as shown, simple / detailed inputs and result tabs (1.8.0)
- Pushrod mount reinforcement: a gusset plate along the leg (built-up section searched along the leg, plus the
  weld where it ends in the fatigue screen) or a bracket into the ball-joint node; part loads for FEA (every force
  on the upright, wishbones and rocker, per case, in the CAD axes) from the app and the command line (1.7.0)
- Pickup tabs (bearing, tear-out, net section, weld throat) and a fatigue screen at stated cycle counts (tubes by
  Goodman on the S-N line, welds by IIW class); the wheel rate with the preload term reported beside the usual one;
  CI on Ubuntu 26.04 (1.6.0)
- Clearance to the chassis model for the tire (exact for the drawn shape), the upright and rocker as drawn, the
  caliper envelope and the halfshaft; caliper and halfshaft drawn in 3D and in the CAD export; each joint's own
  misalignment limit and the ball joints' alignment travel set in the Packaging tab (1.5.0)
- GitHub Pages builds and publishes the site from Actions on every push; the built `ui/index.html` is no longer
  committed (`python3 susp_solver.py ui` builds it)
- Independent models for loads (displacement method, five corner layouts) and the car balance (full-car matrix
  model); the car balance now includes the tires squashing under the geometric load transfer (about 10 % more roll
  on the example cars); measurement guide and rig-to-reference script (1.4.0)
- Drawings checked by eye after the mirror fix (1.3.1); chassis tools on a real laptop: a 410k-triangle frame loads in
  0.2 s, 60 fps, clearance check 1.5 s (1.3.1)
- Dual-rate springs and bump stops; anti-roll bar linkage geometry; tire load sensitivity and the limit balance (1.3.0)
