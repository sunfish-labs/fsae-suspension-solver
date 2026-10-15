# Suspension Solver: critique and action plan

Written for a first-year FSAE team with no car yet. Over the next months the team has to:
(1) pick hardpoints, (2) pick springs and route the pushrod or pullrod, (3) size the wishbones, tie rods,
rod ends and tabs, and (4) check that the front and rear work together as one car.
The old tool covered only step 1. This plan covers all four without adding a GUI, a tire model or a lap sim.

## What the old tool did well (keep)

- A robust rigid-link solver: Newton iteration with continuation (small steps). It matches KineSolver to about
  0.03 deg and 0.3 mm on three published runs.
- A "move one coordinate at a time" workflow (`advise`, `sens`, `--log`, `history`), which suits students.
- Tie-rod to wishbone clearance over heave and steer. KineSolver doesn't check this, and it caught a real clash
  in the current front design.
- One shareable HTML report.

## Critique: problems found, worst first

| # | Problem | Why it matters for a first-year team |
|---|---------|---------------------------------------|
| 1 | **No roll analysis.** Camber gain is reported only in heave (deg/in). | The car corners in roll. Camber relative to the ground in roll, and how far the roll center moves sideways, decide tire grip. Heave camber gain alone can look fine while the outer tire rolls onto its sidewall. |
| 2 | **No spring/damper geometry.** There's no pushrod, pullrod, rocker or damper, so no motion ratio, wheel rate or ride frequency. | Choosing springs and a damper is the next decision after hardpoints. Without a motion ratio the team can't buy springs, check damper stroke, or check that the pushrod clears the wishbones. |
| 3 | **No loads.** There are no member forces, so tubes, rod ends and tabs can't be sized. | Every first-year car needs wishbone, tie-rod and pushrod forces for its standard load cases, plus a buckling check. Today that's a separate hand calculation that rarely matches the geometry actually being run. |
| 4 | **No whole-car view.** Front and rear are separate files and nothing combines them. | You can't get roll gradient, lateral load transfer distribution (LLTD), front/rear frequency split or "do we need an anti-roll bar, and how stiff" without both axles. |
| 5 | **The rear axle runs the steering sweep.** Rack travel, Ackermann and "rack for 25 deg" were printed for the rear toe link. | The numbers are meaningless and they hide the real rear output. |
| 6 | **No input sanity checks.** CAD imports with swapped axes, a contact patch not at Z=0, or upper and lower ball joints swapped are accepted silently. | This is the most common first-year mistake. The solver then "works" and gives confident nonsense. |
| 7 | **Mechanical trail in heave is measured from the *static* contact patch X.** | Trail is the self-aligning lever arm, so it must use the *current* contact patch. The ride-height value doesn't change; the curve does. |
| 8 | **Bump steer is an endpoint slope only.** | A curved toe trace (tie-rod length mismatch) can show 0 deg/in with large toe change mid-travel. Max toe change needs its own target. |
| 9 | **Validation was only "agrees with KineSolver".** | Two tools can share a mistake. We need first-principles tests: equilibrium, virtual work, closed-form geometry. |
| 10 | **One 1,400-line file.** Physics, text output, HTML, optimizer and CSV import are mixed together. | Next year's suspension lead inherits this. Separating the parts makes it readable and testable, not bigger. |
| 11 | No picture of the geometry. | A front/side/top view of the links catches input errors in seconds. |
| 12 | No turning radius or steering-arm length. | The turning circle has to fit the tightest hairpin, and a short steering arm means high rack loads. |

## Action plan (implemented)

**A. Roll sweep (fixes 1).** Roll the body with equal and opposite wheel travel (Lotus-style), using the
mirrored left wheel. Report ground-referenced camber for the outer and inner wheels, **roll camber**
(deg camber per deg roll; 0 = wheel stays upright, 1 = wheel leans with the body), and the
**kinematic roll center** height and lateral migration per degree of roll.

