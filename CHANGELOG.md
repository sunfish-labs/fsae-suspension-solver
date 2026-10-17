# Changelog

Versions follow [semantic versioning](https://semver.org/). Each release is a git tag (`v1.0.0`); the version is
also in `pyproject.toml`.

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
