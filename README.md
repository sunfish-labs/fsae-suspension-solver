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
- In the web app, use **Open ▾ → A file from your computer…** to load one of your files. It is read in your browser and nothing is
  uploaded. Use **Save ▾ → Save JSON** (Chrome and Edge can save straight back to the same file) or **Copy JSON** to save changes
  back to your private files.
- Share designs inside the team through your own private channel (team drive, private chat), never by committing
  them here.
- Before every commit, check that `git status` lists no design files outside `designs/`.

## Command-line tool
One command, a small `susp/` package next to it. Needs Python 3.11+. Install the pinned dependencies (numpy, scipy,
jinja2; matplotlib for plots) with `pip install -e ".[plots]"`, or `pip install -e ".[plots,dev]"` to also get the
linter and the CAD-kernel test tools.

It covers the four suspension decisions a team makes before it has a car:

| Decision | Command | What you get |
|---|---|---|
| Hardpoints | `run`, `sens`, `optimize` | camber/toe/caster/KPI/scrub/trail, roll center, anti-dive/squat, **roll camber and roll-center migration**, bump steer (slope and curvature), Ackermann, turning radius, link clearance |
| Springs and dampers | `run` (with a `spring` block) | **motion ratio**, wheel and ride rate, **ride frequency**, damper stroke used, **spring rate needed for a target frequency** |
| Tube, rod-end and tab sizing | `loads` | wishbone-leg, tie-rod, pushrod, damper and rocker forces for bump, cornering, braking and combined cases, plus **buckling and yield safety factors** |
| Whole car | `car front.json rear.json` | front/rear frequencies, **roll gradient**, **LLTD**, and the **anti-roll bar stiffness** needed |

## Browser UI (`ui/index.html`)
A KineSolver-style interface for the same solver. Use the hosted link above, or build it with
`python3 ui/build.py` and double-click `ui/index.html` (or run `python3 susp_solver.py ui`). The built page is not
kept in the repo; GitHub builds and publishes it on every push. For a copy that works offline, save the hosted page
(File → Save Page As, "Webpage, Single File" or "HTML Only") or build it once.
It needs no install, server or internet: three.js, the Excel writer and the fonts are built into the one file (see
`ui/vendor/`), so it also runs from a USB stick.
- **Inputs** match KineSolver's panels: hardpoints, wheel settings, vehicle and anti-geometry, and simulation
  ranges. Further panels cover the pushrod, rocker and damper, the load cases, tube sizes and material.
- **3D corner view:** drag to orbit, right-drag or shift-drag to pan, scroll to zoom. The Travel and Rack sliders (type a value, ⟲ to reset, ▶ Play to sweep bump and droop)
  move the suspension, and the readout shows camber, toe, caster, roll center and damper length at that position.
  **Display ▾** shows the roll-center construction, the other side of the car and joint names; **Show me** draws a term.
- **Results update live** in six tabs: Targets (ranges are editable, click a row for an explanation), Motion (Heave, Roll,
  Steering), Spring & damper (rocker plane view, motion ratio, damper length against its limits), Loads (wheel loads,
  member forces, FOS), Packaging and Compare. **Learn** (glossary) is next to Start here.
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
- **Export ▾** gives a printable **design report** (HTML; open it and print to PDF) and an **Excel workbook**
  (targets, hardpoints, heave/roll/steering sweeps, member loads; for the whole car it adds a summary sheet with the
  car targets and roll balance), and the **3D for CAD** files below. In the Car view they cover both corners, otherwise the corner on screen.
- **Start here** card (shown on each visit until "Don't show this again" is ticked): explore the example, open a design, or try a **challenge**. Two guided exercises (raise the roll center; remove bump steer). Each has live goal meters with expandable curves, locked points, solver-computed hints and a star score. The challenge panel takes the place of the inputs column, and a focus layout shows only the goal curves, so it fits on one laptop screen.
- **Compare tab:** up to four saved designs next to the live one, kept in this browser. It shows targets and key metrics with the change from a chosen reference, the hardpoints that differ, overlaid curves and 3D ghosts, with a CSV copy.
- **Undo / Redo** (header, or Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z outside text boxes) covers every change: typed
  values (a burst of typing in one box is one step), targets, car settings, applied moves and opened designs.