**B. Spring/damper module (fixes 2).** An optional `spring` block: pushrod or pullrod mounted on the lower arm,
upper arm or upright, an optional rocker (bellcrank) with its pivot axis, and the damper's chassis mount.
Outputs over the heave sweep: **motion ratio** (damper/wheel), wheel rate, ride rate (tire in series),
**ride frequency**, damper stroke used against stroke available, and the **spring rate needed to hit a target
frequency**. This is the answer to "which spring do we buy?". The pushrod is added to the clearance check.

**C. Load cases → member forces (fixes 3).** A `loads` command. Standard cases (bump, cornering, braking,
braking + cornering, acceleration) are built from mass, CG, weight distribution and g-levels, all editable.
It solves the six members (4 wishbone legs, tie rod, pushrod), including the common case where the pushrod
sits on a wishbone (that arm is solved as a 3-force body, and any bending load is reported, not hidden).
Outputs: tension/compression per member, damper force, Euler buckling and yield safety factors for the
team's tube sizes, and peak rod-end loads.

**D. `car` command (fixes 4).** Takes front.json and rear.json and reports front/rear ride frequency, roll
stiffness from the springs, roll-axis height, **roll gradient (deg/g)**, LLTD against front weight, and the
**anti-roll bar stiffness (front/rear split)** needed to hit a target roll gradient and LLTD.

**E. Correctness fixes (fixes 5, 7, 8).** The rear axle skips the steering sweep. Trail uses the current
contact patch. There's a new `bump_steer_max` target. Turning radius and steering-arm length are reported.

**F. Input checks (fixes 6).** Every run checks for: contact patch at Z=0, upper ball joint above lower, ball
joints outboard of the pivots, hardpoints inside the wheel, a very short steering arm, degenerate rocker or
pushrod geometry, and pushrod angle. Each warning says what's likely wrong.

**G. Geometry view (fixes 11).** Front, side and top views of all links, the instant centers and the
roll center, added to `--plot` and the HTML report.

**H. Restructure and test (fixes 9, 10).** A small package `susp/` with config, kinematics, ride, loads,
output and tools modules. `susp_solver.py` stays the single command you run. `selftest` now runs the
KineSolver checks plus these physics checks:
- Statics balance to machine precision.
- Damper force from statics equals Fz / motion ratio from kinematics (virtual work). This ties the two halves
  of the code together.
- Equal parallel arms give zero camber change, roll camber = 1 and a roll center at the ground.
- Roll-sweep roll center at 0 deg equals the heave roll center.
- The suggested spring rate gives the target frequency.

## Deliberately NOT added (bloat for a team with no car)
GUI, tire model, compliance/bushings, lap simulation, a full 3D CAD viewer, and multi-link or MacPherson
layouts. Each is a large maintenance cost and won't change a first-year design decision.
Anti-roll bar *geometry* is also left out. The `car` command gives the *stiffness* you need, which is what
you design the bar to.

## Iteration 2 (after team questions)
- **Loads made traceable.** Each case shows how its wheel load is built. Inner-wheel cases are added (they flip
  the side force and can compress a different leg). The strength table now names what is compared: worst
  compression vs Euler load, and worst force vs yield force, with the material shown.
- **Spring geometry diagnostics.** Damper top-out and bottom-out against the damper's real eye-to-eye length and
  stroke, ride-height position in the stroke, rocker transmission angles, pushrod angle, rocker arm lengths, and
  clearance to the other side's damper.
- **Iteration tools.** `run --rocker-plot`, `sens --spring`, an `optimize` that accepts `spring.*` points and
  `>=`/`<=` goals, and `--keep-clear`.
- **First iteration of the rocker.** With a 200 x 57 mm damper the v1 layout sat at 18 % of stroke and topped out
  15 mm before full droop. v2 sits at 50 % with 3-4 mm margin at each end. The motion ratio goes from 0.86 to
  0.83 (+7 % rising), rocker rotation from 43 to 35 deg, and the worst transmission angle is 69 deg. The spring is
  50 N/mm for 3.5 Hz.
- **`car` balance-only advice.** When the springs already beat the roll-gradient target, it now says which bar
  (or spring change) fixes LLTD.
