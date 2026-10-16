# Validation references

Every `*.json` file here (not starting with `_`) is a design plus the numbers some *other* source produced
for it. `python3 tests/test_reference.py` compares the solver against each one, and GitHub runs it on every push.

Good sources, best first:
1. **Measurements on your car**, such as camber and toe change on a bump rig, or ride height under known loads.
2. **Another kinematics tool** (KineSolver, OptimumKinematics, Lotus, Adams/Car) run on the same hardpoints.
3. **Published work** that lists *both* the full hardpoints *and* numerical results for them.

To add one, copy `_template.json`, enter the design (a path or the full JSON) and the reference values with a
tolerance, and say where the numbers came from in `source`. Keep team geometry in `private/validation/`
instead: it is checked locally but never published.

Status (October 2026): on three private KineSolver cases (two front corners, one rear), every compared value
(camber, caster, KPI, toe, roll center, anti-dive/squat/lift at full bump and droop) agrees within about 0.06 mm
and 0.04°, which is the precision KineSolver's charts display (`susp_solver.py selftest` with `private/`), and
22 hand-calculation checks pass (`tests/test_analytic.py`).
No public source found so far publishes complete hardpoints together with numerical results for them.
Until one turns up, this folder holds independent references that share no code with the parts of the solver
they check (regenerate them with the scripts in `tools/`; CI checks they are up to date). To check against your own
car, see **[MEASURING.md](MEASURING.md)**: five shop-tool tests and a script that turns the readings into a case.

- `planar_fourbar.json`: a double wishbone whose upright moves only in the front-view plane, solved as a 2D
  four-bar linkage in closed form. Camber, contact-patch position and toe are compared every 5 mm from -30 to
  +30 mm; they agree to about 1e-10.
- `loads_handcalc.json`: member forces in the bump, cornering (outer and inner), pothole and kerb cases for a
  corner with horizontal arms and a vertical damper, worked by hand statics. Every member agrees to 1e-6 relative.
- `stiffness_*.json` (5 corners: the example front and rear, and the front with the rod on the upright, a pullrod
  on the upper wishbone, and a damper acting directly on the wishbone): member forces in every load case,
  deflected cases included, from a displacement-method model (rigid parts on stiff joints, solved like a
  finite-element program). The solver uses equilibrium instead. Every statically determinate force agrees to
  about 1e-9 relative. The two legs of the arm that carries the rod are left out: how they share the load along
  the pivot axis depends on stiffness, and the solver reports an assumed split.
- `car_*.json` (3 cars): roll gradient, LLTD, load transfer per wheel and the twist-test stiffness from a
  springs-and-masses matrix model of the whole car. Agree to 1e-9. This check found that the closed-form roll
  gradient left out the tires squashing under the load transfer that goes through the roll centers (about 10 %
  less roll on the example cars); fixed in 1.4.0.

Known simplification found by these checks, not changed: the wheel rate is spring rate x motion ratio squared. The
spring's preload times the motion ratio's change with travel adds about 1.7 % (example front) and 1.4 % (example
rear) at ride height; a bench measurement of wheel rate includes it.
