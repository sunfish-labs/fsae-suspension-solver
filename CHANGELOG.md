# Changelog

Versions follow [semantic versioning](https://semver.org/). Each release is a git tag (`v1.0.0`); the version is
also in `pyproject.toml`.

## 1.28.0 - 2026-10-17

- **Team settings** (⚙ Settings → Team), set by the team's admin and stored encrypted in the repo
  (`team/settings.enc`, AES-GCM with a key from the team passphrase), so only the team can read them:
  - **Learning mode:** the one-click Apply buttons are hidden for the team; hints, "What moves this?", the influence
    drawer and Preview stay, and challenges are unchanged. The admin keeps everything.
  - **Released designs:** the official design opens read-only with *Make a copy to experiment*; any other design is
    an experiment, and its exports are stamped "EXPERIMENT — not released".
  - An optional banner for the team.
  Without the passphrase (or without a settings file) the app is exactly as before. A guardrail, not security.

## 1.27.0 - 2026-10-17

- **SolidWorks equations export** (Export menu, and `equations car.json`): every hardpoint and spring point as a
  global variable in the team frame, plus the pushrod, tie rod and damper lengths, tracks and wheelbase, for Tools →
  Equations → Link to external file. Python and browser give the same text (parity-tested).

## 1.26.0 - 2026-10-17

- **One team frame for files, the screen and the exports: ISO 8855** (X forward, Y left, Z up, mm) with the origin on
  the ground under the front axle, on the centerline. Files say so with `"frame": "iso8855"`; corners are given as the
  left-hand one (Y positive), the rear about a wheelbase behind, and car-level points (layout, ground points, driver
  and hoops) where they physically are. The app saves in it and shows it by default, so the screen, the JSON and a
  SolidWorks model built around a matching coordinate system show the same numbers; the note that files used other
  numbers is gone. The solver keeps its internal frame and converts only on reading and writing (Python
  `susp/frame.py`, browser `05_frame.js`), so no result changes (checked on full cars: metrics, loads, rules, ground
  clearance). Older files still open; `to-team` rewrites one. The examples, case study and templates are converted.
  The 3D-for-CAD and FEA exports default to it.
- Saving a car or corner from the app now keeps the bar linkage, halfshaft and joint settings, which were dropped.
- The CLI's `import` writes the team frame; the design report labels its hardpoint table with the frame.

## 1.25.0 - 2026-10-17

- **Competition setup sheet** (Export menu, and `setup car.json`): what to set each corner to (camber, toe, corner
  weight, spring, damper eye to eye, pushrod and tie rod lengths at ride height), what one adjustment does (camber per
  mm of shim, toe and ride height per turn of a left/right-hand rod), the car's lowest point and bar settings, and
  boxes to fill in at the track. Python and browser (parity-tested), hand-checked.

## 1.24.0 - 2026-10-17

- **Jig and tolerance sheet** (Export menu, and `tolerance design.json`): how far each pickup may be off, per axis,
  before a target is lost, from ±1 mm moves of every coordinate and a root-sum-of-squares share of each target's
  room; which points need a precise jig, a jig or ordinary care, the metric that limits each, the likely and
  worst-case miss per target, and the allowances if bump steer is shimmed after the build. Python and browser
  (parity-tested), hand-checked.

## 1.23.0 - 2026-10-17

- **Final drive sweep** (Car view → Layout → Drivetrain, and `layout`): the acceleration run for finals from 75 to
  125 % of yours, with the speed at the line and top speed for each, and the quickest final that still reaches the
  endurance course's design top speed (105 km/h by default, D.12.2.2; `drivetrain.top_speed_need`). Python and
  browser (parity-tested).

## 1.22.0 - 2026-10-17

- **Brake sizing** (`brake_system` in the car file; Car view → Layout → Brakes): whether the driver can lock all
  four wheels (T.3.1.2 c, the Brake Test IN.14) with the pedal force you design for, which axle locks first, the
  balance bar setting that locks both together and whether the bar reaches it, the line pressures, the front brake
  force share the hardware gives, and the pressure with 2000 N on the pedal (T.3.2.2). Four new rule checks, in the
  rules page and the design check. Python and browser (parity-tested), hand-checked. The example car with bars has a
  brake system.
- Undo now keeps the brake system (it covers every Car view block).

## 1.21.1 - 2026-10-17

- Challenge mode: the influence panel (clicking a joint) stays off for the whole challenge, so the challenge's three
  hints are the only help. Hint 3 now only suggests a step (with its own Preview); it used to also open the panel.

## 1.21.0 - 2026-10-17

- **Three new challenges** (five in all), each practicing something the first two don't: **Set the steering axis**
  (move the ball joints until KPI, scrub, caster and trail are in range), **Stop the nose dive** (tilt the pivot axes
  in side view for anti-dive without moving the roll center) and **Fit the cheap spring** (move the rocker's pin
  holes for the ride frequency and damper stroke with a spring you can't change). Each has its own goal curves,
  hints and solver-checked par, and each is solved from its hints in the browser tests.
- **Challenge mode keeps the helpers off**: no "What moves this?" (Targets or Learn), no design check, and the
  influence panel stays locked until hint 3. Hint 3 (a solver-suggested step) now limits the score to 2 stars, and
  Start over clears the hints so the third star is back on offer.
- Fixes hint 3 repeating a stale suggestion when the moved points are the rocker's.

## 1.20.0 - 2026-10-17

- **Bought bearings against their ratings**: `members.ball_joint_rating`, `damper_eye_rating` and
  `rocker_bearing_rating` (N, catalog radial static) check each ball joint (the force its wishbone passes to the
  upright), the damper eyes (the damper's force) and the rocker's pivot (the resultant on its bearings, with the bar
  link when it's on the rocker) over every load case, like the rod ends. In the Loads tab, `loads`, the report, the
  CSV export and the design check (which used to leave them as a manual item). Ratings must be positive. Python and
  browser (parity-tested), hand-checked.

## 1.19.0 - 2026-10-17

- **Frame-only cockpit**: the `cockpit` block's seat hip point and back angle are optional together, so a frame
  drawn before the seat is placed can be checked against the hoop, brace and side impact rules (F.5.7.6 to F.6.4.4,
  V.1.4.2). The template, helmet and belt-angle rules show as missing inputs until the seat is in. Giving only one of
  the two is an error. Python and browser.

## 1.18.0 - 2026-10-17

- **Frame stiffness** (`vehicle.frame_k`, Car view → Frame stiffness): the car balance with a frame that twists
  between the axles: LLTD rigid vs with this frame, the frame's twist per g, its stiffness against the suspension's
  roll stiffness (3x or more is the usual aim, in the design check) and the share of a bar change that still reaches
  the balance. Python and browser, hand-checked. The example layout car has 3,000 Nm/deg.
- Fixes an unused import in the tests that failed the 1.17.0 lint step.

## 1.17.0 - 2026-10-17

- **Anti-roll bar in the cornering loads**: with a bar linkage, the cornering cases split the roll between the spring
  and the bar by their wheel rates and report the drop link's force (with its tube and rod-end FOS) and the bar's
  torsional stress per case. A bar on the rocker also changes the damper and pivot forces, adds its pin to the rocker
  plate check and appears in the part loads for FEA. In the Loads tab, `loads` and the design check (a bar given only
  as a number asks for its linkage). Python and browser (parity-tested), hand-checked by virtual work.

## 1.16.0 - 2026-10-17

- **Frame and harness rules from side-view points** (optional `cockpit` keys, Layout → Driver and roll hoops): the
  lower side impact member's height (V.1.4.2), the upper side impact member's zone (F.6.4.4 b), the Front Hoop's and
  Main Hoop's angles (F.5.7.6, F.6.3.5, F.5.8.3), the braces' side and angle (F.5.9.3, F.5.9.5), the lap and
  shoulder belt angles and spacing (T.2.5.4, T.2.5.5, T.2.6.1, T.2.6.2): 13 more automatic checks, drawn in the side
  view. The rules engine gains a "between" check and values that carry a note or hand a measured value to a person.
  Python and browser, hand-checked. The example car passes all of them.

## 1.15.0 - 2026-10-17

- **Ground clearance rule** (V.1.4.1 / V.1.4.3, now automatic): the car's lowest points (car file `ground_points`, Car
  view → Layout → Lowest points, and every vertex of a loaded frame model) at every body position the dampers allow,
  the body rigid with each corner between full droop and full bump plus tire squash, pitch and roll included (the
  extreme positions of that linear program). Names the tightest point and the body position. Python and browser,
  hand-checked. The example car has typical points (26.5 mm at the lower side impact tube).

## 1.14.0 - 2026-10-17

- **Design check** (✓ Check in the top bar): every check on the car on one page, grouped (setup, geometry,
  packaging, strength, car balance, rules, check yourself), each pass / fail / needs input / not run yet / check
  yourself, with what was found, one line on why it matters, a button to where it's fixed and a link to the term in
  Learn. It flags results that rest on defaults (the 1/8 in tabs) or missing inputs (rod-end rating, caliper,
  halfshaft, rocker plates), runs the frame and parts clearance check from the page, and saves a **sign-off report**
  (every check, passes included, the app version and lines to sign) to print to PDF for design reviews.

## 1.13.0 - 2026-10-17

- **Points from CAD** (Open ▾ → Points from CAD (SolidWorks)…): paste or open a point table and update the open
  design's hardpoints and spring points, one corner or both corners of a car. Names are matched in words (FR upper
  ball joint, LCA front, toe link inner, rocker damper…) and can be reassigned in a table; units (mm, m, inches) and
  the CAD's axes are guessed from the points (up from the ball joints, outboard from the pivots, forward from the
  front wheels or front/rear-named pivots); left-hand points are mirrored; the contact patch goes on the ground at
  X = 0 (or the wheel center less the tire radius); the rocker axis comes from a second point on it. The checks on the
  result, its roll center, camber gain, caster, KPI and track, and the CAD's wheelbase show before you apply, and a
  reversed forward axis is caught. Undo takes it back.
- A SolidWorks macro, `tools/solidworks/ExportHardpoints.bas` (also downloadable from the dialog), writes every
  reference point of the open part or assembly to that table, in mm, from a chosen coordinate system.

## 1.12.0 - 2026-10-17

- **Guardrails.** A link layout that can't hold the wheel (two links on one line) is refused with a plain message on
  both statics paths, the pushrod on an arm and on the upright, instead of giving huge forces; the browser now uses
  the same singularity test as Python (1-norm condition number). Sweep step counts are checked (heave 5 or more, roll
  and rack 3 or more, whole numbers). A warning when the wishbones are almost parallel in the front view (the roll
  center swings with tiny changes). The Loads tab and `loads` say when a bump case couldn't be solved where the wheel
  would be, and that the combined design loads ask for more grip than the tire has, on purpose.
- Accessibility: darker accent for small text on paper, the status bar and error box announced to screen readers,
  a "!" on influence cells that break a target (not color alone).
- `TODO.md` rewritten for this season: verifying a SolidWorks-designed car, with future seasons listed separately.

## 1.11.0 - 2026-10-16

- **Rocker strength** (`members.rocker`, inputs → Loads & materials → Rocker plates, Loads tab, `loads`): plate
  thickness and count, pivot bore and hub size, pin holes and their edge distance, arm depth and alloy give each
  hole's bearing and tear-out and each arm's bending at the hub, worst case of every load case at its own geometry,
  with the lowest FOS in the summary bar and the report. Flags pin forces that run along the rocker's axis. The
  examples now describe a pair of 1/4 in 6061-T6 plates. Python and browser, hand-checked.

## 1.10.0 - 2026-10-16

- **Driver template and roll hoops** (car file `cockpit`, Car view → Layout → Driver and roll hoops, and the rules
  check): ten side-view numbers off the frame CAD place the 95th percentile template and check F.5.6.4 a/b/c (helmet
  50 mm under the hoop and brace lines), F.5.6.6 (915 mm hip to pedals), F.5.7.4 and F.5.7.5 (Front Hoop over and
  near the steering wheel) and F.5.9.4 (brace attachment within 160 mm of the top). Drawn in side view with each
  clearance; the example car passes all of them. Python and browser, hand-checked.

## 1.9.0 - 2026-10-16

- **Rules check against the Formula SAE Rules 2027 (V1.0), IC** (Car view → Rules, `rules car.json`): by rule number,
  with short paraphrases, pass / fail / can't check / check yourself. Automatic: wheelbase (V.1.2), track ratio
  (V.1.3.2), the 60° tilt test estimated from the CG and body lean (V.1.3.1, IN.11.2.2), usable wheel travel from
  the damper (V.3.1.1), wheel diameter (V.4.1), critical-fastener grade (V.3.1.4, T.8.2.1), rod-end shear (V.3.1.5),
  steering lock-up and rim clearance (V.3.2.4), tire keep-out zones against the layout (V.1.1 c); plus a checklist
  of nine rules it can't measure. Python and browser, hand-checked.

## 1.8.0 - 2026-10-16

- **Vehicle layout** (car file `layout`, Car view → Layout, `layout car.json`): parts with mass, position and size give
  the car's mass, CG, front and left weight shares and roll / pitch / yaw inertia; `layout.apply` makes the whole
  solver use them. Solid parts are drawn as boxes in 3D and join the clearance check (links, tires, upright, rocker
  against each part, named), with no chassis model needed.
- **Drivetrain** (car file `drivetrain`): torque curve and ratios give gear speeds, shift points and the 75 m
  acceleration time, grip-limited at the launch with load transfer onto the rear tires. Hand-checked.
- New example: `designs/example_car_layout.json`, a typical first-year single-cylinder car (invented numbers).
- **Settings** (⚙ in the top bar): theme (moved from the top bar); coordinates as shown (axes and origin, matching
  your CAD); detailed inputs on or off (new visitors start with the essentials); which result tabs show; 3D quality;
  hover readouts; reset and clear what the browser saved.

## 1.7.0 - 2026-10-16

- **Pushrod mount reinforcement** (`members.gusset`, inputs → Loads & materials → Pushrod mount on the wishbone): a
  triangular gusset plate along the leg (thickness, height at the mount, length toward the pivot and the ball joint)
  checked as the tube plus the plate along the whole leg, with the weld where the gusset ends added to the fatigue
  screen (IIW longitudinal attachment class by length); or a bracket into the ball-joint node (no leg bending; the
  bracket goes to FEA).
- **Part loads for FEA** (Export ▾ → Part loads for FEA…, `loads design.json --fea loads.csv`): every force on the
  upright, each wishbone and the rocker, per load case, at its point, in the CAD export's axes, origin and units.
  Each part's forces and moments balance (tested).
- TODO: what needs a car is grouped on its own.

## 1.6.0 - 2026-10-16

- **Pickup tabs:** a pair per link end (sizes in `members.tab`), checked for bearing, tear-out, net section and the
  weld throat against each end's worst force.
- **Fatigue screen:** each driving case repeated `loads.fatigue_cycles` times (default 100,000) and the bump
  `loads.fatigue_bump_cycles` times (10,000), from the car at rest, plus the swings between opposite cases (left and
  right turns, braking and accelerating). Tubes by modified Goodman on the Shigley S-N line,
  the welds at the tube ends and tab throats by their IIW fatigue class, the leg carrying the pushrod mount with its
  bending; margin and cycles to a crack per part. In the Loads tab, the command line, both reports and Excel.
- **Wheel rate with the preload term** (`wheel_rate_preload`), reported beside the usual spring rate x MR²: what a
  bench test reads.
- CI runs on Ubuntu 26.04.

## 1.5.0 - 2026-10-16

- **Clearance to the chassis model:** the tire (the solid drawn in the view, checked exactly: it is convex, so the
  closest point to each nearby triangle is found by alternating projections), the upright and rocker as drawn, the
  brake caliper envelope and the rear halfshaft, over the whole travel and steering range, both sides.
- **Caliper and halfshaft drawn** in the 3D view and included in the CAD export (points, lines and solid bodies).
- **Joint misalignment:** each joint's own limit, and the travel at which a ball joint is square
  (`joints.<key>.align`, mm), set in the Packaging table.
- **GitHub Pages** builds and publishes the site from Actions; `ui/index.html` is no longer committed.

## 1.4.0 - 2026-10-16

- **Car balance:** the roll gradient now includes the tires squashing under the whole lateral load transfer,
  including the part that goes through the roll centers and the unsprung mass (it counted the tires only for the
  part the springs carry). About 10 % more roll on the example cars and a 0.7 % point change in LLTD; the
  anti-roll bar sizing and the balance-only fix use the same model. New outputs: roll on the springs, front and
  rear (what damper pots measure), and the twist-test stiffness on corner scales.
- **Validation:** a displacement-method stiffness model of the corner (member forces in every load case on five
  corner layouts) and a full-car springs-and-masses model (roll gradient, LLTD, load transfer, twist stiffness), both
  independent of the solver code they check, both agreeing to about 1e-9. `validation/MEASURING.md`: five shop-tool
  tests, and `validation/tools/rig_to_reference.py` to turn the readings into reference cases.

## 1.3.1 - 2026-10-16

- Every "Show me" drawing, both challenges and the phone layouts checked after the mirror fix. Fixed: the
  anti-dive / anti-squat drawing framing, a stray letter in the challenge header, the chassis gap field wrapping.
- Chassis tools measured on a laptop (Apple M2): a 410,000-triangle frame loads in 0.2 s, renders at 60 fps and
  checks clearance in 1.5 s.

## 1.3.0 - 2026-10-16

- **Springs as fitted:** dual-rate springs (`spring_rate2` from `spring_breakpoint`) and progressive bump stops
  (`bumpstop_gap`, `bumpstop_k`, `bumpstop_k2`). Wheel rate over the travel (chart), travel to the bump stop, wheel
  rate at full bump; the aero sag and the deflected bump / pothole cases integrate the rate curve.
- **Anti-roll bar linkage:** a drop link on the lower or upper wishbone, the upright or the rocker drives the bar's
  arm; the bar's own motion ratio, its rate at the wheels, the axle's roll stiffness (used by the car balance in
  place of the typed number) and its shear stress and FOS (a target).
- **Tire load sensitivity:** each axle's lateral limit, the grip lost to load transfer, which end lets go first and
  the front LLTD that makes both let go together.
- New example: `designs/example_car_bars.json`. Hand-calculation checks for all three (73 in total) and parity tests.

## 1.2.0 - 2026-10-16

- **Clearance to the chassis model:** the closest each link comes to the loaded frame over travel and steer, both
  sides, both axles; click a row to see the pose and the two closest points.
- **Car view:** each corner's checks (failing targets listed) with buttons into the Front / Rear tabs, which the
  Car view hides.
- **CI:** GitHub Actions moved off Node 20; jobs pinned to Ubuntu 24.04 ahead of the Ubuntu 26.04 switch; Playwright
  1.63 (supports 26.04); a manual run can pick the machine image.
- `TODO.md`: what is next, by importance.

## 1.1.0 - 2026-10-16

- **Rod-end and bearing misalignment:** every rod end, ball joint, pushrod end and damper eye over the whole travel
  and rack range, against its catalog limit, with the best bolt direction for each rod end. A target, a Packaging
  table with a bolt choice per joint, its own section of the design report, a separate sheet (Export menu), an Excel
  sheet and the command line.
- **3D view:** an XYZ axis triad, hover coordinates, and the right-hand corner drawn on the car's right (the view was
  mirrored before; numbers and exports were not affected).
