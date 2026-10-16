"""Randomized parity: the browser solver (ui/susp.js) and the Python solver must agree on every metric, every load
result and every compliance output, for ~200 designs made by moving every hardpoint of the example designs by up to
±15 mm (fixed seed). Where one side can't solve a design, the other must fail too. Run from the repo root:
    python3 tests/test_parity.py [--cases 200] [--seed 7]
Needs node."""
import argparse
import copy
import glob
import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from susp.config import DEFAULTS, deep_merge, finish_config  # noqa: E402
from susp.kinematics import evaluate  # noqa: E402
from susp.loads import run_loads  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--cases", type=int, default=200)
ap.add_argument("--seed", type=int, default=7)
ap.add_argument("--move", type=float, default=15.0)
a = ap.parse_args()
subprocess.run([sys.executable, os.path.join(ROOT, "ui", "build.py")], check=True, stdout=subprocess.DEVNULL)   # ui/susp.js is generated
if not shutil.which("node"):
    sys.exit("node is not installed")

bases = []
for f in sorted(glob.glob(os.path.join(ROOT, "designs", "*.json")) + glob.glob(os.path.join(ROOT, "designs", "case_study", "*.json"))):
    raw = json.load(open(f))
    if isinstance(raw.get("hardpoints"), dict):
        bases.append(raw)
    elif isinstance(raw.get("front"), dict):                      # car file: both corners, with the shared vehicle
        for ax in ("front", "rear"):
            c = dict(raw[ax], axle=ax)
            c["vehicle"] = deep_merge(c.get("vehicle") or {}, raw.get("vehicle") or {})
            bases.append(c)
rng = random.Random(a.seed)
cases = []
for i in range(a.cases):
    raw = copy.deepcopy(bases[i % len(bases)])
    for p in raw["hardpoints"].values():
        for j in range(3):
            p[j] = round(p[j] + rng.uniform(-a.move, a.move), 3)
    if raw.get("spring"):
        for k in ("rod_outboard", "rocker_pivot", "rocker_rod", "rocker_damper", "damper_chassis"):
            if raw["spring"].get(k):
                raw["spring"][k] = [round(v + rng.uniform(-a.move / 3, a.move / 3), 3) for v in raw["spring"][k]]
    raw["hardpoints"]["contact_patch"][2] = 0.0                   # keep the tire on the ground
    # exercise the optional features on some of the cases
    cp = raw["hardpoints"]["contact_patch"]
    R = (raw.get("wheel") or {}).get("tire_radius", 254.0)
    if i % 3 == 1:
        raw["sweep"] = dict(raw.get("sweep") or {}, droop_travel=round(rng.uniform(18, 30), 1), bump_travel=round(rng.uniform(22, 35), 1))
    if i % 4 == 2:
        raw["wheel"] = dict(raw.get("wheel") or {}, caliper={"clock_deg": rng.uniform(0, 180), "radius": rng.uniform(90, 120),
                                                             "size": rng.uniform(40, 70), "offset": rng.uniform(-30, 0)},
                            rim_inner_radius=rng.uniform(140, 155))
        raw["vehicle"] = dict(raw.get("vehicle") or {}, aero_front=rng.uniform(200, 800), aero_rear=rng.uniform(200, 800),
                              rack_c_factor=rng.uniform(70, 110))
        raw["members"] = dict(raw.get("members") or {}, rack_k=rng.uniform(8000, 20000), column_k=rng.uniform(5, 20))
    if raw.get("axle") == "rear" and i % 2 == 0:
        raw["halfshaft"] = {"diff_output": [cp[0] + rng.uniform(-10, 10), rng.uniform(120, 180), R - rng.uniform(0, 30)],
                            "cv_outboard": [cp[0], cp[1] - rng.uniform(50, 80), R], "plunge_max": 20}
    if i % 7 == 5 and raw.get("spring"):
        # a direct-acting damper on the same arm
        spg = dict(raw["spring"], rocker_pivot=None, rocker_axis=None, rocker_rod=None, rocker_damper=None)
        ro = spg["rod_outboard"]
        spg["damper_chassis"] = [ro[0], ro[1] - 60.0, ro[2] + 280.0]
        raw["spring"] = spg
    if raw.get("spring") and i % 6 in (1, 4):
        # dual-rate spring and/or progressive bump stop
        spg = dict(raw["spring"])
        if i % 6 == 1:
            spg.update(spring_rate2=round(spg["spring_rate"] * rng.uniform(1.2, 1.8), 1), spring_breakpoint=round(rng.uniform(2, 15), 1))
        spg.update(bumpstop_gap=round(rng.uniform(-2, 25), 1), bumpstop_k=round(rng.uniform(30, 150), 1), bumpstop_k2=round(rng.uniform(0, 10), 2))
        raw["spring"] = spg
    if raw.get("spring") and i % 4 == 1:
        # an anti-roll bar on its own drop link: on the lower arm, or on the rocker when there is one
        hp = raw["hardpoints"]
        mid = [(a + b) / 2 for a, b in zip(hp["lower_inboard_front"], hp["lower_inboard_rear"])]
        on_rocker = raw["spring"].get("rocker_pivot") is not None and i % 8 == 5
        lo = ([raw["spring"]["rocker_damper"][0] + 20, raw["spring"]["rocker_damper"][1], raw["spring"]["rocker_damper"][2]] if on_rocker
              else [m + 0.5 * (b - m) + (40 if j == 0 else 0) for j, (m, b) in enumerate(zip(mid, hp["lower_outboard"]))])
        tip = [lo[0], lo[1] - 40, lo[2] + (-120 if on_rocker else 180)]
        raw["arb"] = {"link_on": "rocker" if on_rocker else "lower", "link_outboard": lo, "arm_tip": tip,
                      "bar_pivot": [tip[0] + rng.uniform(90, 140), tip[1], tip[2]], "bar_od": round(rng.uniform(8, 16), 2),
                      "bar_wall": None if i % 3 else 1.2, "bar_length": round(rng.uniform(400, 700))}
    if i % 5 == 3:
        raw["joints"] = {"trackrod_outboard": {"bolt": "x"}, "upper_inboard_front": {"bolt": "pivot", "square": False},
                         "lower_outboard": {"bolt": [1.0, 0.2, 0.1]}, "trackrod_inboard": {"allow": 9.5}}
    cases.append(raw)