- **Pin as baseline** (in the status strip under the sliders) freezes the current results. Your next edits then show as change columns and dashed
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
2. `run front.json --advise --log history.csv --note "baseline"`: see what fails and the moves that fix it, single
   coordinates and paired ones (both pivots of a wishbone, the whole tie rod). The best few are re-checked with a
   full evaluation before they are shown. The app's "What moves this?" uses the same list (`schema/moves.json`).
3. `sens front.json --metric roll_camber --top 8`: which hardpoint (or pair, e.g. `lower_inboard_front+lower_inboard_rear.z`)
   moves the metric you care about. `optimize --vary a+b.z` moves a pair together.
4. Change ONE coordinate, then `run ... --log history.csv --note "LIF z +5"`. The log shows what changed.
5. Once the kinematics are close, set up the `spring` block (pushrod, rocker, damper) and pick the spring from
   "Spring rate for target freq". Then run `loads` to size tubes and rod ends.
6. With front and rear both done, run `car front.json rear.json` to decide whether you need an anti-roll bar.
7. `report front.json --baseline old.json -o r.html` and send it to the team. Confirm everything in CAD.

Bump steer has two parts. **Slope** (deg/in) comes from tie-rod height: fix it with `trackrod_*.z`.
**Curvature** (a U-shaped toe trace) comes from tie-rod length and angle: fix it with `trackrod_inboard.y`.
Example:
`optimize front.json --vary trackrod_inboard.y,trackrod_inboard.z --goal bump_steer=0:0.01 --goal bump_steer_curve=0:0.01 --min-clearance 26`

## Exporting to CAD (SolidWorks, Fusion, Onshape)
In the web app, **Export ▾ → 3D for CAD…** writes the corner (or, in the Car view, the whole car with all four corners)
as reference geometry for the chassis designer:
- **STEP solid bodies** (best for Onshape and Fusion): real solids at ride height, one named part each
  (`FR_tie_rod`, `FR_UCA_front_leg`, `RL_tire`, ...): every link at its tube OD (12 mm rods for the upright and
  rocker lines), a 22 mm ball at each joint, and each tire as a cylinder of its radius and width. Mate to them,
  measure from them, section them, or check interference with the frame.
- **IGES (.igs)** for SolidWorks, Fusion, NX and CATIA; **STEP (.step)** for Onshape, Fusion and SolidWorks. Every
  hardpoint is a named point (`FR_UCA_front_pivot`, `RL_toe_link_inboard`, ...) and every link is a line: wishbone legs,
  tie rod / toe link, upright axis, spin axis, pushrod, rocker and damper. In SolidWorks, open the file and turn on
  importing free point/curve entities in the import options; they arrive as a 3D sketch.
- **Poses:** besides ride height, the links at full bump, full droop and full steer, each as its own layer (IGES level,
  STEP curve set) and colour, so the frame can be checked against everything the links sweep through.
- **CSV** (named point table) and **STL** (round tubes at your tube ODs, for clearance checks; STL has no units).
- **Axes:** SolidWorks default (X forward, Y up, Z right), ISO vehicle axes (X forward, Y left, Z up), ADAMS-style
  (X rearward, Y right, Z up) or the solver's own frame. Origin at the front axle centerline on the ground, or the
  solver's frame. mm or inch. In a car the rear corner is placed one wheelbase behind the front contact patch.
- Files are written in the browser; nothing is uploaded. `tests/test_cad.py` reads them back in OpenCascade and checks
  every point, and that every solid body is a valid closed solid with the right volume in the right place.

## Rod-end and bearing misalignment
Every rod end and spherical bearing is checked over the whole travel and rack range (the packaging grid): how far it
tilts from square to its bolt, against the catalog limit (`members.rod_end_misalign`, default 12°, and
`members.bearing_misalign`, default 10°; check your parts). The joints are the four wishbone inboard pickups, both
ball joints, both tie-rod / toe-link ends, both pushrod ends and both damper eyes.

