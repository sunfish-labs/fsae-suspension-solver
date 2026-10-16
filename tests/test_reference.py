"""Validation tier 2: compare the solver against results from other tools or measurements.

    python3 tests/test_reference.py

Each file in validation/ (and private/validation/, which never leaves your computer) is one reference case:
a design and the numbers another source produced for it. Files starting with "_" are templates and are skipped.

    {
      "name": "...", "source": "where the numbers come from (tool, version, paper, rig test)",
      "design": "designs/example_front.json"   or   "config": { ...full design JSON... },
      "at_ride_height": {"camber_gain": [0.44, 0.02], "roll_center": [34.9, 1.0]},     metric: [value, tolerance]
      "curves": {"camber": [[-25, -2.6], [0, -1.5], [25, -0.6]]},  "curve_tol": {"camber": 0.05},
      "loads": {"bump": {"pushrod": [-1901.9, 0.5]}}          case: {member: [force N (+ tension), tolerance]}
    }

"at_ride_height" keys are solver metric names (see S.METRICS in ui/susp.js: camber_gain, roll_center, caster,
kpi, scrub, trail, bump_steer, fvsa, antidive, motion_ratio, ...). "curves" are [wheel travel mm, value] pairs
compared against the heave sweep (camber, toe, caster, kpi, scrub, trail, roll_center).
"""
import glob
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from susp.config import load_config, make_config  # noqa: E402
from susp.kinematics import evaluate  # noqa: E402
from susp.loads import run_loads  # noqa: E402

files = sorted(f for d in ("validation", os.path.join("private", "validation")) for f in glob.glob(os.path.join(ROOT, d, "*.json"))
               if not os.path.basename(f).startswith("_"))
if not files:
    print("No reference cases yet. Add one to validation/ (see validation/README.md).")
    sys.exit(0)
fails = total = 0
for f in files:
    case = json.load(open(f))
    cfg = load_config(os.path.join(ROOT, case["design"])) if "design" in case else make_config(case["config"])
    e = evaluate(cfg)
    print(f"\n{case.get('name', os.path.basename(f))}  ·  source: {case.get('source', '?')}")
    for k, (want, tol) in case.get("at_ride_height", {}).items():
        got = e["metrics"].get(k)
        ok = got is not None and abs(got - want) <= tol
        total += 1
        fails += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {k}: solver {got if got is None else round(got, 4)}, reference {want} ± {tol}")
    rows = e["rows"]
    x = np.array([r["dz"] for r in rows])
    for k, pts in case.get("curves", {}).items():
        tol = case.get("curve_tol", {}).get(k, 0.05)
        y = np.array([r[k] for r in rows])
        worst = max(abs(np.interp(dz, x, y) - v) for dz, v in pts)
        ok = worst <= tol
        total += 1
        fails += not ok
        print(f"  {'ok  ' if ok else 'FAIL'} {k} curve: largest difference {worst:.4g} over {len(pts)} points (tol {tol})")
    if case.get("loads"):
        res = run_loads(cfg, e["susp"], e["spring"])["results"]
        for cname, mem in case["loads"].items():
            worst, wk = 0.0, None
            for k, (want, tol) in mem.items():
                d = abs(float(res[cname][k]) - want) / tol
                if d >= worst:
                    worst, wk = d, k
            ok = worst <= 1.0
            total += 1
            fails += not ok
            print(f"  {'ok  ' if ok else 'FAIL'} {cname}: {len(mem)} member forces, worst {wk} at {worst:.3g} x its tolerance")
print(f"\n{total - fails} of {total} reference comparisons passed")
sys.exit(1 if fails else 0)
