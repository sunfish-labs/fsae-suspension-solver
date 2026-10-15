# FSAE Suspension Solver

**Open the web app: https://sunfish-labs.github.io/fsae-suspension-solver/** (nothing to install)
**Guide and worked case study: https://sunfish-labs.github.io/fsae-suspension-solver/ui/guide.html**

A double-wishbone kinematics, ride and loads tool for Formula SAE teams, with a KineSolver-style browser
interface and a Python command-line version. The hardpoints in `designs/` are an **invented example car**.
They are not any real team's design.

## Your team's designs stay private
Design files do not go in this repository.
- Keep your JSON files in a `private/` folder next to the code. Git ignores that folder, so it is never uploaded.
  You can also keep them anywhere else, such as a team drive.
- In the web app, click **Open JSON…** to load one of your files. It is read in your browser and nothing is
  uploaded. Use **Save JSON** (Chrome and Edge can save straight back to the same file) or **Copy JSON** to save changes
  back to your private files.
- Share designs inside the team through your own private channel (team drive, private chat), never by committing
  them here.
- Before every commit, check that `git status` lists no design files outside `designs/`.

## Command-line tool
One command, a small `susp/` package next to it. Needs `python3` (3.8+), `numpy`, `scipy`, and `matplotlib` for plots.
`pip install numpy scipy matplotlib`

It covers the four suspension decisions a team makes before it has a car:

| Decision | Command | What you get |
|---|---|---|
| Hardpoints | `run`, `sens`, `optimize` | camber/toe/caster/KPI/scrub/trail, roll center, anti-dive/squat, **roll camber and roll-center migration**, bump steer (slope and curvature), Ackermann, turning radius, link clearance |
| Springs and dampers | `run` (with a `spring` block) | **motion ratio**, wheel and ride rate, **ride frequency**, damper stroke used, **spring rate needed for a target frequency** |
| Tube, rod-end and tab sizing | `loads` | wishbone-leg, tie-rod, pushrod, damper and rocker forces for bump, cornering, braking and combined cases, plus **buckling and yield safety factors** |
| Whole car | `car front.json rear.json` | front/rear frequencies, **roll gradient**, **LLTD**, and the **anti-roll bar stiffness** needed |

## Browser UI (`ui/index.html`)
A KineSolver-style interface for the same solver. Use the hosted link above, double-click `ui/index.html`, or run
`python3 susp_solver.py ui`.
It needs no install or server; an internet connection loads the 3D library and fonts.
- **Inputs** match KineSolver's panels: hardpoints, wheel settings, vehicle and anti-geometry, and simulation
  ranges. Further panels cover the pushrod, rocker and damper, the load cases, tube sizes and material.
- **3D corner view:** drag to orbit, right-drag or shift-drag to pan, scroll to zoom. The Travel and Rack sliders
  move the suspension, and the readout shows camber, toe, caster, roll center and damper length at that position.
  Toggles show the roll-center construction and the other side of the car.
- **Results update live** in eight tabs: Targets (ranges are editable, click a row for an explanation), Heave, Roll,
  Steering, Spring & damper (rocker plane view, motion ratio, damper length against its limits), Loads (wheel loads,
  member forces, FOS), Packaging and Learn (glossary).
- **Learning tools for new members:**
  - **Show me** draws a term on the 3D corner, such as the steering axis, the instant center or the roll-center construction, or animates bump.
  - **Names** labels every hardpoint.
  - **What moves this?** on a Targets row lists the smallest single or paired hardpoint moves that bring the target into range. It shows the millimeters needed and any targets the move would newly break.
  - **Clicking a joint**, in 3D or in the inputs, shows what a 5 mm move up, outboard or forward does to each metric.
  - **Preview / Apply / Undo:** moves show as a ghost first, and Apply pins the old design as the baseline.
  - Ball joints, contact patch and rocker pivot stay locked unless you unlock them.
  - The glossary text is in `ui/glossary.js` and is inlined by `ui/build.py`.
- **Front | Rear | Car** switch (top right). Front and Rear edit one corner as before. The Car view (the default) shows
  all four corners, the roll axis and CG in 3D, the shared vehicle settings, anti-roll bar rates, car targets (roll
  gradient, front LLTD vs front weight, rear/front ride-frequency ratio), a front-vs-rear table and charts, and the
  bar rates needed for your roll and balance targets. Click a corner in 3D to edit it. In the Car view, Save JSON writes
  one **car file** (`"type": "car"`, a shared `vehicle`, `arb`, `car_targets`, `front`, `rear`). Single-corner files still
  open and go into the slot named by their `axle`. See `designs/example_car.json`.
