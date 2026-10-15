"""Check that the browser solver (ui/susp.js) matches the Python solver. Needs node on the PATH.

    python3 ui/test_port.py
"""
import json, math, os, shutil, subprocess, sys, tempfile
here = os.path.dirname(os.path.abspath(__file__)); root = os.path.dirname(here)
sys.path.insert(0, root)
from susp.config import load_config, TEMPLATE_REAR, finish_config, deep_merge, DEFAULTS  # noqa: E402
from susp.kinematics import evaluate  # noqa: E402
from susp.loads import run_loads  # noqa: E402

if not shutil.which("node"):
    sys.exit("node is not installed - skip (the UI itself does not need node)")
import glob
files = sorted(glob.glob(os.path.join(root, "designs", "*.json")) + glob.glob(os.path.join(root, "designs", "case_study", "*.json")) + glob.glob(os.path.join(root, "private", "*.json")))
cfgs = {}
for f in files:
    raw = json.load(open(f))
    if isinstance(raw, dict) and "hardpoints" in raw:
        cfgs[os.path.relpath(f, root)] = raw
py = {}
for n, raw in cfgs.items():
    c = finish_config(deep_merge(DEFAULTS, raw)); e = evaluate(c)
    m = {k: v for k, v in e["metrics"].items() if isinstance(v, (int, float)) and math.isfinite(v)}
    L = run_loads(c, e["susp"], e["spring"]) if e["spring"] else None
    py[n] = {"m": m, "loads": L["results"] if L else None}
tmp = tempfile.mkdtemp()
json.dump({"cfgs": cfgs, "py": py}, open(os.path.join(tmp, "d.json"), "w"))
js = r"""
require(process.argv[2]); const d = JSON.parse(require('fs').readFileSync(process.argv[3]));
let worst = 0, bad = [];
for (const [n, raw] of Object.entries(d.cfgs)) {
  const e = Susp.evaluate(raw), L = e.spring ? Susp.runLoads(e.cfg, e.susp, e.spring) : null, p = d.py[n];
  for (const [k, v] of Object.entries(p.m)) { const j = e.metrics[k]; if (j == null) { bad.push(n + ' missing ' + k); continue; }
    const r = Math.abs(j - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} ${k}: py ${v} js ${j}`); }
  if (p.loads) for (const [c, row] of Object.entries(p.loads)) for (const [k, v] of Object.entries(row)) {
    const r = Math.abs(L.results[c][k] - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} ${c} ${k}`); }
}
console.log(`compared ${Object.keys(d.cfgs).length} designs, worst relative difference ${worst.toExponential(1)}`);
if (bad.length) { console.log(bad.slice(0, 20).join('\n')); process.exit(1); } else console.log('BROWSER SOLVER MATCHES PYTHON');
"""
open(os.path.join(tmp, "t.js"), "w").write(js)
sys.exit(subprocess.call(["node", os.path.join(tmp, "t.js"), os.path.join(here, "susp.js"), os.path.join(tmp, "d.json")]))
