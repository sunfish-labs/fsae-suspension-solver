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
from susp.loads.parts import part_loads  # noqa: E402

subprocess.run([sys.executable, os.path.join(here, "build.py")], check=True, stdout=subprocess.DEVNULL)   # ui/susp.js is generated
if not shutil.which("node"):
    sys.exit("node is not installed - skip (the UI itself does not need node)")
files = sorted(glob.glob(os.path.join(root, "designs", "*.json")) + glob.glob(os.path.join(root, "designs", "case_study", "*.json")) + glob.glob(os.path.join(root, "private", "*.json")))
cfgs = {}
for f in files:
    raw = json.load(open(f))
    if isinstance(raw, dict) and "hardpoints" in raw:
        cfgs[os.path.relpath(f, root)] = raw
# the pushrod mount reinforced both ways
for tag, g in (("gusset", {"thickness": 3.0, "height": 30.0, "length_in": 120.0, "length_out": 30.0}), ("bracket", {"type": "to_node"})):
    raw = json.load(open(os.path.join(root, "designs", "example_front.json")))
    raw["members"]["gusset"] = g
    cfgs[f"example_front + {tag}"] = raw
# the pushrod on the upright (the other statics path)
raw = json.load(open(os.path.join(root, "designs", "example_front.json")))
raw["spring"]["rod_on"] = "upright"
raw["spring"]["rod_outboard"] = [a + b for a, b in zip(raw["hardpoints"]["lower_outboard"], [0.0, -15.0, 40.0])]
cfgs["example_front + pushrod on the upright"] = raw
# a one-plate 7075 rocker with its own pin size and default yield left out
raw = json.load(open(os.path.join(root, "designs", "example_rear.json")))
raw["members"]["rocker"] = {"thickness": 9.0, "plates": 1, "pivot_bore": 19.0, "pivot_edge": 16.0, "pin_dia": 10.0, "edge": 11.0, "width": 26.0}
cfgs["example_rear + one-plate rocker"] = raw
def fin(v):
    return float(v) if math.isfinite(v) else None       # JSON has no Infinity