- **Start here** card (shown on each visit until "Don't show this again" is ticked): explore the example, open a design, or try a **challenge**. Two guided exercises (raise the roll center; remove bump steer). Each has live goal meters with expandable curves, locked points, solver-computed hints and a star score. The challenge panel takes the place of the inputs column, and a focus layout shows only the goal curves, so it fits on one laptop screen.
- **Compare tab:** up to four saved designs next to the live one, kept in this browser. It shows targets and key metrics with the change from a chosen reference, the hardpoints that differ, overlaid curves and 3D ghosts, with a CSV copy.
- **Pin as baseline** freezes the current results. Your next edits then show as change columns and dashed
  baseline curves, which suits the one-coordinate-at-a-time workflow.
- **Same JSON format as the CLI:** open any config file, or copy or download the current one and run it through
  `run`, `loads` or `report`.
- `ui/susp.js` is the solver ported to JavaScript. `python3 ui/test_port.py` checks that it matches the Python
  solver (to about 1e-11; it also checks any files in `private/`). After editing `ui/app.html` or `ui/susp.js`, run
  `python3 ui/build.py` to rebuild `index.html`.

## Quick start

    python3 susp_solver.py selftest                         # KineSolver comparison + physics checks
    python3 susp_solver.py template front > private/front.json   # start from the example (or copy designs/*.json)
    python3 susp_solver.py run front.json --plot front.png  # full text report + plots + geometry views
    python3 susp_solver.py loads front.json                 # member forces and safety factors
    python3 susp_solver.py car front.json rear.json         # roll gradient, LLTD, anti-roll bar
    python3 susp_solver.py car designs/example_car.json     # same, from one car file (front + rear + bars)
    python3 susp_solver.py car car.json --arb-front 250     # try a different front bar (Nm/deg at the wheels)
    python3 susp_solver.py report front.json -o front.html  # one shareable page with all of the above

## Team workflow (one coordinate at a time)
1. `import pts.csv --axle front --map "z,x,y" -o front.json` from SolidWorks points (or start from `template`).
   Every command first checks the inputs: swapped axes, contact patch not at Z=0, ball joints swapped, and so on.
2. `run front.json --advise --log history.csv --note "baseline"`: see what fails and the single moves that fix it.
3. `sens front.json --metric roll_camber --top 8`: which hardpoint moves the metric you care about.
4. Change ONE coordinate, then `run ... --log history.csv --note "LIF z +5"`. The log shows what changed.
5. Once the kinematics are close, set up the `spring` block (pushrod, rocker, damper) and pick the spring from
   "Spring rate for target freq". Then run `loads` to size tubes and rod ends.
6. With front and rear both done, run `car front.json rear.json` to decide whether you need an anti-roll bar.
7. `report front.json --baseline old.json -o r.html` and send it to the team. Confirm everything in CAD.

Bump steer has two parts. **Slope** (deg/in) comes from tie-rod height: fix it with `trackrod_*.z`.
**Curvature** (a U-shaped toe trace) comes from tie-rod length and angle: fix it with `trackrod_inboard.y`.
Example:
`optimize front.json --vary trackrod_inboard.y,trackrod_inboard.z --goal bump_steer=0:0.01 --goal bump_steer_curve=0:0.01 --min-clearance 26`

## How loads are calculated (`loads`)
One config covers both corners of its axle, because the car is symmetric. The solved wheel is the **outer** wheel
in a left turn and the **inner** wheel in a right turn, and both are checked. The inner wheel's side force points
the other way, which can put a different leg into compression.
1. Wheel vertical load = static (car weight x axle share / 2)
   + longitudinal transfer (W x CG height / wheelbase / 2 per g)
   + lateral transfer (W x CG height / track x axle share per g).
   The printout shows this sum for every case.
2. Tire side and brake forces = g level x that wheel's vertical load (equal friction use at every tire). They act at
   the contact patch, or at the wheel center for inboard brakes and drive.
3. The upright is put in static equilibrium against the link forces. Every link is a pin-ended two-force member,
   and the wishbone carrying the pushrod is solved as a three-force body.
4. Strength: **buckling FOS** = Euler load (pi^2 E I / L^2, pinned ends) / worst compression.
   **Yield FOS** = (yield stress x tube area) / worst axial force. Both are compared with `members.sf_target` (default 2).
   Default tubes are 5/8 in x 0.035 in (15.875 x 0.889 mm) 4130 steel, E 205 GPa, yield 435 MPa. Set your real
   tubes under `members`.

## Iterating on the pushrod, rocker and damper
1. Put your actual damper in the `spring` block: `damper_eye_to_eye` and `damper_stroke`.
2. `run front.json --rocker-plot rocker.png` shows the rocker at droop, ride height and bump, the motion ratio,
   damper length against its limits, and the transmission angles.
3. `sens front.json --spring` shows what +5 mm on each spring point does to the motion ratio, progression,
   rocker rotation, transmission angle and sag.