def num(d):
    return {k: float(v) for k, v in d.items() if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)}


py = []
for raw in cases:
    try:
        c = finish_config(deep_merge(DEFAULTS, raw))
        e = evaluate(c)
        out = {"ok": True, "m": num(e["metrics"])}
        out["joints"] = [[r["ride"], r["worst"], r["margin"], r["best"]["worst"] if r["best"] else None] for r in e["joints"]["rows"]]
        if e["spring"]:
            L = run_loads(c, e["susp"], e["spring"])
            out["loads"] = {n: num(r) for n, r in L["results"].items()}
            out["comp"] = [[x["camber"], x["toe"], x["cp_y"]] for x in L["compliance"]["cases"]]
            out["bend"] = num(L["bending_check"] or {})
            out["checks"] = [[r["sf_buckle"], r["sf_yield"]] for r in L["checks"]]
        py.append(out)
    except Exception as ex:                                       # noqa: BLE001 - any failure must also fail in JS
        py.append({"ok": False, "err": f"{type(ex).__name__}: {ex}"})

tmp = tempfile.mkdtemp()
json.dump({"cases": cases, "py": py}, open(os.path.join(tmp, "d.json"), "w"))
js = r"""
require(process.argv[2]); const d = JSON.parse(require('fs').readFileSync(process.argv[3]));
const fin = (v) => typeof v === "number" && isFinite(v);
let worst = 0, worstAt = "", bad = [], nboth = 0, nfail = 0;
const cmp = (i, what, a, b) => { if (!fin(a) || !fin(b)) { if (fin(a) !== fin(b)) bad.push(`case ${i} ${what}: py ${a} js ${b}`); return; }
  const r = Math.abs(a - b) / Math.max(1, Math.abs(a)); if (r > worst) { worst = r; worstAt = `case ${i} ${what}`; } if (r > 1e-6) bad.push(`case ${i} ${what}: py ${a} js ${b}`); };
d.cases.forEach((raw, i) => {
  const p = d.py[i]; let e = null, L = null, err = null;
  try { e = Susp.evaluate(raw); if (e.spring) L = Susp.runLoads(e.cfg, e.susp, e.spring); } catch (x) { err = x.message; }
  if (!p.ok || err) { if (p.ok !== !err) bad.push(`case ${i}: python ${p.ok ? "solved" : "failed (" + p.err + ")"}, browser ${err ? "failed (" + err + ")" : "solved"}`); else nfail++; return; }
  nboth++;
  for (const [k, v] of Object.entries(p.m)) cmp(i, k, v, e.metrics[k]);
  if (p.joints.length !== e.joints.rows.length) bad.push(`case ${i}: ${p.joints.length} joints in python, ${e.joints.rows.length} in the browser`);
  p.joints.forEach((row, j) => { const r = e.joints.rows[j]; if (!r) return; [r.ride, r.worst, r.margin, r.best ? r.best.worst : null].forEach((v, q) => { if (row[q] !== null) cmp(i, `joint ${r.key} ${["ride", "worst", "margin", "best"][q]}`, row[q], v); }); });
  if (p.loads) for (const [n, row] of Object.entries(p.loads)) for (const [k, v] of Object.entries(row)) cmp(i, `${n}/${k}`, v, L.results[n][k]);
  if (p.comp) p.comp.forEach((row, j) => { const c = L.compliance.cases[j]; [c.camber, c.toe, c.cp_y].forEach((v, q) => cmp(i, `compliance ${c.case} ${q}`, row[q], v)); });
  if (p.bend) for (const [k, v] of Object.entries(p.bend)) cmp(i, `bending ${k}`, v, L.bending_check[k]);
  if (p.checks) p.checks.forEach(([b, y], j) => { cmp(i, `buckling FOS ${j}`, b, L.checks[j].sf_buckle); cmp(i, `yield FOS ${j}`, y, L.checks[j].sf_yield); });
});
console.log(`${d.cases.length} random designs: ${nboth} solved in both, ${nfail} rejected by both; worst relative difference ${worst.toExponential(2)} (${worstAt})`);
if (bad.length) { console.log(bad.slice(0, 25).join("\n")); console.log(`${bad.length} mismatches`); process.exit(1); }
console.log("RANDOMIZED PARITY: PYTHON AND BROWSER AGREE");
"""
open(os.path.join(tmp, "t.js"), "w").write(js)
sys.exit(subprocess.call(["node", os.path.join(tmp, "t.js"), os.path.join(ROOT, "ui", "susp.js"), os.path.join(tmp, "d.json")]))