- **Rod end** (on a link): the link can turn about its own axis, so the angle is asin(|link · bolt|).
- **Spherical bearing** (the ball joints: race in the wishbone, bolt through the upright): square at ride height,
  or at `joints.<key>.align` mm of wheel travel (e.g. mid-bump, where it spends most of its time); the angle is how
  far the two parts turn the bolt axis apart. Steering and travel both count.
- **Bolt direction** per joint under `joints.<key>.bolt`: `"x"`, `"y"`, `"z"`, `"pivot"` (the wishbone pivot axis),
  `"kingpin"`, `"rocker"` or `[x, y, z]`; `"square": true` squares it to the link at ride height (a bracket built
  square to the rod end). Defaults: wishbone pickups along the pivot axis squared to the leg, ball joints along the
  kingpin, tie-rod ends vertical squared to the rod, pushrod on the arm along its pivot axis, rocker ends along the
  rocker axis. `joints.<key>.allow` sets one joint's limit. In the web app, type a joint's limit (and a ball
  joint's alignment travel) straight into its row of the Packaging table.
- For each rod end the solver also finds the bolt direction (square to the link) that keeps its worst angle
  smallest, and shows it when it is at least 0.5° better. In the web app you can pick it from the table.

It shows as `misalign_margin` among the targets (must be ≥ 0), in the **Packaging** tab, in its own section at the
end of the design report, as **Export ▾ → Joint misalignment sheet** (a page on its own), as a sheet in the Excel
export and in the command-line `run` output.

## Showing your chassis in the 3D view
**Open ▾ → Chassis model (STL / OBJ)…** (or **Display ▾ → Chassis model…** in a corner view) loads a frame, body,
seat or driver model from CAD and draws it see-through around the suspension, so you can watch the links move
inside it. Pick the axes, origin and units the model was saved in; the dialog reports its size and where it sits so
you can tell if a setting is wrong. A frame built around the **3D for CAD** export, saved with the same settings,
lines up with no adjustment. Otherwise **Move and rotate** it: X / Y / Z offsets and roll / pitch / yaw about its
own center (typed, or − / + in steps of 1, 10 or 100 mm and 0.5, 5 or 90°), **Center on the centerline** and
**Lowest point at … mm**. Hover over the model to read the X Y Z of any point on it and line up a known point (a
pickup tab, the front bulkhead) with the hardpoint it should meet. The model is read in your browser, never
uploaded, and kept in this browser (IndexedDB) with its position for the next visit.

**Clearance to the model.** **Check clearance** in the chassis panel finds how close each link (the four wishbone
legs, tie rod / toe link, pushrod and damper, at their tube ODs) comes to the model's surface over the whole travel
and steering range, on both sides of both axles. It also checks the **tire** (the solid drawn in the view: tire
width, radius and rounded shoulders; exact, not sampled), the **upright** and **rocker** as drawn (stick tubes
and the rocker plate's edges: a real upright is bulkier, so leave room), the brake caliper envelope and the rear
halfshaft. The table lists the closest links against `clearance.margin`;
click one to jump to that pose and mark the two closest points in red. Gaps over 150 mm are not listed. A link that
crosses the model shows "touches". It checks surfaces, so a link entirely inside a closed shape isn't caught.

**Axes in the 3D view.** The triad in the corner shows the solver's axes as the view turns: X forward (red),
Y right (green), Z up (blue); ground at Z = 0, car centerline at Y = 0, in mm. Hover over any joint to read its
coordinates. That frame is left-handed, so it is drawn as a mirror of three.js's own axes; the right-hand corner is
drawn on the car's right.

## How loads are calculated (`loads`)
One config covers both corners of its axle, because the car is symmetric. The solved wheel is the **outer** wheel
in a left turn and the **inner** wheel in a right turn, and both are checked. The inner wheel's side force points
the other way, which can put a different leg into compression. `loads car.json` runs both corners of a car file.
1. Wheel vertical load = static (car weight x axle share / 2)
   + longitudinal transfer (W x CG height / wheelbase / 2 per g)
   + lateral transfer (W x CG height / track x this axle's share of the lateral load transfer, per g).
   That share is the front LLTD from the car's roll balance when you run a car file (or work in the Car view),
   `loads.lltd_front` if you set it, otherwise the front weight share. The printout shows this sum for every case.
2. Tire side force = g level x that wheel's vertical load. Braking force: with `loads.brake_split` = `"bias"` (default)
   it is g x car weight x this axle's brake share (`vehicle.front_brake_share`) / 2, the same split the anti-dive
   figure uses; `"grip"` gives every tire the same friction use (g x that wheel's load). Forces act at the contact patch,
   or at the wheel center for inboard brakes and drive.
3. The upright is put in static equilibrium against the link forces. Every link is a pin-ended two-force member,
   except the wishbone carrying the pushrod: it is solved as **one rigid body** with a reaction at each pivot, the
   ball-joint force and the pushrod. The pushrod force is what balances the arm about its pivot axis; the leg forces
   then follow the actual load path. Any load the legs carry across themselves (when the pushrod isn't mounted at the
   ball-joint node) is shown as the arm's "bending load".
4. **Deflected geometry:** the bump and pothole cases are also solved where the wheel actually is under that load,
   raised by (load - static load) / wheel rate and capped at full bump, as "bump (deflected)" and "pothole
   (deflected)". Both they and the ride-height cases count in the strength checks.
5. Strength: **buckling FOS** = Euler load (pi^2 E I / L^2, pinned ends) / worst compression.
   **Yield FOS** = (yield stress x tube area) / worst axial force. Both are compared with `members.sf_target` (default 2).
   Default tubes are 5/8 in x 0.035 in (15.875 x 0.889 mm) 4130 steel, E 205 GPa, yield 435 MPa. Set your real
   tubes under `members`.
6. **Impacts:** a pothole case (`pothole_g`, default 4 g vertical on the wheel) and a kerb strike (`kerb_g`, default 2 g
   sideways into the wheel plus static load) sit beside the driving cases. They are rough design-load factors, not a
   crash simulation; set them to your team's numbers.
7. **Pushrod mount bending:** the pushrod rarely lands exactly on a wishbone leg's centerline. The leg is treated as a
   simply supported beam between its pivot and the ball joint, with the pushrod's push across it at the mount:
   M = P⊥ × a × (L − a) / L and σ = M·c/I + max |N| / A, where N is the leg force either side of the mount (it steps by
   the pushrod's push along the leg there). A low FOS here means the mount needs a gusset or bracket into the
   node, not a bigger tube. Describe the reinforcement under `members.gusset` (inputs → Loads & materials →
   Pushrod mount on the wishbone):
   - `{"thickness", "height", "length_in", "length_out"}` (mm): a triangular plate welded along the leg under the
     mount, full height at the mount and nothing at each end, `length_in` toward the pivot and `length_out` toward
     the ball joint. The section is the tube plus the plate (standing on the tube in the plane of the load), and the
     stress is searched along the whole leg: it often peaks where the gusset ends, so a longer gusset helps more
     than a taller one. The fatigue screen adds the weld where the gusset ends, with the IIW class for a
     longitudinal attachment by its length (80 MPa up to 50 mm, 71 to 150, 63 to 300, 50 beyond; `fat` overrides).
   - `{"type": "to_node"}`: a bracket that carries the push straight into the ball-joint node, so the leg isn't
     bent. The bracket itself isn't checked: model it in CAD and check it with FEA using the part loads below.
   - Anything else (a cross tube between the legs, a machined mount): model it in CAD and use the part loads.

   **Part loads for FEA** (Export ▾ → Part loads for FEA…, or `loads design.json --fea loads.csv`): every force on
   the upright, each wishbone and the rocker of the right-hand corner, for each load case, with the point it acts
   at, in the same axes, origin and units as the 3D-for-CAD export (so the points land on a model built from it).
   Each part's forces and moments balance (the rocker's about its axis), so a fixed support in FEA should carry close
   to nothing: a check that the loads went in right.
8. **Rod ends and bolts:** each member's worst force is checked against `members.rod_end_rating` (N, from your rod end's
   catalog; leave blank to skip) and a bolt in shear: capacity = planes × π/4 × d² × 0.6 × UTS (`bolt_dia` mm,
   `bolt_grade` 8.8 / 10.9 / 12.9 / SAE 5 / SAE 8, `bolt_shear_planes` 1 or 2).
9. **Compliance:** each link is an axial spring made of two rod ends (`rod_end_k`, N/mm each), the tube (E·A/L) and
   the chassis tab or bracket (`mount_k`) in series; the wishbones, upright, rocker and rack are rigid and the damper
   is held. The link stretches (force ÷ stiffness) move the upright, found with the unit-load method so the work
   done by the tire forces equals the energy in the links. The output is the camber and toe change per case on top
   of the kinematic curves, plus how far the contact patch moves sideways. The worst cornering, braking or
   acceleration case is compared with `toe_comp_limit` (default 0.15 deg) and `camber_comp_limit` (0.25 deg);
   bump and impact cases are shown but not limited. The default stiffnesses are estimates: measure your own tabs and
   rod ends if you can.
10. **Pickup tabs:** a pair of tabs per link end (double shear; sizes under `members.tab`: `thickness`, `width`,
   `edge` = hole center to the tab's end, `weld_leg`, `weld_length` per tab, `count`; the defaults are a typical 1/8 in
   tab, so enter yours). Against each end's worst force: bearing F/(n t d) and net section F/(n t (W − d)) vs yield,
   tear-out F/(2 n t (e − d/2)) and the weld throat F/(n L 0.707 leg) vs 0.577 × yield (`members.tab_yield`, default
   the tube yield), compared with `sf_target`.
11. **Fatigue screen:** each driving case is a load that repeats, from the car at rest to that case and back, and
   so does each swing between opposite cases (left and right turns: corner outer ↔ inner; braking ↔ accelerating),
   `loads.fatigue_cycles` times (default 100,000: about three seasons of hard corners and stops with margin); the bump
   repeats `loads.fatigue_bump_cycles` times (10,000); impacts are left out. Tubes away from welds: modified Goodman
   on the Shigley S-N line (0.9 S_ut at 1,000 cycles to the endurance limit k_a k_b k_c 0.5 S_ut at a million;
   `members.uts`, `members.surface`). Welds at the tube ends and the tab throats: the stress range against the weld's
   IIW fatigue class (`members.weld_fat_tube`, default 45 MPa; `members.weld_fat_tab`, default 36 MPa; FAT = the range a
   weld survives 2 million times, slope 3, flat from 10 million). The leg carrying the pushrod mount is checked with
   its bending stress. Margin = allowed ÷ applied, against `members.fatigue_sf` (1.5); each row also gives the cycles
   to a crack. It is a screen at the design g levels, not a life prediction: a failing row is a part to look at
   closely, and loads logged on the car make it exact. Look up the weld class for your weld detail.

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


### Springs as fitted: dual-rate springs and bump stops
Under **Spring as fitted** (or in the JSON `spring` block): `spring_rate2` from `spring_breakpoint` mm of damper
compression beyond ride height (a dual-rate spring), and a bump stop that touches after `bumpstop_gap` mm with a rate
of `bumpstop_k` N/mm, made progressive with `bumpstop_k2` (force = k d + k2 d² for d mm of squash). The wheel rate
over the travel (spring and stop rate x motion ratio²) is plotted in the Spring & damper tab, with the wheel travel to
the bump stop and the wheel rate at full bump. The aero sag and the deflected bump / pothole load cases integrate that
curve, so a stiffening spring or a bump stop changes where the wheel ends up under load.

### Anti-roll bar linkage
Tick **Model this axle's bar and drop link** to replace the bar number in the Car view with one worked out from the
geometry (JSON: `arb` in the corner): the drop link's lower end (`link_outboard`, on the lower or upper wishbone,
the upright or the rocker), its upper end (`arm_tip`, the end of the bar's arm) and a point on the bar's axis
(`bar_pivot`, axis along Y unless `bar_axis` says otherwise), plus the tube (`bar_od`, `bar_wall`, `bar_length`
between the arms, `bar_G`, `bar_yield`). The solver moves the drop link with the suspension, finds the bar's twist per
mm of wheel travel (its own motion ratio) and gives the bar's rate at each wheel in roll (2 G J / L x twist-per-mm²),
the axle's roll stiffness in Nm/deg, and the bar's shear stress and FOS at `sweep.roll_deg` of roll (a target: FOS ≥
`members.sf_target`). `designs/example_car_bars.json` has a front bar driven from the rocker and a rear bar from the
lower wishbone.

### Tires at the limit (load sensitivity)
With `vehicle.tire_load_sens` (k) set, a tire's friction falls with load: μ = `tire_mu` (1 − k (Fz / Fz0 − 1)). An
axle that transfers load then has less total grip, μ (2 Fz0 − 2 k ΔFz² / Fz0), so the car balance reports where each
axle lets go (g), how much grip load transfer costs at each end, which end lets go first (understeer or oversteer at
the limit) and the front LLTD at which both let go together. With the same tires front and rear that neutral LLTD is
the share Fz0 x track at the front; running LLTD a few points above it gives a margin of understeer, which is why the
default LLTD target sits a few points above the front weight. Fit k to your tire's data (0.1–0.3 is common).

### Damping
Add the damper's dyno slopes to the `spring` block (N per m/s at the shaft): `damper_bump_low`, `damper_bump_high`,
`damper_rebound_low`, `damper_rebound_high`, and `damper_knee` (mm/s). The solver reports critical damping at the
wheel (body and wheel hop), the damping ratio of each setting (ζ = c × MR² ÷ c_crit), and the damper rates that hit
`target_zeta_low` (default 0.7, body control) and `target_zeta_high` (default 0.35, bumps). With low-speed bump and
rebound given, the Targets list checks ζ bump 0.4–0.9 and rebound 0.5–1.2 (edit them like any target).
## Config (JSON)
- `hardpoints` (mm): the 9 points, using KineSolver names. The solver only uses the coordinates; "front"/"rear" are just labels.
- `wheel`: static camber/toe, tire radius/width, rim diameter. Optional `rim_inner_radius` (mm, the barrel's inside;
  default rim radius − 15 mm) and `caliper`: `{"clock_deg", "radius", "size", "offset"}` - a sphere of diameter
  `size` fixed to the upright, `radius` mm from the axle at a clock angle in the wheel plane (0 = forward, 90 = up),
  `offset` mm along the axle (+ outboard). It is checked against every link (`clearance.caliper_margin`) and the barrel.
- `vehicle`: wheelbase, cg_height, **mass** (with driver), **weight_front** (fraction), brake share, inboard/outboard
  brakes and drive, optional `rack_c_factor` (mm of rack per steering-wheel turn), `aero_front` / `aero_rear`
  (downforce in N per axle at your reference speed: gives the ride-height loss and the ride frequency there).
- `halfshaft` (rear, optional): `diff_output` (fixed, the inboard CV center) and `cv_outboard` (on the upright) as
  `[x, y, z]`, optional `plunge_max`, `cv_angle_max_in`, `cv_angle_max_out`. Reports plunge, both CV angles over the
  travel (inboard against the lateral diff axis, outboard against the spin axis) and the clearance to every link
  (`clearance.halfshaft_od`).
- `spring` (optional, needed for ride and loads):
  `rod_on` (`lower`/`upper`/`upright`), `rod_outboard`, `rocker_pivot`, `rocker_axis` (pivot bolt direction),
  `rocker_rod`, `rocker_damper`, `damper_chassis`, `spring_rate` (N/mm), `damper_stroke`, `unsprung_mass` (kg/corner),
  `damper_eye_to_eye` (mm, extended), `tire_rate` (N/mm), `target_freq_hz`. Leave out the four `rocker_*` keys for a damper mounted directly on the arm.
  Pushrod or pullrod doesn't matter: the geometry decides.
- `loads`: g levels for `bump_g`, `corner_g`, `brake_g`, `combined_g`, `accel_g`, `pothole_g`, `kerb_g`; `brake_split`
  (`"bias"` or `"grip"`); optional `lltd_front` (overrides the car's roll balance).
- `members`: `material` (label), tube `[OD, wall]` (mm) for `wishbone`, `tie_rod` and `pushrod`; `E`, `yield` (MPa); `sf_target`;
  `rod_end_rating` (N), `bolt_dia` (mm), `bolt_grade`, `bolt_shear_planes`; compliance `rod_end_k`, `mount_k` (N/mm),
  `toe_comp_limit`, `camber_comp_limit` (deg); front steering compliance `rack_k` (N/mm, rack and its mounts) and
  `column_k` (N m/deg, column torsion, needs `vehicle.rack_c_factor`), both in series with the tie rod.
- `sweep`: heave travel (`travel`, or separate `bump_travel` / `droop_travel`), rack travel, roll angle and step
  counts; the packaging grid is `pack_heave_steps` × `pack_rack_steps` (9 × 7). `clearance`: tube ODs and margin.
- `targets`: override any target range, e.g. `"roll_center": [30, 60]`, or `null` to drop one. A key that isn't a
  metric the solver reports (usually a typo) is reported with the nearest match, e.g. `'camberr' ... did you mean
  'camber'?`, instead of being ignored.
- `targets_file`: optional path (relative to the design file) to a shared team targets file:
  `{"front": {...}, "rear": {...}}` or one flat `{metric: [lo, hi]}` table. Applied after the general defaults and
  before the design's own `targets`. In the web app, open that file with **Open ▾** to apply it. Saved designs and car
  files keep only the link and the ranges you set yourself, so a later change to the team file still applies.

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
- Independent models in `validation/` (run by `tests/test_reference.py`): a displacement-method stiffness model of
  the corner gives every load case's member forces on five corners (rod on the lower or upper arm, on the upright,
  direct-acting damper), and a springs-and-masses matrix model of the whole car gives the roll gradient, LLTD and
  twist-test stiffness. Both agree with the solver to about 1e-9.
- Your own car: [validation/MEASURING.md](validation/MEASURING.md) lists five shop-tool tests (bump sweep, spring
  force, wheel rate, twist test on corner scales, skidpad with damper pots) and turns the readings into reference
  cases.

## Limitations
- The kinematic curves use rigid links. Compliance is a separate linear check at ride height (axial link stretch
  only: no bushings, bending of the arms, upright or wheel flex, tire model, or chassis torsion).
- Roll uses equal and opposite wheel travel, so it gives the kinematic roll center. The force-based roll center
  moves once the tires are loaded unevenly.
- Loads are quasi-static. The bump and pothole cases are also solved at the spring's deflected position; the other
  cases use the ride-height geometry (no body roll or pitch). Impacts are fixed g factors. The tab check is a
  simplified lug (no hole stress concentration) and the fatigue check is a screen at stated cycle counts and the
  design g levels, not a life prediction; weld fatigue classes depend on the weld detail. Inserts and rod-end
  threads are not checked.
- The pushrod-mount bending check is a simple beam (with a gusset, the tube plus a plate): no stress concentration
  at the mount's own weld, no weld heat-affected zone, and a bracket into the node isn't checked (use the part loads
  in FEA).
- Clearance is center-line distance plus tube radii. The rim check is radial only. The caliper is a sphere and the
  halfshaft a straight cylinder; both are drawn that way in the 3D view and the CAD export.
- The tire's vertical rate does not change with load. Tire load sensitivity is a straight-line fall of friction with
  load, the same on both axles, used only for the limit balance (not for the load cases). Wheel rate is spring rate x
  motion ratio^2 (the spring force x d(MR)/dz term is left out, as in most hand calculations;
  `wheel_rate_preload` reports it with that term, which is what a bench test reads). The bar's arms are
  rigid and its drop links don't affect the ride rate (the bar only acts in roll).
- Default targets (ride frequency 2.5-4.5 Hz, bump steer, LLTD = front weight + 5 %, 1 deg/g) are starting points,
  not rules. Check wheelbase and turning limits against the current FSAE rulebook.
- The optimizer finds one local solution. Always re-run `run` on the result.

See `ACTION_PLAN.md` for how the tool was planned and `TODO.md` for what is next.

## Code layout
Both solvers read the same **`schema/`** files: `defaults.json` (every default value, with notes), `metrics.json`
(label, unit, decimals, help text and Learn-tab term for each metric), `targets.json` (the built-in target ranges),
`points.json` (point names, input-table labels and importer aliases) and `moves.json` (the candidate moves the advice
tries). Change a label or a default there once.

| Python (`susp/`) | What it does |
|---|---|
| `schema.py`, `config.py`, `validate.py` | reads `schema/`; `normalize()` turns any design or car file into a config; input checks |
| `kinematics.py` | the rigid-link solver: heave, roll and steering sweeps, all geometry metrics |
| `ride.py`, `car.py` | pushrod/rocker/damper, motion ratio, ride and damping; whole-car roll balance |
| `loads/` | `cases.py`, `statics.py` (incl. the rigid pushrod arm), `strength.py`, `compliance.py` |
| `tools/` | `sens.py`, `advise.py`, `optimize.py`, `history.py`, `importer.py` |
| `output/` | `text.py` (printouts), `plots.py`, `report.py` + `templates/report.html.j2` (Jinja) |
| `errors.py` | `SuspError` and its subclasses; the command line prints them as one line |

The web app's solver lives in `ui/solver/` and mirrors the Python modules one to one (`10_config.js` = config and
validate, `20_kinematics.js`, `30_ride.js`, `40_loads.js`, `50_car.js`); `tests/test_parity.py` keeps the two in step.
`ui/build.py` joins those files into one closure (also written to `ui/susp.js`, generated) the same way it joins the
app modules in `ui/src/`: `00_state`, `05_inputs`, `06_run`, `08_charts`, `10_viewer`, `12_overlays`, `15_history`,
`18_results`, `20_panels_*` (one per results tab), `22_learn`, `25_fix`, `26_influence`, `30_challenges`,
`40_compare`, `50_car`, `60_export`, `65_cad`, `70_main`. There is no bundler. JavaScript is formatted with Prettier
(`.prettierrc.json`); CI checks it.

## Updating the web app
The page is built from small files and assembled into one self-contained `ui/index.html`:

| File | What it holds |
|---|---|
| `ui/app.html` | the page skeleton (header, panels, placeholders) |
| `ui/src/style.css` | all styles, colors and light/dark themes |
| `ui/src/00_state.js` … `08_charts.js` | shared helpers and state, input forms, the solve loop, SVG charts |
| `ui/src/10_viewer.js`, `12_overlays.js` | 3D view and labels; "Show me" construction drawings |
| `ui/src/18_results.js`, `20_panels_*.js` | the result tabs, one file per tab |
| `ui/src/22_learn.js`, `25_fix.js`, `26_influence.js` | Learn tab; "What moves this?"; influence panel, preview / apply |
| `ui/src/30_challenges.js` | challenges and their hints |
| `ui/src/40_compare.js` | Compare tab |
| `ui/src/50_car.js` | Front / Rear / Car and the whole-car balance |
| `ui/src/60_export.js` | design report and Excel export |
| `ui/src/65_cad.js` | the 3D for CAD dialog |
| `ui/src/70_main.js` | toolbar menus and start-up |
| `ui/solver/*.js`, `ui/glossary.js` | the solver (port of the Python, built into `ui/susp.js`) and the glossary text |
| `ui/cad.js` | CAD export: IGES, STEP, CSV and STL writers (no DOM, also runs in Node for tests) |

The JS modules run in file-name order inside one closure, so they share helpers such as `$`, `fmt`, `cfg` and `ev`.

After editing, run `python3 ui/build.py`, then the checks:

    python3 susp_solver.py selftest      # Python solver vs KineSolver and physics checks
    python3 ui/test_port.py              # browser solver matches the Python solver
    python3 tests/test_analytic.py       # hand calculations with exact answers
    python3 tests/test_parity.py         # 200 randomly perturbed designs: Python and browser agree
    python3 tests/test_config.py         # input handling: typed errors, misspelled target keys
    ruff check .                         # Python lint (pip install -e ".[dev]")
    (cd tests && node lint_bundle.js && npx eslint .)   # JavaScript lint
    python3 tests/test_cad.py            # CAD export read back in OpenCascade (pip install cadquery-ocp)
    (cd tests && npm ci) && node tests/browser_test.js   # the web app end to end in a headless browser

GitHub runs all of these on every push (Actions tab, workflow "tests"); a red X on a commit means something broke.
On every push to `main` the `pages` workflow builds `ui/index.html` and publishes the site (Settings → Pages →
Source: GitHub Actions), about a minute later. The built page is not committed.