py = {}
for n, raw in cfgs.items():
    c = finish_config(deep_merge(DEFAULTS, raw))
    e = evaluate(c)
    m = {k: v for k, v in e["metrics"].items() if isinstance(v, (int, float)) and math.isfinite(v)}
    L = run_loads(c, e["susp"], e["spring"]) if e["spring"] else None
    py[n] = {"m": m, "loads": L["results"] if L else None,
             "bend": {k: float(v) for k, v in (L["bending_check"] or {}).items() if isinstance(v, (int, float, np.floating)) and math.isfinite(v)} if L else None,
             "comp": [[x["camber"], x["toe"], x["cp_y"]] for x in L["compliance"]["cases"]] if L else None,
             "rocker": ([[k, v["case"], v["governs"], v["force"], v["sf"]] for k, v in L["rocker_check"]["holes"].items()]
                        + [[k, v["case"], "arm", v["moment"], v["sf"]] for k, v in L["rocker_check"]["arms"].items()]
                        + [["all", L["rocker_check"]["governs"], "", L["rocker_check"]["out_of_plane"], L["rocker_check"]["sf"]]])
             if L and L.get("rocker_check") else None,
             "parts": [float(r["sf_bolt"]) for r in L["parts"] if r["sf_bolt"] is not None and math.isfinite(r["sf_bolt"])] if L else None,
             "dur": [[fin(r["sf"]) for r in L["durability"]["tabs"]], [[fin(r["n"]), r["s_a"], r["allow"]] for r in L["durability"]["fatigue"]]] if L else None,
             "fea": [[cs, part, nm, *map(float, pt), *map(float, F)] for cs, parts in part_loads(c, e["susp"], e["spring"], L).items()
                     for part, items in parts.items() for nm, pt, F in items] if L else None}
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
        if info.get("layout_res"):
            lr = info["layout_res"]
            cars[os.path.relpath(f, root)]["layout"] = [lr["mass"], *lr["cg"], lr["weight_front"], lr["weight_left"], lr["Ixx"], lr["Iyy"], lr["Izz"]]
        from susp.rules import check_rules, rule_values, rulesets
        fe2, re2 = evaluate(fc), evaluate(rc)
        rv = rule_values(fc, fe2, rc, re2, cb, info.get("layout"), info.get("cockpit"))
        cars[os.path.relpath(f, root)]["rules"] = [[row["id"], row["status"], row["value"] if isinstance(row["value"], (int, float)) and not isinstance(row["value"], bool) else None]
                                                   for row in check_rules(rulesets()["fsae_2027_ic"], rv)]
        if info.get("drivetrain"):
            from susp.layout import accel_run
            ar = accel_run(info["drivetrain"], fc["vehicle"], rc["wheel"]["tire_radius"], fc["vehicle"]["wheelbase"])
            cars[os.path.relpath(f, root)]["accel"] = [ar["time"], ar["speed"], ar["grip_limited_to"], ar["top_speed"], *[s["t"] for s in ar["shifts"]]]
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
  if (p.rocker) { const R = L.rocker_check;
    if (!R) bad.push(`${n} rocker check missing in the browser`);
    else { const j = [...Object.entries(R.holes).map(([k, v]) => [k, v.case, v.governs, v.force, v.sf]), ...Object.entries(R.arms).map(([k, v]) => [k, v.case, "arm", v.moment, v.sf]), ["all", R.governs, "", R.out_of_plane, R.sf]];
      if (j.length !== p.rocker.length) bad.push(`${n} rocker rows: py ${p.rocker.length} js ${j.length}`);
      else p.rocker.forEach((row, i) => row.forEach((v, q) => { if (q < 3) { if (j[i][q] !== v) bad.push(`${n} rocker ${i} ${q}: py ${v} js ${j[i][q]}`); return; }
        const r = Math.abs(j[i][q] - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} rocker ${row[0]} ${q}: py ${v} js ${j[i][q]}`); })); } }
  if (p.comp) p.comp.forEach((row, i) => { const c = L.compliance.cases[i], j = [c.camber, c.toe, c.cp_y];
    row.forEach((v, q) => { const r = Math.abs(j[q] - v); worst = Math.max(worst, r); if (r > 1e-7) bad.push(`${n} compliance ${c.case} ${q}: py ${v} js ${j[q]}`); }); });
  if (p.dur) { const D = L.durability, ck = (a, b, w) => { if (a === null && !isFinite(b)) return; const r = Math.abs(a - b) / Math.max(1, Math.abs(a)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} ${w}: py ${a} js ${b}`); };
    p.dur[0].forEach((v, i) => ck(v, D.tabs[i].sf, `tab ${i}`)); p.dur[1].forEach((row, i) => row.forEach((v, q) => ck(v, [D.fatigue[i].n, D.fatigue[i].s_a, D.fatigue[i].allow][q], `fatigue ${D.fatigue[i].item} ${q}`))); }
  if (p.fea) { const F = Susp.partLoads(e.cfg, e.susp, e.spring, L), rows = [];
    for (const [c, parts] of Object.entries(F)) for (const [part, items] of Object.entries(parts)) for (const [nm, pt, f] of items) rows.push([c, part, nm, ...pt, ...f]);
    if (rows.length !== p.fea.length) bad.push(`${n} FEA rows: py ${p.fea.length} js ${rows.length}`);
    else p.fea.forEach((row, i) => row.forEach((v, q) => { if (q < 3) { if (rows[i][q] !== v) bad.push(`${n} FEA row ${i} ${q}: ${v} vs ${rows[i][q]}`); return; }
      const r = Math.abs(rows[i][q] - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} FEA ${row.slice(0, 3).join(" / ")} ${q}: py ${v} js ${rows[i][q]}`); })); }
  if (p.parts) { const js = L.parts.map(q => q.sf_bolt).filter(v => v != null && isFinite(v)); p.parts.forEach((v, i) => { const r = Math.abs(js[i] - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} bolt ${i}`); }); }
}
for (const [n, c] of Object.entries(d.cars || {})) {
  const veh = c.raw.vehicle || {}, mk = (ax) => Object.assign({}, c.raw[ax], { axle: ax, vehicle: Object.assign({}, c.raw[ax].vehicle || {}, veh) });
  const fc = mk("front"), rc = mk("rear");
  if (c.layout) { const lr = Susp.layoutMass(c.raw.layout, Susp.finishConfig(Susp.deepMerge(Susp.DEFAULTS, fc)), Susp.finishConfig(Susp.deepMerge(Susp.DEFAULTS, rc)), Susp.deepMerge(Susp.DEFAULTS.vehicle, fc.vehicle).wheelbase);
    const js = [lr.mass, ...lr.cg, lr.weight_front, lr.weight_left, lr.Ixx, lr.Iyy, lr.Izz];
    c.layout.forEach((v, q) => { const r = Math.abs(js[q] - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-9) bad.push(`${n} layout ${q}: py ${v} js ${js[q]}`); });
    if (c.raw.layout.apply) { fc.vehicle = Susp.applyLayout(fc.vehicle, lr); rc.vehicle = Susp.applyLayout(rc.vehicle, lr); } }
  const fe = Susp.evaluate(fc, { steer: false, pack: false }), re = Susp.evaluate(rc, { steer: false, pack: false });
  if (c.accel) { const ar = Susp.accelRun(c.raw.drivetrain, fe.cfg.vehicle, re.cfg.wheel.tire_radius, fe.cfg.vehicle.wheelbase), js = [ar.time, ar.speed, ar.grip_limited_to, ar.top_speed, ...ar.shifts.map(s => s.t)];
    if (js.length !== c.accel.length) bad.push(`${n} accel shifts: py ${c.accel.length} js ${js.length}`);
    c.accel.forEach((v, q) => { const r = Math.abs(js[q] - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-9) bad.push(`${n} accel ${q}: py ${v} js ${js[q]}`); }); }
  const cb = Susp.carBalance(fe.cfg, fe, re.cfg, re, { arbF: (c.raw.arb || {}).front || 0, arbR: (c.raw.arb || {}).rear || 0, targets: c.raw.car_targets });
  for (const [k, v] of Object.entries(c.py)) { const j = cb[k]; if (j == null) { bad.push(n + ' car missing ' + k); continue; }
    const r = Math.abs(j - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, r); if (r > 1e-6) bad.push(`${n} car ${k}: py ${v} js ${j}`); }
  if (c.rules) {
    const fe3 = Susp.evaluate(fc), re3 = Susp.evaluate(rc), rows = Susp.checkRules(Susp.RULESETS.fsae_2027_ic, Susp.ruleValues(fe3.cfg, fe3, re3.cfg, re3, cb, c.raw.layout || null, c.raw.cockpit || null));
    c.rules.forEach(([id, st, v], q) => { const r = rows[q]; if (!r || r.id !== id || r.status !== st) { bad.push(`${n} rule ${id}: py ${st} js ${r && r.status}`); return; }
      if (v != null) { const d = Math.abs(r.value - v) / Math.max(1, Math.abs(v)); worst = Math.max(worst, d); if (d > 1e-6) bad.push(`${n} rule ${id} value: py ${v} js ${r.value}`); } }); }
}
console.log(`compared ${Object.keys(d.cfgs).length} designs and ${Object.keys(d.cars || {}).length} cars, worst relative difference ${worst.toExponential(1)}`);
if (bad.length) { console.log(bad.slice(0, 20).join('\n')); process.exit(1); } else console.log('BROWSER SOLVER MATCHES PYTHON');
"""
open(os.path.join(tmp, "t.js"), "w").write(js)
sys.exit(subprocess.call(["node", os.path.join(tmp, "t.js"), os.path.join(here, "susp.js"), os.path.join(tmp, "d.json")]))