4. Let the optimizer move the points you're free to move (keep chassis mounts fixed if the frame is set), e.g.:

       optimize front.json --vary spring.rocker_rod.y,spring.rocker_rod.z,spring.rocker_damper.y,spring.rocker_damper.z,spring.damper_chassis.y,spring.damper_chassis.z \
           --goal motion_ratio=0.82:0.01 --goal mr_progression=8:2 --goal damper_static_pos=50:2 \
           --goal "rocker_rot<=35:1" --goal "trans_min>=65:2" --keep-clear --max-nfev 200 --reg 0.001 --out front_v2.json

   Goals can be `=`, `>=` or `<=`. `--keep-clear` keeps every clearance pair (including the other side's damper) legal.
5. Re-run `run`, `loads` and `car`. Pick the spring from "Spring rate for target freq".

## Config (JSON)
- `hardpoints` (mm): the 9 points, using KineSolver names. The solver only uses the coordinates; "front"/"rear" are just labels.
- `wheel`: static camber/toe, tire radius/width, rim diameter.
- `vehicle`: wheelbase, cg_height, **mass** (with driver), **weight_front** (fraction), brake share, inboard/outboard
  brakes and drive, optional `rack_c_factor` (mm of rack per steering-wheel turn).
- `spring` (optional, needed for ride and loads):
  `rod_on` (`lower`/`upper`/`upright`), `rod_outboard`, `rocker_pivot`, `rocker_axis` (pivot bolt direction),
  `rocker_rod`, `rocker_damper`, `damper_chassis`, `spring_rate` (N/mm), `damper_stroke`, `unsprung_mass` (kg/corner),
  `damper_eye_to_eye` (mm, extended), `tire_rate` (N/mm), `target_freq_hz`. Leave out the four `rocker_*` keys for a damper mounted directly on the arm.
  Pushrod or pullrod doesn't matter: the geometry decides.
- `loads`: g levels for `bump_g`, `corner_g`, `brake_g`, `combined_g`, `accel_g`, and optional `lltd_front`.
- `members`: `material` (label), tube `[OD, wall]` (mm) for `wishbone`, `tie_rod` and `pushrod`; `E`, `yield` (MPa); `sf_target`.
- `sweep`: heave travel, rack travel, roll angle and step counts. `clearance`: tube ODs and margin.
- `targets`: override any target range, e.g. `"roll_center": [30, 60]`, or `null` to drop one.
- `targets_file`: optional path (relative to the design file) to a shared team targets file:
  `{"front": {...}, "rear": {...}}` or one flat `{metric: [lo, hi]}` table. Applied after the general defaults and
  before the design's own `targets`. In the web app, open that file with **Open JSON** to apply it.

The built-in defaults are deliberately broad sanity ranges (see the guide's target table). Set your own team's
goals with `targets` or `targets_file`. `designs/case_study/` shows how the case-study car does it.

## Conventions
X forward, Y outboard, Z up, right-hand wheel, ground at Z = 0. Toe + = toe-in. Camber - = top leaning in.
In roll, the right wheel is the outer wheel (in bump) and camber is measured **relative to the ground**.
Roll camber 1.0 = the wheel leans with the body, 0 = it stays at static camber.
Member forces: + = tension.

## Validation (`selftest`)
- KineSolver comparison: if `private/kinesolver_cases.json` exists, reproduces those KineSolver runs' chart values
  (to about 0.03 deg / 0.3 mm / 0.04 % on our runs). It's kept private because it contains team hardpoints.
- Physics checks that don't depend on KineSolver:
  - Equal parallel arms give zero camber change, roll camber 1.0 and a roll center at the ground.
  - The upright is in exact equilibrium.
  - **Virtual work**: the damper force from statics equals the tire force divided by the motion ratio from
    kinematics. This ties the statics and the kinematics together.
  - The suggested spring gives the target frequency.
  - Car load transfer adds up to m·g·h.

## Limitations
- Rigid links. No compliance, bushings, tire model, or chassis torsion.
- Roll uses equal and opposite wheel travel, so it gives the kinematic roll center. The force-based roll center
  moves once the tires are loaded unevenly.
- Loads are quasi-static, use the ride-height geometry and the outer wheel only, and assume equal friction use at
  every tire. There are no impact factors or fatigue, and no checks on tabs, welds or inserts.
- The pushrod arm is solved as one node. A pushrod mounted well inboard of the ball joint shows up as "bending
  load" and isn't stress-checked.
- Clearance is center-line distance plus tube radii. The rim check is radial only.
- Default targets (ride frequency 2.5-4.5 Hz, bump steer, LLTD = front weight + 5 %, 1 deg/g) are starting points,
  not rules. Check wheelbase and turning limits against the current FSAE rulebook.
- The optimizer finds one local solution. Always re-run `run` on the result.

See `ACTION_PLAN.md` for how the tool was planned and what each feature is for.

## Updating the web app
Edit `ui/app.html` or `ui/susp.js`, then run `python3 ui/build.py` and `python3 ui/test_port.py`, and commit.
GitHub Pages republishes the site about a minute after each push to `main`.