- **Chassis model:** load an STL or OBJ frame, move and rotate it to line up, kept in the browser.
- **CAD export:** STEP with solid bodies (named parts) for Onshape and Fusion.

## 1.0.0 - 2026-10-15

Everything in the improvement plan, in order.

**Checks on every push.** Ruff and ESLint, a check that the built page is up to date, pinned Python dependencies,
200 randomized designs solved by both the Python and the browser solver and compared, and the CAD export read back
in a CAD kernel. The browser tests wait for the app to finish instead of sleeping, and npm packages are cached.

**Correctness.** The spring force at ride height uses the sprung mass. Misspelled target keys are reported with the
nearest match. Saved designs and car files keep only the targets you set, not the team file's. Every name and key
from a design file is escaped before it is shown. Errors are typed (`ConfigError`, `SolveError`, ...).

**Loads.** The pushrod arm is solved as a rigid body, with a corrected pushrod-mount bending check. Braking force
is split by brake bias (or by equal grip use), the car's lateral load transfer split is used, and the bump and
pothole cases are also solved at the spring's deflected position. The browser does the same.

**One schema, split code.** Defaults, metrics, targets, points and moves live in `schema/*.json`, read by both
solvers. The Python package is split into `validate`, `car`, `loads/`, `tools/` and `output/` (Jinja report);
the browser code into `ui/solver/` and `ui/src/` panels. The page is built from these and works offline: three.js,
SheetJS and the fonts are included. A Pages workflow can build and publish it.

