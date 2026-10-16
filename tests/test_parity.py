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
    cases.append(raw)


def num(d):
    return {k: float(v) for k, v in d.items() if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)}


py = []
for raw in cases:
    try:
        c = finish_config(deep_merge(DEFAULTS, raw))
        e = evaluate(c)
        out = {"ok": True, "m": num(e["metrics"])}
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
