# Changelog

Versions follow [semantic versioning](https://semver.org/). Each release is a git tag (`v1.0.0`); the version is
also in `pyproject.toml`.

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

## 0.9.0 - 2026-10-15

The first complete version: the command-line tool and web app with heave, roll and steering sweeps, ride and
damping, member loads and compliance, packaging, the whole-car view, challenges, Compare, reports, Excel and the
3D-for-CAD export (IGES, STEP, CSV, STL).