**Advice.** Quick evaluations use 9 heave points; the best suggestions are re-checked with a full evaluation;
the web app and the command line share one candidate list, including paired moves.

**Engineering.**
- Packaging over 9 heights × 7 rack positions; the rim barrel's inner radius; a brake caliper envelope.
- Rear halfshaft: plunge, CV angles and clearance to the links.
- Steering compliance: rack and column stiffness in series with the front tie rod.
- Aero downforce: ride-height loss and the ride frequency under load.
- Separate bump and droop travel.

**Validation.** Two independent references in `validation/`, regenerated and compared in CI: a 2D four-bar closed
form (camber, contact patch and toe every 5 mm) and hand statics for five load cases. 59 hand-calculation checks.

**Small things.** The move-search caches keep at most 40 results. This changelog and version tags.

**Not done.** Progressive springs, bump stops, an anti-roll bar linkage and tire load sensitivity (the springs and
tire are linear, the bar is a rate). The caliper and halfshaft are not drawn in the 3D view or the CAD export.
No outside public reference with full hardpoints and results has been found.

## 0.9.0 - 2026-10-15 (commit e3fee2a; no tag yet, see TODO)

The first complete version: the command-line tool and web app with heave, roll and steering sweeps, ride and
damping, member loads and compliance, packaging, the whole-car view, challenges, Compare, reports, Excel and the
3D-for-CAD export (IGES, STEP, CSV, STL).
