"""Check that the browser solver (ui/susp.js) matches the Python solver. Needs node on the PATH.

    python3 ui/test_port.py
"""
import glob
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import numpy as np
here = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(here)
sys.path.insert(0, root)
from susp.config import finish_config, deep_merge, DEFAULTS  # noqa: E402
from susp.kinematics import evaluate  # noqa: E402
from susp.loads import run_loads  # noqa: E402

if not shutil.which("node"):
    sys.exit("node is not installed - skip (the UI itself does not need node)")
files = sorted(glob.glob(os.path.join(root, "designs", "*.json")) + glob.glob(os.path.join(root, "designs", "case_study", "*.json")) + glob.glob(os.path.join(root, "private", "*.json")))
cfgs = {}
for f in files:
    raw = json.load(open(f))
    if isinstance(raw, dict) and "hardpoints" in raw:
        cfgs[os.path.relpath(f, root)] = raw
py = {}
for n, raw in cfgs.items():
    c = finish_config(deep_merge(DEFAULTS, raw))
    e = evaluate(c)
    m = {k: v for k, v in e["metrics"].items() if isinstance(v, (int, float)) and math.isfinite(v)}
    L = run_loads(c, e["susp"], e["spring"]) if e["spring"] else None
    py[n] = {"m": m, "loads": L["results"] if L else None,
             "bend": {k: float(v) for k, v in (L["bending_check"] or {}).items() if isinstance(v, (int, float, np.floating)) and math.isfinite(v)} if L else None,
             "comp": [[x["camber"], x["toe"], x["cp_y"]] for x in L["compliance"]["cases"]] if L else None,
             "parts": [float(r["sf_bolt"]) for r in L["parts"] if r["sf_bolt"] is not None and math.isfinite(r["sf_bolt"])] if L else None}
# whole-car balance from car files (front + rear + shared vehicle + anti-roll bars)
from susp.config import load_car  # noqa: E402
from susp.car import car_balance  # noqa: E402
cars = {}
for f in files:
    raw = json.load(open(f))
    if isinstance(raw, dict) and isinstance(raw.get("front"), dict) and isinstance(raw.get("rear"), dict) and "hardpoints" in raw["front"]:
        fc, rc, info = load_car(f)
        fe, re_ = evaluate(fc, steer=False, pack=False), evaluate(rc, steer=False, pack=False)
        cb = car_balance(fc, fe, rc, re_, None, None, info["arb_f"], info["arb_r"], info["car_targets"])
        cars[os.path.relpath(f, root)] = {"raw": raw, "py": {k: v for k, v in cb.items() if isinstance(v, (int, float)) and math.isfinite(v)}}
tmp = tempfile.mkdtemp()
json.dump({"cfgs": cfgs, "py": py, "cars": cars}, open(os.path.join(tmp, "d.json"), "w"))
js = r"""
require(process.argv[2]); const d = JSON.parse(require('fs').readFileSync(process.argv[3]));
let worst = 0, bad = [];
for (const [n, raw] of Object.entries(d.cfgs)) {
  const e = Susp.evaluate(raw), L = e.spring ? Susp.runLoads(e.cfg, e.susp, e.spring) : null, p = d.py[n];
  for (const [k, v] of Object.entries(p.m)) { const j = e.metrics[k]; if (j == null) { bad.push(n + ' missing ' + k); continue; }
    const r = Math.abs(j - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} ${k}: py ${v} js ${j}`); }
  if (p.loads) for (const [c, row] of Object.entries(p.loads)) for (const [k, v] of Object.entries(row)) {
    const r = Math.abs(L.results[c][k] - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} ${c} ${k}`); }
  if (p.bend) for (const [k, v] of Object.entries(p.bend)) { const r = Math.abs(L.bending_check[k] - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} bending ${k}: py ${v} js ${L.bending_check[k]}`); }
  if (p.comp) p.comp.forEach((row, i) => { const c = L.compliance.cases[i], j = [c.camber, c.toe, c.cp_y];
    row.forEach((v, q) => { const r = Math.abs(j[q] - v); worst = Math.max(worst, r); if (r > 1e-7) bad.push(`${n} compliance ${c.case} ${q}: py ${v} js ${j[q]}`); }); });
  if (p.parts) { const js = L.parts.map(q => q.sf_bolt).filter(v => v != null && isFinite(v)); p.parts.forEach((v, i) => { const r = Math.abs(js[i] - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} bolt ${i}`); }); }
}
for (const [n, c] of Object.entries(d.cars || {})) {
  const veh = c.raw.vehicle || {}, mk = (ax) => Object.assign({}, c.raw[ax], { axle: ax, vehicle: Object.assign({}, c.raw[ax].vehicle || {}, veh) });
  const fc = mk("front"), rc = mk("rear"), fe = Susp.evaluate(fc, { steer: false, pack: false }), re = Susp.evaluate(rc, { steer: false, pack: false });
  const cb = Susp.carBalance(fe.cfg, fe, re.cfg, re, { arbF: (c.raw.arb || {}).front || 0, arbR: (c.raw.arb || {}).rear || 0, targets: c.raw.car_targets });
  for (const [k, v] of Object.entries(c.py)) { const j = cb[k]; if (j == null) { bad.push(n + ' car missing ' + k); continue; }
    const r = Math.abs(j - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} car ${k}: py ${v} js ${j}`); }
}
console.log(`compared ${Object.keys(d.cfgs).length} designs and ${Object.keys(d.cars || {}).length} cars, worst relative difference ${worst.toExponential(1)}`);
if (bad.length) { console.log(bad.slice(0, 20).join('\n')); process.exit(1); } else console.log('BROWSER SOLVER MATCHES PYTHON');
"""
open(os.path.join(tmp, "t.js"), "w").write(js)
sys.exit(subprocess.call(["node", os.path.join(tmp, "t.js"), os.path.join(here, "susp.js"), os.path.join(tmp, "d.json")]))
