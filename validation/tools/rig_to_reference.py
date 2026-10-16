"""Turn bench or car measurements into a reference case for tests/test_reference.py.

    python3 validation/tools/rig_to_reference.py sweep.csv --design private/our_front.json \\
        --source "bump test, 2026-11-02, digital inclinometer" > private/validation/bump_test.json

sweep.csv: one row per wheel position, a header naming the columns. The first column is wheel travel in mm
(+ = bump, measured at the hub or the contact patch); the others may be any of
    camber (deg), toe (deg), caster (deg), damper_len (mm, eye to eye), cp_y (mm, track change)
Blank cells are skipped. Lines starting with # are ignored.

Options
  --relative         compare changes from ride height instead of absolute values (for when the static camber, toe
                     or the damper's eye positions on your rig are not exactly the design's)
  --at KEY=VALUE     a single number at ride height, e.g. --at wheel_rate=33.1 --at static_spring_force=640
                     (any solver metric: motion_ratio, wheel_rate, static_spring_force, camber_gain, roll_center ...)
  --tol KEY=TOL      tolerance for a column or metric; defaults below are typical hand-tool precision
See validation/MEASURING.md for the tests themselves."""
import argparse
import csv
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)

TOL = {"camber": 0.1, "toe": 0.05, "caster": 0.1, "damper_len": 0.5, "cp_y": 1.0, "wheel_rate": 2.0,
       "static_spring_force": 40.0, "motion_ratio": 0.02, "camber_gain": 0.03, "roll_center": 10.0}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv")
    ap.add_argument("--design", required=True, help="the design file the rig was built to")
    ap.add_argument("--name", default=None)
    ap.add_argument("--source", default="measurement")
    ap.add_argument("--relative", action="store_true")
    ap.add_argument("--at", action="append", default=[], metavar="KEY=VALUE")
    ap.add_argument("--tol", action="append", default=[], metavar="KEY=TOL")
    a = ap.parse_args(argv)
    tol = dict(TOL, **{k: float(v) for k, v in (s.split("=", 1) for s in a.tol)})
    with open(a.csv, newline="") as f:
        rows = [r for r in csv.reader(f) if r and not r[0].lstrip().startswith("#")]
    head = [h.strip() for h in rows[0]]
    cols = {h: [] for h in head[1:]}
    for r in rows[1:]:
        z = float(r[0])
        for h, v in zip(head[1:], r[1:]):
            if v.strip():
                cols[h].append([z, float(v)])
    if a.relative:
        from susp.config import load_config
        from susp.kinematics import evaluate
        import numpy as np
        e = evaluate(load_config(a.design), steer=False, pack=False)
        x = np.array([r["dz"] for r in e["rows"]])
        for h, pts in cols.items():
            at0 = [v for z, v in pts if abs(z) < 1e-9]
            if not at0:
                sys.exit(f"--relative needs a reading at 0 mm (ride height) for {h}")
            sol0 = float(np.interp(0.0, x, [r[h] for r in e["rows"]]))
            cols[h] = [[z, round(v - at0[0] + sol0, 6)] for z, v in pts]
    out = {"name": a.name or os.path.splitext(os.path.basename(a.csv))[0], "source": a.source + (" (changes from ride height)" if a.relative else ""),
           "design": os.path.relpath(os.path.abspath(a.design), ROOT),
           "at_ride_height": {k: [float(v), tol.get(k, abs(float(v)) * 0.05)] for k, v in (s.split("=", 1) for s in a.at)},
           "curves": {h: p for h, p in cols.items() if p}, "curve_tol": {h: tol.get(h, 0.1) for h in cols}}
    json.dump(out, sys.stdout, indent=1)
    print()


if __name__ == "__main__":
    main()
