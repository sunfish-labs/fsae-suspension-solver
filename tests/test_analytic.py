"""Validation tier 1: cases whose answers are known exactly from geometry or physics, independent of the solver.

    python3 tests/test_analytic.py

Each check builds a simple suspension where the right answer can be worked out by hand (or must hold by
equilibrium), runs the solver, and compares. These guard against math errors in the solver itself.
"""
import copy
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from susp.config import TEMPLATE_FRONT, make_config  # noqa: E402
from susp.kinematics import evaluate  # noqa: E402
from susp.loads import run_loads, tube_props  # noqa: E402
from susp.car import car_balance  # noqa: E402

results = []


def check(name, got, want, tol, how):
    ok = abs(got - want) <= tol
    results.append((ok, name, got, want, tol, how))
    print(f"  {'ok  ' if ok else 'FAIL'} {name}: solver {got:.6g}, expected {want:.6g} (tol {tol:g})  [{how}]")


def corner(hp=None, spring=None, base=TEMPLATE_FRONT, **kw):
    c = copy.deepcopy(base)
    if hp:
        c["hardpoints"].update(hp)
    c["spring"] = spring
    c.update(kw)
    return make_config(c)


# A parallelogram: equal, parallel, horizontal arms in one plane, tie rod parallel to them and the same length.
PAR = {"upper_inboard_front": [-200, 250, 330], "upper_inboard_rear": [200, 250, 330],
       "lower_inboard_front": [-200, 250, 130], "lower_inboard_rear": [200, 250, 130],
       "upper_outboard": [0, 560, 330], "lower_outboard": [0, 560, 130],
       "trackrod_inboard": [-70, 250, 230], "trackrod_outboard": [-70, 560, 230], "contact_patch": [0, 610, 0]}

print("\n1. Parallelogram (equal parallel arms): the upright translates without rotating")
e = evaluate(corner(PAR))
m, T = e["metrics"], e["rows"][-1]["dz"]
L = 310.0
check("camber gain", m["camber_gain"], 0.0, 1e-9, "upright does not rotate")
check("bump steer", m["bump_steer"], 0.0, 1e-9, "tie rod parallel and equal to the arms")
check("roll center height", m["roll_center"], 0.0, 1e-9, "arms parallel to the ground: RC on the ground")
check("anti-dive", m["antidive"], 0.0, 1e-9, "side-view pivot axes horizontal: no anti")
check("track change over the travel, mm", m["track_change"], L - math.sqrt(L * L - T * T), 1e-6, "arc of a 310 mm arm: L - sqrt(L^2 - dz^2)")

print("\n2. Roll center and swing arm by front-view construction")
hp = dict(PAR, upper_inboard_front=[-200, 280, 315], upper_inboard_rear=[200, 280, 315], upper_outboard=[0, 560, 345],
          lower_inboard_front=[-200, 220, 125], lower_inboard_rear=[200, 220, 125], lower_outboard=[0, 560, 128])
e = evaluate(corner(hp))
m = e["metrics"]


def cross2(p1, p2, q1, q2):            # intersection of lines p1-p2 and q1-q2 in the (y, z) plane
    d1, d2, w = np.subtract(p2, p1), np.subtract(q2, q1), np.subtract(q1, p1)
    def c(a, b):
        return a[0] * b[1] - a[1] * b[0]
    t = c(w, d2) / c(d1, d2)
    return np.add(p1, t * d1)


ic = cross2([280, 315], [560, 345], [220, 125], [560, 128])
cpy = 610.0
check("front-view swing arm, mm", m["fvsa"], abs(cpy - ic[0]), 1e-6, "contact patch to the crossing of the extended arms")
check("roll center height, mm", m["roll_center"], ic[1] * cpy / (cpy - ic[0]), 1e-6, "line contact patch -> instant center, at the centerline")

print("\n3. Steering-axis geometry from the ball-joint coordinates")
hp = dict(PAR, upper_outboard=[-20, 545, 335], lower_outboard=[6, 575, 125])
e = evaluate(corner(hp, wheel=dict(TEMPLATE_FRONT["wheel"], camber_deg=0.0, toe_deg=0.0)))
m = e["metrics"]
ub, lb, cp = np.array([-20, 545, 335.0]), np.array([6, 575, 125.0]), np.array([0, 610, 0.0])
dz = ub[2] - lb[2]
k = (ub - lb) / np.linalg.norm(ub - lb)
g = lb + k * (cp[2] - lb[2]) / k[2]              # steering axis meets the ground
check("caster, deg", m["caster"], math.degrees(math.atan2(lb[0] - ub[0], dz)), 1e-6, "atan(rearward lean of the axis / height)")
check("KPI, deg", m["kpi"], math.degrees(math.atan2(lb[1] - ub[1], dz)), 1e-6, "atan(inward lean of the axis / height)")
check("scrub radius, mm", m["scrub"], cp[1] - g[1], 1e-6, "contact patch to axis ground point, sideways")
check("mechanical trail, mm", m["trail"], g[0] - cp[0], 1e-6, "axis ground point ahead of the contact patch")

print("\n4. Rigid links keep their length through the whole bump sweep")
e = evaluate(corner())
h = e["susp"].h
worst = 0.0
for r in e["rows"]:
    p = r["_pts"]
    pairs = [(h["uif"], p["ub"]), (h["uir"], p["ub"]), (h["lif"], p["lb"]), (h["lir"], p["lb"]), (p["tri"], p["tro"]), (p["ub"], p["lb"]), (p["ub"], p["tro"]), (p["lb"], p["tro"])]
    r0 = e["rows"][len(e["rows"]) // 2]["_pts"]
    ref = [(h["uif"], r0["ub"]), (h["uir"], r0["ub"]), (h["lif"], r0["lb"]), (h["lir"], r0["lb"]), (r0["tri"], r0["tro"]), (r0["ub"], r0["lb"]), (r0["ub"], r0["tro"]), (r0["lb"], r0["tro"])]
    for (a, b), (c, d) in zip(pairs, ref):
        worst = max(worst, abs(np.linalg.norm(np.subtract(a, b)) - np.linalg.norm(np.subtract(c, d))))
check("largest change in any link length, mm", worst, 0.0, 1e-6, "links are rigid")

print("\n5. Motion ratio of a direct-acting damper on the parallelogram")
a, b = 186.0, 310.0                               # damper mount 186 mm and ball joint 310 mm from the lower pivot axis
damper = dict(rod_on="lower", rod_outboard=[0, 250 + a, 130], rocker_pivot=None, rocker_axis=None, rocker_rod=None, rocker_damper=None,
              damper_chassis=[0, 250 + a, 450], spring_rate=50.0, unsprung_mass=10.0, tire_rate=150.0, damper_stroke=None, damper_eye_to_eye=None, target_freq_hz=None)
e = evaluate(corner(PAR, damper))
check("motion ratio, vertical damper", e["metrics"]["motion_ratio"], a / b, 1e-6, "lever ratio a/b")
check("wheel rate, N/mm", e["metrics"]["wheel_rate"], 50.0 * (a / b) ** 2, 1e-6, "spring rate x MR^2")
tilt = dict(damper, damper_chassis=[0, 250 + a - 100, 130 + 300])
e = evaluate(corner(PAR, tilt))
check("motion ratio, damper tilted 18.4 deg", e["metrics"]["motion_ratio"], a / b * 300 / math.hypot(100, 300), 1e-5, "lever ratio x cos(tilt); the solver takes the slope over the sweep, so ~1e-6 agreement")
kr = 1 / (1 / (50.0 * (a / b) ** 2 * (300 / math.hypot(100, 300)) ** 2) + 1 / 150.0)
check("ride rate with the tire, N/mm", e["metrics"]["ride_rate"], kr, 1e-3, "wheel rate and tire rate in series")
veh = corner(PAR, tilt)["vehicle"]
m_sprung = veh["mass"] * veh["weight_front"] / 2 - 10.0
check("spring force at ride height, N", e["metrics"]["static_spring_force"], m_sprung * 9.81 / e["metrics"]["motion_ratio"], 1e-9,
      "sprung corner weight / MR (the unsprung mass sits on the tire, not the spring)")

dmp = dict(damper, damper_bump_low=2000.0, damper_rebound_high=1500.0)
e = evaluate(corner(PAR, dmp))
ms, mu = e["ride"]["_m_sprung"], 10.0
kr = 1 / (1 / (50.0 * (a / b) ** 2) + 1 / 150.0)
check("critical damping, body, N s/m", e["ride"]["c_crit"], 2 * math.sqrt(kr * 1000 * ms), 1e-6, "2 sqrt(k_ride m_sprung)")
check("damping ratio, bump low-speed", e["ride"]["zeta_bump_low"], 2000.0 * (a / b) ** 2 / (2 * math.sqrt(kr * 1000 * ms)), 1e-9, "c MR^2 / c_crit")
check("critical damping, wheel hop, N s/m", e["ride"]["c_crit_hop"], 2 * math.sqrt((50.0 * (a / b) ** 2 + 150.0) * 1000 * mu), 1e-6, "2 sqrt((k_wheel + k_tire) m_unsprung)")

print("\n6. Statics: member forces hold the upright in equilibrium (pushrod on the upright)")
up = dict(TEMPLATE_FRONT["spring"], rod_on="upright", rod_outboard=[0, 520, 150])
cfg = corner(spring=up)
cfg6 = cfg
e = evaluate(cfg)
L6 = run_loads(cfg, e["susp"], e["spring"])
from susp.loads import _geometry, MEMBERS, load_cases  # noqa: E402
pts, inb, outb, st = _geometry(e["susp"], e["spring"])
worst_f = worst_m = 0.0
for name, forces, *_ in load_cases(cfg, e["susp"])[0]:
    res = L6["results"][name]
    F = sum(f for f, _ in forces) + sum(res[k] * (inb[k] - outb[k]) / np.linalg.norm(inb[k] - outb[k]) for k in MEMBERS)
    M = sum(np.cross(pts[p], f) for f, p in forces) + sum(np.cross(outb[k], res[k] * (inb[k] - outb[k]) / np.linalg.norm(inb[k] - outb[k])) for k in MEMBERS)
    worst_f, worst_m = max(worst_f, np.linalg.norm(F)), max(worst_m, np.linalg.norm(M))
check("largest force imbalance on the upright, N", worst_f, 0.0, 1e-6, "sum of forces = 0")
check("largest moment imbalance on the upright, N mm", worst_m, 0.0, 1e-3, "sum of moments = 0")
chk = L6["checks"][0]
A, Imom = tube_props(chk["od"], chk["wall"])
check("Euler buckling load of a wishbone leg, N", chk["Pcr"], math.pi ** 2 * cfg["members"]["E"] * Imom / chk["length"] ** 2, 1e-6, "pi^2 E I / L^2, pinned ends")

print("\n6b. Bolt shear and pushrod-mount bending (textbook formulas)")
cfgb = corner(spring=dict(TEMPLATE_FRONT["spring"]))
eb = evaluate(cfgb)
Lb = run_loads(cfgb, eb["susp"], eb["spring"])
mem = cfgb["members"]
check("bolt shear capacity (5/16 in SAE 8, double shear), N", Lb["parts"][0]["bolt_capacity"], 2 * math.pi / 4 * 7.94 ** 2 * 0.6 * 1034.0, 1e-6, "planes x area x 0.6 x tensile strength")
bc = Lb["bending_check"]
A, Imom = tube_props(*mem["wishbone"])
check("pushrod-mount bending moment, N mm", bc["moment"], bc["P_perp"] * bc["a"] * (bc["length"] - bc["a"]) / bc["length"], 1e-6, "simply supported beam: P a b / L")
check("pushrod-mount leg FOS", bc["sf"], mem["yield"] / bc["stress"], 1e-9, "yield / (M c / I + axial / A)")

print("\n6b2. The wishbone carrying the pushrod, solved as one rigid body")
from susp.loads import arm_reactions, run_loads as _rl, load_cases as _lc  # noqa: E402
rng = np.random.default_rng(3)
worst_f = worst_m = worst_ax = 0.0
for _ in range(20):
    p1, p2 = rng.uniform(-300, 300, 3), rng.uniform(-300, 300, 3)
    node, mount = rng.uniform(200, 600, 3), rng.uniform(200, 600, 3)
    u = (p2 - p1) / np.linalg.norm(p2 - p1)
    Fn, dirm = rng.uniform(-3000, 3000, 3), rng.uniform(-1, 1, 3)
    # scale the mount force so the arm has no moment about its pivot axis (that is what fixes the pushrod force)
    Fm = dirm * -(u @ np.cross(node - p1, Fn)) / (u @ np.cross(mount - p1, dirm))
    Fsum, Mext = Fn + Fm, np.cross(node - p1, Fn) + np.cross(mount - p1, Fm)
    e1, e2 = (p1 - node) / np.linalg.norm(p1 - node), (p2 - node) / np.linalg.norm(p2 - node)
    R1, R2 = arm_reactions(p1, p2, e1, e2, Fsum, Mext)
    worst_f = max(worst_f, np.linalg.norm(R1 + R2 + Fsum))
    worst_m = max(worst_m, np.linalg.norm(np.cross(p2 - p1, R2) + Mext))
    worst_ax = max(worst_ax, abs(u @ Mext))
check("rigid arm: net force on the arm, N", worst_f, 0.0, 1e-6, "pivot reactions + ball joint + pushrod = 0")
check("rigid arm: net moment on the arm, N mm", worst_m, 0.0, 1e-4, "about the front pivot")
check("rigid arm: moment about the pivot axis, N mm", worst_ax, 0.0, 1e-6, "the pushrod force is the one that balances the arm")
# pushrod mounted at the ball-joint node: the legs are pure two-force members (the pin-jointed truss answer)
node_sp = dict(TEMPLATE_FRONT["spring"], rod_outboard=list(TEMPLATE_FRONT["hardpoints"]["lower_outboard"]))
cfgn = corner(spring=node_sp)
en = evaluate(cfgn)
Ln = run_loads(cfgn, en["susp"], en["spring"])
check("pushrod at the node: no load across the legs, N", max(r["bending"] for r in Ln["results"].values()), 0.0, 1e-6,
      "all load along the legs, which is the unique pin-jointed truss answer")
# the bending check counts the pushrod's push along the leg once: max(|N at the pivot|, |N beyond the mount|)
bc2 = Lb["bending_check"]
A2, I2 = tube_props(*cfgb["members"]["wishbone"])
check("mount bending stress uses the larger leg force either side of the mount, MPa", bc2["stress"],
      bc2["moment"] * cfgb["members"]["wishbone"][0] / 2 / I2 + max(abs(bc2["n_pivot"]), abs(bc2["n_node"])) / A2, 1e-9,
      "M c / I + max |N| / A")
on_leg = dict(TEMPLATE_FRONT["spring"])
lf, lb_ = np.array(TEMPLATE_FRONT["hardpoints"]["lower_inboard_rear"]), np.array(TEMPLATE_FRONT["hardpoints"]["lower_outboard"])
on_leg["rod_outboard"] = list(lf + 0.85 * (lb_ - lf))
cfgl = corner(spring=on_leg)
el = evaluate(cfgl)
bl = run_loads(cfgl, el["susp"], el["spring"])["bending_check"]
check("pushrod mount on the leg's centerline: zero offset, mm", bl["offset"], 0.0, 1e-6, "mount placed on the line pivot -> ball joint")
check("... and M = P a (L - a) / L with a = 85 % of the leg, N mm", bl["moment"], bl["P_perp"] * 0.85 * bl["length"] * 0.15, 1e-6, "simply supported beam")

print("\n6b3. Load cases: brake bias, the car's LLTD, deflected geometry")
cfg3 = corner(spring=dict(TEMPLATE_FRONT["spring"]))
e3 = evaluate(cfg3)
cases3 = {c[0]: c for c in _lc(cfg3, e3["susp"])[0]}
veh3 = cfg3["vehicle"]
W3 = veh3["mass"] * 9.81
fx = [f[0] for f, p in cases3["braking"][1] if abs(f[0]) > 0][0]
check("braking force on a front tire by brake bias, N", fx, -cfg3["loads"]["brake_g"] * W3 * veh3["front_brake_share"] / 2, 1e-9, "g x W x front share / 2")
grip = dict(cfg3, loads=dict(cfg3["loads"], brake_split="grip"))
cg = {c[0]: c for c in _lc(grip, e3["susp"])[0]}
fz, fxg = [f for f, p in cg["braking"][1] if f[2] > 0][0][2], [f[0] for f, p in cg["braking"][1] if abs(f[0]) > 0][0]
check("brake_split grip: Fx = g x that tire's Fz, N", fxg, -cfg3["loads"]["brake_g"] * fz, 1e-9, "equal friction use")
info_car = _lc(cfg3, e3["susp"], lltd=0.55)[1]
check("the car's LLTD sets the lateral transfer, N/g", info_car["lat_per_g"], W3 * veh3["cg_height"] / e3["susp"].track * 0.55, 1e-9, "W h / t x LLTD")
over = dict(cfg3, loads=dict(cfg3["loads"], lltd_front=0.5))
check("loads.lltd_front overrides it", _lc(over, e3["susp"], lltd=0.55)[1]["lltd"], 0.5, 1e-12, "manual override")
L3 = _rl(cfg3, e3["susp"], e3["spring"])
dz_exp = min(cfg3["sweep"]["travel"], (cfg3["loads"]["bump_g"] - 1) * L3["Fz0"] / L3["info"]["wheel_rate"])
check("bump solved at (load - static) / wheel rate, capped at full bump, mm", L3["deflect"].get("bump (deflected)", 0.0), dz_exp, 1e-9, "spring deflection")
soft = dict(cfg3, loads=dict(cfg3["loads"], bump_g=1.5))
Ls = _rl(soft, e3["susp"], e3["spring"])
check("a smaller bump is solved below full bump, mm", Ls["deflect"]["bump (deflected)"], 0.5 * Ls["Fz0"] / Ls["info"]["wheel_rate"], 1e-9, "0.5 x static load / wheel rate")
check("wheel rate for that = spring rate x MR^2, N/mm", L3["info"]["wheel_rate"], cfg3["spring"]["spring_rate"] * e3["metrics"]["motion_ratio"] ** 2, 0.01,
      "MR from +/-1 mm vs the sweep slope: within 0.01 N/mm")

print("\n6c. Compliance: links as axial springs")
from susp.loads import link_stiffness  # noqa: E402
Lk = float(np.linalg.norm(inb["tie_rod"] - outb["tie_rod"]))
At, _ = tube_props(*cfg["members"]["tie_rod"])
check("tie-rod stiffness, N/mm", link_stiffness(cfg, "tie_rod", Lk),
      1 / (1 / (cfg["members"]["E"] * At / Lk) + 2 / cfg["members"]["rod_end_k"] + 1 / cfg["members"]["mount_k"]), 1e-9,
      "tube E A / L, two rod ends and the mount in series")
for lbl, cf, ee, LL in (("pushrod on the upright", cfg, e, L6), ("pushrod on the wishbone", cfgb, eb, Lb)):
    C = LL["compliance"]
    p6 = _geometry(ee["susp"], ee["spring"])[0]
    worst = 0.0
    for (name, forces, *_), x in zip(load_cases(cf, ee["susp"])[0], C["cases"]):
        d, th = np.array(x["d"]), np.array(x["theta"])
        work = sum(f @ (d + np.cross(th, p6[pp])) for f, pp in forces)
        energy = sum(LL["results"][name][k] ** 2 / C["stiffness"][k] for k in MEMBERS)
        worst = max(worst, abs(work - energy) / max(1.0, energy))
    check(f"work in = spring energy, every case ({lbl})", worst, 0.0, 1e-9, "F . d + M . theta = sum(T^2 / k)")
x = L6["compliance"]["cases"][1]
d, th = np.array(x["d"]), np.array(x["theta"])
r1 = L6["results"][x["case"]]
worst = max(abs((inb[k] - outb[k]) / np.linalg.norm(inb[k] - outb[k]) @ (d + np.cross(th, outb[k])) + r1[k] / L6["compliance"]["stiffness"][k]) for k in MEMBERS)
check("upright motion stretches every link by T / k (pushrod on the upright), mm", worst, 0.0, 1e-9, "e . (d + theta x r) = -T / k")

print("\n7. Whole car: lateral load transfer adds up to m g h")
from susp.config import load_car  # noqa: E402
fc, rc, info = load_car(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "designs", "example_car.json"))
fe, re_ = evaluate(fc, steer=False, pack=False), evaluate(rc, steer=False, pack=False)
for arb in (0.0, 300.0):
    cb = car_balance(fc, fe, rc, re_, arb_f=arb)
    veh = fc["vehicle"]
    total = cb["dFz_f"] * fe["susp"].track / 1000 + cb["dFz_r"] * re_["susp"].track / 1000
    check(f"total load-transfer moment per g, front bar {arb:g}, N m", total, veh["mass"] * 9.81 * veh["cg_height"] / 1000, 1e-6, "moment balance: sum(dFz x track) = m g h")
cb = car_balance(fc, fe, rc, re_)
K = cb["Kf"] + cb["Kr"]
gf_, gr_ = cb["geo_f"] * fe["susp"].track / 1000 / cb["Ktf"], cb["geo_r"] * re_["susp"].track / 1000 / cb["Ktr"]
check("roll gradient, deg/g", cb["grad"], (cb["ms"] * 9.81 * cb["arm"] / 1000 + cb["Kf"] * gf_ + cb["Kr"] * gr_) / K, 1e-9,
      "(sprung weight x roll arm + K_f x tire roll from the geometric transfer + same rear) / total roll stiffness")
fc_r, rc_r = (dict(c, spring=dict(c["spring"], tire_rate=1e9)) for c in (fc, rc))
cb_r = car_balance(fc_r, fe, rc_r, re_)
check("rigid tires: roll gradient, deg/g", cb_r["grad"], cb_r["ms"] * 9.81 * cb_r["arm"] / 1000 / (cb_r["Kf"] + cb_r["Kr"]), 1e-6,
      "sprung weight x roll moment arm / total roll stiffness (the textbook formula)")

print("\n8. Travel, halfshaft, caliper, aero and steering stiffness")
from susp.kinematics import heave_points, rim_inner_radius  # noqa: E402
from susp.loads.compliance import link_stiffness  # noqa: E402
hp9 = heave_points(20.0, 30.0, 9)
check("heave points, droop 20 / bump 30, largest spacing error, mm", max(abs(a - b) for a, b in zip(hp9, [-20, -15, -10, -5, 0, 7.5, 15, 22.5, 30])), 0.0, 1e-12,
      "half the points on each side, evenly spaced, 0 included")
e = evaluate(corner(PAR, sweep=dict(TEMPLATE_FRONT.get("sweep") or {}, droop_travel=20.0, bump_travel=30.0)))
check("asymmetric sweep: droop end, mm", e["rows"][0]["dz"], -20.0, 1e-9, "sweep.droop_travel")
check("asymmetric sweep: bump end, mm", e["rows"][-1]["dz"], 30.0, 1e-9, "sweep.bump_travel")
i0 = [r["dz"] for r in e["rows"]].index(0.0)
check("asymmetric sweep: contact patch moves out at full bump, mm", e["rows"][i0]["cp_y"] - e["rows"][-1]["cp_y"], L - math.sqrt(L * L - 900), 1e-6,
      "arc of a 310 mm arm at 30 mm bump: L - sqrt(L^2 - 30^2)")

# halfshaft on the parallelogram: the upright translates on an arc, so the CV moves by (sqrt(L^2 - z^2) - L, z)
cv, dif = [0.0, 520.0, 230.0], [0.0, 150.0, 230.0]
rr = corner(PAR, axle="rear", halfshaft={"diff_output": dif, "cv_outboard": cv})
e = evaluate(rr, steer=False)
lens, angs = [], []
for r in e["rows"]:
    z = r["dz"]
    dy = cv[1] - dif[1] + math.sqrt(L * L - z * z) - L
    lens.append(math.hypot(dy, z))
    angs.append(math.degrees(math.atan2(abs(z), dy)))
check("halfshaft plunge, mm", e["metrics"]["hs_plunge"], max(lens) - min(lens), 1e-6, "length change of the shaft over the travel")
check("inboard CV angle, deg", e["metrics"]["hs_cv_in_max"], max(angs), 1e-6, "atan(rise / lateral length) at the worst end")
a0 = e["rows"][0]["_pts"]["a"]                                    # spin axis: static camber, constant (no rotation)
tilt = math.degrees(math.atan2(a0[2], a0[1]))
rise = [math.degrees(math.atan2(r["dz"], cv[1] - dif[1] + math.sqrt(L * L - r["dz"] ** 2) - L)) for r in e["rows"]]
check("outboard CV angle, deg", e["metrics"]["hs_cv_out_max"], max(abs(x - tilt) for x in rise), 1e-6,
      "shaft rise angle minus the spin axis tilt (camber), worst end")

cal = {"clock_deg": 90.0, "radius": 110.0, "size": 50.0, "offset": -20.0}
cc = corner(PAR, wheel=dict(TEMPLATE_FRONT["wheel"], caliper=cal, rim_inner_radius=150.0))
e = evaluate(cc)
check("caliper to rim barrel, mm", e["metrics"]["caliper_rim_margin"], 150.0 - (110.0 + 25.0), 1e-9, "barrel radius - (caliper radius + size / 2)")
check("default barrel radius, mm", rim_inner_radius(corner(PAR)), TEMPLATE_FRONT["wheel"]["rim_diameter_in"] * 25.4 / 2 - 15.0, 1e-9, "rim radius - 15 mm when not given")

aero = 600.0
ea = evaluate(corner(PAR, damper, vehicle=dict(TEMPLATE_FRONT["vehicle"], aero_front=aero)))
kw = 50.0 * (a / b) ** 2
check("aero sag at 600 N per axle, mm", ea["metrics"]["aero_sag"], aero / 2 / kw + aero / 2 / 150.0, 2e-3, "F / k_wheel + F / k_tire (constant motion ratio)")
check("ride frequency with aero, Hz", ea["metrics"]["ride_freq_aero"], ea["metrics"]["ride_freq"], 1e-3, "same mass, nearly constant motion ratio: unchanged")

cs = corner(PAR, vehicle=dict(TEMPLATE_FRONT["vehicle"], rack_c_factor=90.0))
k0 = link_stiffness(cs, "tie_rod", 310.0)
cs["members"] = dict(cs["members"], rack_k=15000.0, column_k=10.0)
k1 = link_stiffness(cs, "tie_rod", 310.0)
k_col = 10.0 * 2 * math.pi * 360.0 * 1000.0 / 90.0 ** 2
check("tie rod with rack and column, N/mm", 1 / k1, 1 / k0 + 1 / 15000.0 + 1 / k_col, 1e-12, "springs in series; column 2 pi 360 1000 k_col / c^2")

print("\n9. Rod-end and ball-joint misalignment on the parallelogram")
e = evaluate(corner(PAR), steer=False)
J = {r["key"]: r for r in e["joints"]["rows"]}
T9 = max(abs(r["dz"]) for r in e["rows"])
th = math.asin(T9 / L)
check("ball joint (bolt along the kingpin): misalignment = arm swing, deg", J["upper_outboard"]["worst"], math.degrees(th), 1e-6,
      "upright translates, the arm turns asin(travel / 310 mm) about the pivot axis")
e9a = evaluate(corner(PAR, joints={"upper_outboard": {"align": 10.0}}), steer=False)
Ja = {r["key"]: r for r in e9a["joints"]["rows"]}
check("ball joint square at +10 mm of travel: worst = swing from there to full droop, deg", Ja["upper_outboard"]["worst"],
      math.degrees(th + math.asin(10.0 / L)), 1e-6, "asin(travel / 310) + asin(10 / 310); at ride height it reads asin(10 / 310)")
check("ball joint square at +10 mm: at ride height, deg", Ja["upper_outboard"]["ride"], math.degrees(math.asin(10.0 / L)), 1e-6, "asin(10 / 310)")
check("tie rod outboard (vertical bolt on the upright): misalignment = link swing, deg", J["trackrod_outboard"]["worst"], math.degrees(th), 1e-6,
      "the tie rod swings asin(travel / 310 mm) out of the horizontal plane")
u0 = np.array([200.0, 310.0, 0.0]) / math.hypot(200, 310)        # lower leg from the X = -200 pivot, at ride height
c9 = abs(u0[0])
check("inboard leg rod end (bracket square to the leg): asin(c sqrt(1 - c^2) (1 - cos theta)), deg", J["lower_inboard_front"]["worst"],
      math.degrees(math.asin(c9 * math.sqrt(1 - c9 * c9) * (1 - math.cos(th)))), 1e-6, "c = leg . pivot axis; the leg turns theta about the pivot axis")
check("a straight bracket (bolt along the pivot axis) sees the leg's splay angle all the time, deg",
      evaluate(corner(PAR, joints={"lower_inboard_front": {"bolt": "pivot", "square": False}}), steer=False)["joints"]["rows"][2]["worst"],
      math.degrees(math.asin(c9)), 1e-6, "asin(leg . pivot axis), constant over the travel")

print("\n10. Springs as fitted, anti-roll bar linkage, tire load sensitivity")
from susp.car import axle_limit  # noqa: E402
a10, b10 = 186.0, 310.0
MR10 = a10 / b10
bs = dict(damper, spring_rate=50.0, bumpstop_gap=6.0, bumpstop_k=80.0, bumpstop_k2=4.0)
e = evaluate(corner(PAR, bs), steer=False)
check("bump stop touches at gap / MR of wheel travel, mm", e["metrics"]["bumpstop_travel"], 6.0 / MR10, 0.05,
      "vertical damper on the parallelogram: damper moves MR x wheel travel (MR = a / b)")
xb = MR10 * T9
check("wheel rate at full bump with the bump stop, N/mm", e["metrics"]["wheel_rate_bump"], (50 + 80 + 2 * 4 * (xb - 6)) * MR10 ** 2, 0.005 * e["metrics"]["wheel_rate_bump"],
      "(k + k_b + 2 k_b2 (x - gap)) MR^2, x = MR x travel")
dr = dict(damper, spring_rate=40.0, spring_rate2=70.0, spring_breakpoint=5.0)
e = evaluate(corner(PAR, dr), steer=False)
check("dual-rate spring: wheel rate at full bump = rate2 x MR^2, N/mm", e["metrics"]["wheel_rate_bump"], 70.0 * MR10 ** 2, 0.005 * 70.0 * MR10 ** 2, "past the breakpoint")
check("dual-rate spring: wheel rate at ride = rate1 x MR^2, N/mm", e["metrics"]["wheel_rate"], 40.0 * MR10 ** 2, 1e-4, "before the breakpoint")
cfb = corner(PAR, dict(bs, bumpstop_k=600.0, bumpstop_k2=20.0))
eb = evaluate(cfb, steer=False)
Lb_ = run_loads(cfb, eb["susp"], eb["spring"])
z_got = Lb_["deflect"]["bump (deflected)"]
dF = Lb_["info"]["Fz0"] * (cfb["loads"]["bump_g"] - 1)
k1w, kbw, zc = 50 * MR10 ** 2, 600 * MR10 ** 2, 6.0 / MR10
def F_at(z):                                                      # wheel force above ride height with a constant MR
    u = max(0.0, z - zc)
    return k1w * z + kbw * u + 20 * MR10 ** 3 * u * u
lo_, hi_ = 0.0, T9
for _ in range(100):
    mid_ = (lo_ + hi_) / 2
    lo_, hi_ = (mid_, hi_) if F_at(mid_) < dF else (lo_, mid_)
check("bump case solved where the spring + bump stop carry the load, mm", z_got, lo_, 0.1,
      "k MR^2 z + k_b MR^2 (z - z_c) + k_b2 MR^3 (z - z_c)^2 = load - static load")
arb10 = {"link_on": "lower", "link_outboard": [0.0, 250 + a10, 130.0], "arm_tip": [0.0, 250 + a10, 330.0],
         "bar_pivot": [100.0, 250 + a10, 330.0], "bar_od": 16.0, "bar_wall": None, "bar_length": 600.0}
e = evaluate(corner(PAR, damper, arb=arb10), steer=False)
tp = (a10 / b10) / 100.0                                           # rad of bar per mm of wheel travel
Kt = 79300.0 * math.pi / 32 * 16.0 ** 4 / 600.0
kw10 = 2 * Kt * tp ** 2
check("anti-roll bar twist per wheel travel, deg/mm", e["metrics"]["arb_twist"], math.degrees(tp), 1e-4 * math.degrees(tp),
      "vertical drop link at a / b of the arm, bar arm 100 mm: (a / b) / 100 rad/mm")
check("anti-roll bar rate at each wheel in roll, N/mm", e["metrics"]["arb_wheel_rate"], kw10, 2e-4 * kw10, "2 G J / L x twist-per-mm^2")
check("anti-roll bar roll stiffness, Nm/deg", e["metrics"]["arb_roll"], kw10 * 1000 * 1.22 ** 2 / 2 * math.pi / 180, 2e-4 * e["metrics"]["arb_roll"],
      "k_wheel t^2 / 2, track 1220 mm")
mu, kk, c10, F010 = 1.6, 0.2, 300.0, 600.0
lo_, hi_ = 0.0, mu
for _ in range(200):
    mid_ = (lo_ + hi_) / 2
    grip = mu * (2 * F010 - 2 * kk * (c10 * mid_) ** 2 / F010)
    lo_, hi_ = (mid_, hi_) if grip > 2 * F010 * mid_ else (lo_, mid_)
check("axle lateral limit with load-sensitive tires, g", axle_limit(mu, kk, c10, F010), lo_, 1e-9,
      "bisection on mu (2 F0 - 2 k dFz^2 / F0) = 2 F0 ay")
fc["vehicle"]["tire_load_sens"] = 0.2
for cc_ in (fc, rc):
    cc_["vehicle"]["tire_load_sens"] = 0.2
cbt = car_balance(fc, fe, rc, re_)
F0f, F0r = fc["vehicle"]["mass"] * fc["vehicle"]["weight_front"] * 9.81 / 2, fc["vehicle"]["mass"] * (1 - fc["vehicle"]["weight_front"]) * 9.81 / 2
tf_, tr_ = fe["susp"].track, re_["susp"].track
check("front LLTD that saturates both axles together", cbt["lltd_neutral"], F0f * tf_ / (F0f * tf_ + F0r * tr_), 1e-9,
      "equal load-transfer ratio dFz / Fz0 front and rear (same tires)")

print("\n11. Pickup tabs and the fatigue screen (textbook formulas, IIW and Shigley S-N lines)")
from susp.loads.durability import CAFL, endurance, sn_life, sn_strength, weld_allow, weld_life  # noqa: E402
D11 = L6["durability"]
mem11 = cfg6["members"]
tb, d11 = D11["tab"], mem11["bolt_dia"]
r11 = max(D11["tabs"], key=lambda q: q["force"])
F11, n11, t11 = r11["force"], tb["count"], tb["thickness"]
check("tab bearing FOS: yield / (F / (n t d))", r11["fos"]["bearing"], mem11["yield"] / (F11 / (n11 * t11 * d11)), 1e-9, f"{r11['member']}, {F11:.0f} N")
check("tab tear-out FOS: 0.577 yield / (F / (2 n t (e - d/2)))", r11["fos"]["tearout"],
      0.577 * mem11["yield"] / (F11 / (2 * n11 * t11 * (tb["edge"] - d11 / 2))), 1e-9, "two shear planes per tab")
check("tab weld FOS: 0.577 yield / (F / (n L 0.707 leg))", r11["fos"]["weld"],
      0.577 * mem11["yield"] / (F11 / (n11 * tb["weld_length"] * 0.707 * tb["weld_leg"])), 1e-9, "fillet weld throat")
bg = cfg6["loads"]["bump_g"]
worst11 = max(abs(D11["static"][k] - L6["results"]["bump"][k] / bg) for k in MEMBERS)
check("the car at rest = the bump case / bump_g (same geometry, linear statics), N", worst11, 0.0, 1e-6, "static corner weight at the contact patch")
se11, f11 = endurance(dict(uts=670.0, surface="machined"))
check("endurance limit, 670 MPa machined steel, axial, MPa", se11, 4.51 * 670 ** -0.265 * 0.85 * 0.5 * 670, 1e-9, "k_a = 4.51 S_ut^-0.265, k_c = 0.85, S_e' = 0.5 S_ut")
check("S-N line: 0.9 S_ut at 1000 cycles, MPa", sn_strength(se11, 670.0, 1e3), 0.9 * 670, 1e-9, "Shigley")
check("S-N line: S_e at a million cycles, MPa", sn_strength(se11, 670.0, 1e6 - 1e-6), se11, 1e-6, "Shigley")
check("S-N life inverts the strength: life at S_f(1e5) = 1e5", sn_life(se11, 670.0, sn_strength(se11, 670.0, 1e5), 0.0), 1e5, 1e-3, "Basquin")
check("weld: FAT at 2 million cycles, MPa", weld_allow(45.0, 2e6), 45.0, 1e-9, "IIW definition of FAT")
check("weld: flat at 0.585 FAT from 10 million cycles, MPa", weld_allow(45.0, 5e7), 45.0 * 0.2 ** (1 / 3), 1e-9, "(2e6 / 1e7)^(1/3)")
check("weld life inverts the allowed range: 1e5 cycles", weld_life(45.0, weld_allow(45.0, 1e5)), 1e5, 1e-3, "slope 3")
sw_names = [f"{a} ↔ {b}" for a, b in D11["swings"] if b != "at rest"]
check("left/right turns are a swing of their own (corner outer ↔ inner)", 1.0 if "corner outer ↔ corner inner" in sw_names else 0.0, 1.0, 0,
      "a wheel is the outer one in a left turn and the inner one in a right turn")
tw = next(r for r in D11["fatigue"] if r["kind"] == "weld" and r["item"] == "pushrod")
A_p = math.pi / 4 * (mem11["pushrod"][0] ** 2 - (mem11["pushrod"][0] - 2 * mem11["pushrod"][1]) ** 2)
want_n = min((weld_allow(D11["weld_fat_tube"], D11["bump_cycles"] if (b == "at rest" and a.startswith("bump")) else D11["cycles"])
              / abs((L6["results"][a]["pushrod"] - (D11["static"] if b == "at rest" else L6["results"][b])["pushrod"]) / A_p))
             for a, b in D11["swings"])
check("pushrod weld: the smallest allowed / applied range over every swing", tw["n"], want_n, 1e-9,
      "range = (F_a - F_b) / A, allowed = FAT (2e6 / N)^(1/3)")
check("weld under its constant-amplitude limit never cracks", 1.0 if weld_life(45.0, CAFL * 45.0 * 0.99) == float("inf") else 0.0, 1.0, 0, "")

print("\n11b. Pushrod mount with a gusset plate or a bracket into the node")
from susp.loads.strength import leg_stress, rod_leg, section  # noqa: E402
from susp.loads.statics import _geometry  # noqa: E402
od_, w_, tg_, hg_ = 25.4, 1.65, 3.0, 30.0
ys = np.linspace(-od_ / 2, od_ / 2 + hg_, 200001)                 # strips across the section, 1e-4 mm-ish
dy = ys[1] - ys[0]
ri = od_ / 2 - w_
width = (2 * np.sqrt(np.clip((od_ / 2) ** 2 - ys ** 2, 0, None)) - 2 * np.sqrt(np.clip(ri ** 2 - ys ** 2, 0, None))
         + np.where((ys >= od_ / 2) & (ys <= od_ / 2 + hg_), tg_, 0.0))
A_n = float(np.sum(width) * dy)
yb_n = float(np.sum(width * ys) * dy / A_n)
I_n = float(np.sum(width * (ys - yb_n) ** 2) * dy)
A_s, I_s, c_s = section(od_, w_, tg_, hg_)
check("gusset section area, mm^2", A_s, A_n, 1e-3 * A_n, "strip integration of tube + plate")
check("gusset section I about its neutral axis, mm^4", I_s, I_n, 1e-3 * I_n, "strip integration")
check("gusset section extreme fiber, mm", c_s, max(yb_n + od_ / 2, od_ / 2 + hg_ - yb_n), 1e-3, "plate tip or the tube's far side")
import json as _json  # noqa: E402
raw11 = _json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "designs", "example_front.json")))
raw11["members"]["gusset"] = {"thickness": 3.0, "height": 30.0, "length_in": 120.0, "length_out": 20.0}
c11 = make_config(raw11)
e11b = evaluate(c11, steer=False, pack=False)
L11 = run_loads(c11, e11b["susp"], e11b["spring"])
s11, sp11 = e11b["susp"], e11b["spring"]
leg11, Lg11, a11, _ = rod_leg(s11, sp11)
r11b = L11["results"]["bump"]
ls = leg_stress(c11, leg11, r11b, _geometry(s11, sp11))
xe = a11 - 120.0
A_t, I_t = tube_props(*c11["members"]["wishbone"])
want_end = ls["P_perp"] * xe * (Lg11 - a11) / Lg11 * c11["members"]["wishbone"][0] / 2 / I_t + abs(ls["n_pivot"]) / A_t
check("bare tube's stress where the gusset ends (toward the pivot), MPa", ls["end_stress"], want_end, 1e-6 * want_end,
      "M = P x (L - a) / L at x = a - length_in, stress = M r / I + |N| / A")
raw11["members"]["gusset"] = {"type": "to_node"}
c11n = make_config(raw11)
e11n = evaluate(c11n, steer=False, pack=False)
ln = leg_stress(c11n, leg11, r11b, _geometry(e11n["susp"], e11n["spring"]))
check("bracket into the node: the leg carries only its axial force, MPa", ln["stress"], max(abs(ln["n_pivot"]), abs(ln["n_node"])) / A_t, 1e-9,
      "no bending: the push goes straight into the ball-joint node")
gfat = [r for r in L11["durability"]["fatigue"] if r["item"].startswith("gusset:")]
check("gusset-end weld class by length (140 mm: IIW 71 MPa)", gfat[0]["allow"] if gfat else 0, 71.0 * (2e6 / 1e5) ** (1 / 3), 1e-9,
      "longitudinal attachment 50-150 mm long: FAT 71, at 100,000 cycles")

print("\n11b2. Rocker plates: holes like lugs, arms built in at the hub")
from susp.loads.strength import rocker_forces, rocker_of, rocker_stress  # noqa: E402


class _RockerAxis:
    k = np.array([0.0, 0.0, 1.0])
    c = np.array([0.0, 0.0, 0.0])


rk11 = {"thickness": 5.0, "plates": 2, "pivot_bore": 20.0, "pivot_edge": 15.0, "pin_dia": 8.0, "edge": 10.0, "width": 20.0}
F_p, F_d = np.array([0.0, 1000.0, 100.0]), np.array([500.0, 0.0, 0.0])
fr11 = {"pushrod": (np.array([60.0, 0.0, 5.0]), F_p), "damper": (np.array([0.0, 80.0, 0.0]), F_d), "pivot": (np.zeros(3), -(F_p + F_d))}
h11, a11r, o11 = rocker_stress(rk11, _RockerAxis, fr11)
check("rocker pin hole bearing, MPa", h11["pushrod"]["stress"]["bearing"], 1000 / (2 * 5 * 8), 1e-9, "in-plane F / (n t d): the 100 N along the axis left out")
check("rocker pin hole tear-out, MPa", h11["pushrod"]["stress"]["tearout"], 1000 / (2 * 2 * 5 * (10 - 4)), 1e-9, "F / (n 2 t (e - d/2))")
check("rocker pivot bearing, MPa", h11["pivot"]["stress"]["bearing"], math.hypot(500, 1000) / (2 * 5 * 20), 1e-9, "the in-plane resultant on the bore")
check("pushrod arm bending at the hub's edge, MPa", a11r["pushrod"]["stress"], 6 * 1000 * (60 - 15) / (2 * 5 * 20 ** 2), 1e-9,
      "6 F (L - hub) / (n t w^2), the force square to the arm")
check("damper arm, force across it plus none along, MPa", a11r["damper"]["stress"], 6 * 500 * (80 - 15) / (2 * 5 * 20 ** 2), 1e-9, "")
fr11b = dict(fr11, damper=(np.array([0.0, 80.0, 0.0]), np.array([300.0, 400.0, 0.0])))
check("an arm pulled along its length adds F / (n t w), MPa", rocker_stress(rk11, _RockerAxis, fr11b)[1]["damper"]["stress"],
      6 * 300 * 65 / (2 * 5 * 400) + 400 / (2 * 5 * 20), 1e-9, "bending from 300 N across, axial from 400 N along")
check("share of a pin force along the rocker's axis", o11, 100 / math.hypot(1000, 100), 1e-12, "|F . k| / |F|")
raw11r = _json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "designs", "example_front.json")))
c11r = make_config(raw11r)
e11r = evaluate(c11r, steer=False, pack=False)
L11r = run_loads(c11r, e11r["susp"], e11r["spring"])
R11 = L11r["rocker_check"]
check("rocker check: the worst arm's FOS is yield / its worst stress over the cases", min(v["sf"] for v in R11["arms"].values()),
      min(241.0 / rocker_stress(rocker_of(c11r), e11r["spring"],
                                 rocker_forces(e11r["susp"], e11r["spring"], r_,
                                               _geometry(e11r["susp"], e11r["spring"], L11r["deflect"].get(n_, 0.0))))[1][k_]["stress"]
          for n_, r_ in L11r["results"].items() for k_ in ("pushrod", "damper")), 1e-9, "every case at its own geometry")
check("rocker forces balance: pushrod + damper + pivot = 0, N",
      max(float(np.linalg.norm(sum(F for _, F in rocker_forces(e11r["susp"], e11r["spring"], r_, _geometry(e11r["susp"], e11r["spring"])).values())))
          for r_ in L11r["results"].values()), 0.0, 1e-9, "")

print("\n11b3. Guardrails: a link layout that can't hold the wheel is refused, not solved into huge forces")
from susp.loads.statics import cond1, _solve_statics  # noqa: E402
from susp.kinematics import SolveError as _SE  # noqa: E402
A11g = np.array([[2.0, 1.0], [1.0, 3.0]])
check("1-norm condition number of [[2, 1], [1, 3]]", cond1(A11g), 4.0 * (4.0 / 5.0), 1e-12, "||A||1 = 4, ||A^-1||1 = 4/5")
B11g = np.eye(6)
B11g[:, 1] = B11g[:, 0]                                           # two links on the same line
try:
    _solve_statics(B11g, np.ones(6))
    g_ok = 0.0
except _SE as ex:
    g_ok = 1.0 if "line up" in str(ex) else 0.0
check("two links on the same line: SolveError that says why", g_ok, 1.0, 0, "both the pushrod-on-arm and pushrod-on-upright paths use it")
from susp.validate import front_view_swing_arm  # noqa: E402
from susp.config import HP as _HP  # noqa: E402
h11g = {_HP[k]: np.array(v, float) for k, v in c11r["hardpoints"].items()}
check("front-view swing arm from the hardpoints = the solver's at ride height, mm", front_view_swing_arm(h11g), e11r["metrics"]["fvsa"], 1e-6,
      "used to warn about nearly parallel wishbones")

print("\n11c. Part loads for FEA: every part's forces balance (forces and moments)")
from susp.loads.parts import part_loads  # noqa: E402
imb = 0.0
for c_ in (c11, c11n, cfg6):
    ev_ = evaluate(c_, steer=False, pack=False)
    run_ = run_loads(c_, ev_["susp"], ev_["spring"])
    for case_, parts_ in part_loads(c_, ev_["susp"], ev_["spring"], run_).items():
        for part_, items_ in parts_.items():
            Fs = sum(f for _, _, f in items_)
            Ms = sum(np.cross(p, f) for _, p, f in items_)
            if part_ == "rocker":
                Ms = np.array([Ms @ ev_["spring"].k])                # the rocker's bearing takes the other couples
            sc = max(np.linalg.norm(f) for _, _, f in items_)
            imb = max(imb, np.linalg.norm(Fs) / sc, np.linalg.norm(Ms) / (sc * 1000))
check("worst imbalance on any part in any case (force / largest force, moment / (largest force x 1 m))", imb, 0.0, 1e-9,
      "upright, both wishbones and the rocker, three corners, every case")
print("\n12. Wheel rate with the preload term, from the spring's energy")
from susp.config import load_config  # noqa: E402
c12 = load_config(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "designs", "example_front.json"))
e12 = evaluate(c12, steer=False, pack=False)
s12, sp12 = e12["susp"], e12["spring"]
k12, Fs12 = c12["spring"]["spring_rate"], e12["metrics"]["static_spring_force"]
h12 = 0.5
xs12 = s12.states([-h12, 0.0, h12])
Ls12 = {z: sp12.state(xs12[z])["damper_len"] for z in (-h12, 0.0, h12)}
E12 = {z: 0.5 * k12 * (Fs12 / k12 + Ls12[0.0] - Ls12[z]) ** 2 for z in Ls12}     # spring energy, preloaded to its static force
check("wheel rate with preload = d2E/dz2 of the preloaded spring, N/mm", e12["metrics"]["wheel_rate_preload"],
      (E12[h12] - 2 * E12[0.0] + E12[-h12]) / h12 ** 2, 2e-3 * e12["metrics"]["wheel_rate_preload"],
      "second difference of 1/2 k (x0 + L0 - L(z))^2 over +-0.5 mm of travel, x0 = static force / k")
check("the preload term is the gap to k MR^2, N/mm", e12["metrics"]["wheel_rate_preload"] - e12["metrics"]["wheel_rate"],
      Fs12 * (((Ls12[0.0] - Ls12[h12]) - (Ls12[-h12] - Ls12[0.0])) / h12 ** 2), 2e-2, "static spring force x dMR/dz")

print("\n13. Layout (mass, CG, inertia) and the straight-line run")
from susp.layout import accel_run, layout_mass  # noqa: E402
fl, rl = (make_config(dict(copy.deepcopy(TEMPLATE_FRONT), axle=ax, spring=None)) for ax in ("front", "rear"))
WB13 = 1600.0
lay13 = {"components": [{"name": "a", "mass": 100.0, "at": [-400.0, 0.0, 300.0], "size": [600.0, 300.0, 200.0]},
                        {"name": "b", "mass": 50.0, "at": [-1000.0, 100.0, 500.0]}]}
L13 = layout_mass(lay13, fl, rl, WB13)                       # no spring block: no unsprung mass from the corners
xf13 = fl["hardpoints"]["contact_patch"][0]
check("layout total mass, kg", L13["mass"], 150.0, 1e-12, "100 + 50 (no wheels without a spring block)")
check("layout CG height, mm", L13["cg_height"], (100 * 300 + 50 * 500) / 150, 1e-9, "mass-weighted mean of the Z positions")
check("layout front share", L13["weight_front"], 1 - (xf13 - (100 * -400 + 50 * -1000) / 150) / WB13, 1e-12, "1 - (CG behind the front axle) / wheelbase")
cgx, cgz = (100 * -400 + 50 * -1000) / 150 / 1000, (100 * 300 + 50 * 500) / 150 / 1000
Iyy13 = 100 * (0.6 ** 2 + 0.2 ** 2) / 12 + 100 * ((-0.4 - cgx) ** 2 + (0.3 - cgz) ** 2) + 50 * ((-1.0 - cgx) ** 2 + (0.5 - cgz) ** 2)
check("pitch inertia about the CG, kg m^2", L13["Iyy"], Iyy13, 1e-9, "box m (l^2 + h^2) / 12 + parallel axis; the second part a point")
veh13 = {"mass": 250.0, "weight_front": 0.45, "cg_height": 300.0, "tire_mu": 50.0}
d13 = {"torque_curve": [[1000, 40.0], [12000, 40.0]], "redline": 12000, "launch_rpm": 1000, "primary": 3.0, "gears": [3.0],
       "final": 3.0, "efficiency": 1.0, "shift_time": 0.0, "mass_factor": 1.0, "drag_area": 0.0, "rolling": 0.0, "distance": 3.0}
a13 = accel_run(d13, veh13, 250.0, WB13)
acc = 40.0 * 27 / 0.25 / 250.0
check("flat torque, no drag, plenty of grip: time to 3 m (below the redline), s", a13["time"], math.sqrt(2 * 3 / acc), 2e-4, "x = a t^2 / 2, a = T x ratio / R / m")
check("top speed in that gear at the redline, km/h", a13["gears"][0]["top_speed"] * 3.6, 12000 * 2 * math.pi / 60 / 27 * 0.25 * 3.6, 1e-9,
      "redline (rad/s) / overall ratio x tire radius")
veh13g = dict(veh13, tire_mu=1.4)
a13g = accel_run(dict(d13, torque_curve=[[1000, 400.0], [12000, 400.0]]), veh13g, 250.0, WB13)
ag = 1.4 * 9.81 * 0.55 / (1 - 1.4 * 0.3 / 1.6)
check("grip-limited launch (rear drive, load transfer onto the rear), g", a13g["grip_accel"], ag / 9.81, 1e-9,
      "a = mu g (1 - wf) / (1 - mu h / L)")
check("grip-limited the whole way: time to 3 m, s", a13g["time"], math.sqrt(2 * 3 / ag), 2e-4, "x = a t^2 / 2")

print("\n14. Rules checks (FSAE 2027 IC): travel, tilt, keep-out")
from susp.rules import check_rules, keepout_hits, rulesets, tilt_angle, usable_travel  # noqa: E402
a14, b14 = 186.0, 310.0
d14 = dict(damper, rod_outboard=[0, 250 + a14, 130], damper_chassis=[0, 250 + a14, 450], damper_stroke=30.0, damper_eye_to_eye=335.0)
c14 = corner(PAR, d14)
e14 = evaluate(c14, steer=False, pack=False)
def L14(th):                                                      # the damper on the arm, the arm turned th
    return math.hypot(a14 * (1 - math.cos(th)), 320 - a14 * math.sin(th))
def wheel_at(Lt):                                                 # bisection on the arm angle, wheel rise b sin(th)
    lo, hi = -0.6, 0.6
    for _ in range(200):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if L14(mid) > Lt else (lo, mid)
    return b14 * math.sin((lo + hi) / 2)
want14 = wheel_at(335.0 - 30.0) - wheel_at(335.0)
check("usable travel from the damper's stroke, mm", usable_travel(c14, e14)["total"], want14, 0.05,
      "parallelogram: damper on the arm at a = 186 mm, wheel rise 310 sin(theta); damper from 335 to 305 mm")
fake = {"grad": 1.0, "ms": 200.0, "arm": 250.0}
veh14 = {"cg_height": 300.0, "wheelbase": 1600.0, "weight_front": 0.5, "mass": 250.0}
class _S:
    def __init__(self, t):
        self.track = t
ang, info14 = tilt_angle({"vehicle": veh14}, {"susp": _S(1200.0)}, None, {"susp": _S(1100.0)}, fake)
half14 = (600 + 550) / 2
lean14 = 200 / 250 * 250 * math.sin(math.radians(1.0 * math.sin(math.radians(60))))
check("tilt the car survives, deg", ang, math.degrees(math.atan2(half14 - lean14, 300.0)), 1e-9,
      "atan((half track at the CG - lean) / CG height); lean = ms/m x roll arm x sin(roll gradient x sin 60)")
lay14 = {"components": [{"name": "wing", "mass": 3, "at": [400.0, 600.0, 300.0], "size": [100.0, 100.0, 50.0]},
                        {"name": "far", "mass": 3, "at": [400.0, 0.0, 300.0], "size": [100.0, 100.0, 50.0]},
                        {"name": "spread", "mass": 3, "at": [400.0, 600.0, 300.0], "size": [100.0, 100.0, 50.0], "solid": False}]}
fk = {"hardpoints": {"contact_patch": [0.0, 610.0, 0.0]}, "wheel": {"tire_radius": 254.0, "tire_width": 190.0}}
hits = keepout_hits(lay14, fk, fk, 1600.0)
check("keep-out: a part 400 mm ahead of the front axle, in line with the tire (254 + 75 = 329 mm zone ahead)", 1.0 if hits == [] else 0.0, 1.0, 0,
      "x from 350 to 450 starts past 329: clear")
lay14["components"][0]["at"][0] = 380.0
hits = keepout_hits(lay14, fk, fk, 1600.0)
check("keep-out: at 380 mm its back edge is 330 mm ahead, just outside the 329 mm zone", 1.0 if hits == [] else 0.0, 1.0, 0, "edge at 330 mm")
lay14["components"][0]["at"][0] = 370.0
hits = keepout_hits(lay14, fk, fk, 1600.0)
check("keep-out: at 370 mm its back edge (320 mm) is in the zone, right front only; centerline and non-solid parts ignored",
      1.0 if hits == [("wing", "front right")] else 0.0, 1.0, 0, str(hits))
rows14 = check_rules(rulesets()["fsae_2027_ic"], {"wheelbase": 1520.0, "track_ratio": 0.8, "bolt_grades": ["8.8", "4.6"], "shear_planes": [2, 1]})
st14 = {r["id"]: r["status"] for r in rows14}
check("rules: 1520 mm wheelbase fails V.1.2, a 4.6 bolt fails T.8.2.1, single shear asks for a check, missing values can't be checked",
      1.0 if (st14["wheelbase"], st14["track_ratio"], st14["fastener_grade"], st14["rod_end_shear"], st14["tilt"]) == ("fail", "pass", "fail", "manual", "unknown") else 0.0,
      1.0, 0, str(st14))

# 15. driver template and roll hoops in side view (F.5.6 to F.5.9)
import json  # noqa: E402
from susp.cockpit import template, side_dist, cockpit_values  # noqa: E402
ROOT15 = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ck15 = {"hip": [0.0, 0.0], "back_angle": 0.0, "main_hoop_top": [-200.0, 1100.0], "front_hoop_top": [800.0, 1100.0],
        "brace_lower": [-700.0, 300.0], "brace_upper": [-200.0, 1000.0], "pedal_face_x": 950.0, "wheel_top_z": 650.0, "wheel_front_x": 600.0}
h15, s15, hd15 = template(ck15)
check("template upright: head center height, mm", hd15[1], 490.0 + 280.0, 1e-9, "200 mm hip and shoulder circles 490 mm apart, head 280 mm on (F.5.6.5)")
ck15b = dict(ck15, back_angle=30.0)
check("template at a 30 deg back: head center x, mm", template(ck15b)[2][0], -770.0 * math.sin(math.radians(30)), 1e-9, "770 mm along the back, leaning rearward")
check("side distance below a horizontal line, mm", side_dist([0.0, 100.0], [-1.0, 300.0], [1.0, 300.0]), 200.0, 1e-9, "positive under the line")
check("side distance above it, mm", side_dist([0.0, 500.0], [1.0, 300.0], [-1.0, 300.0]), -200.0, 1e-9, "sign doesn't depend on the order of the ends")
v15 = cockpit_values(ck15)
check("helmet below a level hoop line, mm", v15["helmet_front_line"], 1100.0 - 770.0 - 150.0, 1e-9, "line height - head center - 150 mm head radius")
d15 = abs((hd15[0] + 200.0) * -800.0 - (hd15[1] - 1100.0) * -500.0) / math.hypot(500.0, 800.0)  # line hoop top -> brace end
check("helmet ahead of the rearward brace line, mm", v15["helmet_brace_line"], d15 - 150.0, 1e-9, "point-to-line distance less the head radius")
for k15, w15 in (("hip_to_pedals", 950.0), ("brace_drop", 100.0), ("front_hoop_over_wheel", 450.0), ("front_hoop_ahead_of_wheel", 200.0)):
    check(f"{k15.replace('_', ' ')}, mm", v15[k15], w15, 1e-9, "difference of the inputs")
check("braces extending forward: the brace-line check doesn't apply and the helmet must be ahead of the Main Hoop",
      1.0 if "na" in cockpit_values(dict(ck15, brace_lower=[300.0, 300.0]))["helmet_brace_line"] else 0.0, 1.0, 0, "F.5.6.4 b vs c")
ex15 = cockpit_values(json.load(open(os.path.join(ROOT15, "designs", "example_car_layout.json")))["cockpit"])
check("example car: helmet to the hoop line, mm", ex15["helmet_front_line"], 68.3, 0.05, "over 50 mm")
check("example car: helmet to the brace line, mm", ex15["helmet_brace_line"], 92.9, 0.05, "over 50 mm")

# 16. ground clearance over the body positions the dampers allow (V.1.4.1)
from susp.rules import ground_planes, ground_clearance, corner_limits  # noqa: E402
from susp.config import load_car as _lc16  # noqa: E402
f16, r16, _ = _lc16(os.path.join(ROOT15, "designs", "example_car_layout.json"))
fe16, re16 = evaluate(f16), evaluate(r16)
pl16, co16 = ground_planes(f16, fe16, r16, re16, f16["vehicle"]["wheelbase"])
WB16 = f16["vehicle"]["wheelbase"]
hiF, loR, hiR = co16[0]["hi"], co16[2]["lo"], co16[2]["hi"]
g16 = ground_clearance([{"name": "mid", "at": [-WB16 / 2, 0.0, 100.0]}], pl16)
check("ground: halfway between the axles the body comes down by the mean full bump (both axles bottomed), mm", g16["drop"], (hiF + hiR) / 2, 1e-6,
      "a rigid body: the drop is linear between the axles")
g16 = ground_clearance([{"name": "nose", "at": [300.0, 0.0, 100.0]}], pl16)
check("ground: 300 mm ahead of the front axle it comes down most with the front bottomed and the rear at full droop, mm", g16["drop"],
      hiF + (hiF - loR) * 300.0 / WB16, 1e-6, "pitch: the line through front full bump and rear full droop, extended")
lim16 = corner_limits(f16, fe16)
check("ground: full bump includes the tire squashing under the extra load, mm", hiF, lim16["bump"] + fe16["metrics"]["wheel_rate"] * lim16["bump"] / f16["spring"]["tire_rate"], 1e-9,
      "wheel rate x bump / tire rate")

# 17. frame and harness rules in side view (F.5.7.6 to F.6.4.4, V.1.4.2, T.2.5, T.2.6)
from susp.cockpit import frame_values  # noqa: E402
ck17 = {"main_hoop_top": [0.0, 1000.0], "front_hoop_top": [1000.0, 700.0], "back_angle": 20.0, "hip": [500.0, 200.0],
        "brace_upper": [0.0, 900.0], "brace_lower": [-400.0, 300.0], "sis_lower_low": [500.0, 80.0],
        "sis_upper_front": [990.0, 400.0], "sis_upper_rear": [10.0, 380.0], "front_hoop_at_sis": [1000.0 + 300.0 * math.tan(math.radians(15)), 400.0],
        "main_hoop_at_sis": [10.0, 380.0], "main_hoop_bottom": [40.0, 60.0], "lap_belt_mount": [400.0, 100.0],
        "shoulder_belt_mount": [0.0, 700.0], "shoulder_belt_spacing": 200.0}
t17 = template(ck17)
v17 = frame_values(ck17, t17)
check("frame: lower side impact member height, mm", v17["lsis_height"]["v"], 80.0, 1e-12, "its bottom's height")
check("frame: upper side impact member, lowest end above it, mm", v17["upper_sis_low"], 300.0, 1e-12, "380 - 80")
check("frame: front hoop above the side impact member, deg from vertical", v17["front_hoop_incline"], 15.0, 1e-9, "built at 15 deg, leaning rearward")
check("frame: main hoop above, deg from vertical", v17["main_hoop_incline_above"], math.degrees(math.atan2(10.0, 620.0)), 1e-9, "10 mm back over 620 mm")
check("frame: main hoop below leans rearward, deg", v17["main_hoop_rear_lean_below"], math.degrees(math.atan2(30.0, 320.0)), 1e-9, "the upper point 30 mm behind the bottom")
a17, b17 = np.array([-10.0, 620.0]), np.array([-400.0, -600.0])
check("frame: hoop to brace included angle, deg", v17["brace_angle"], math.degrees(math.acos(abs(a17 @ b17) / np.linalg.norm(a17) / np.linalg.norm(b17))), 1e-9, "acute angle between the lines")
check("harness: lap belt angle to the template's hip, deg", v17["lap_belt_upright"], math.degrees(math.atan2(100.0, 100.0)), 1e-9, "mount 100 mm behind and below the hip: 45 deg")
sh17 = t17[1]
check("harness: shoulder belt below horizontal from the shoulder's top, deg", v17["shoulder_belt_angle"], math.degrees(math.atan2(sh17[1] + 100 - 700.0, abs(sh17[0]))), 1e-9, "")

# 18. the anti-roll bar in the cornering cases (loads/arb.py)
from susp.loads.arb import arb_loads  # noqa: E402
fb18, rb18, _ = _lc16(os.path.join(ROOT15, "designs", "example_car_bars.json"))
e18 = evaluate(fb18, steer=False, pack=False)
L18 = run_loads(fb18, e18["susp"], e18["spring"])
A18, s18, sp18 = L18["arb_check"], e18["susp"], e18["spring"]
check("bar: its wheel rate in roll matches the ride model's (2 K_t theta'^2), N/mm", A18["k_bar"], e18["metrics"]["arb_wheel_rate"], 1e-3 * A18["k_bar"],
      "finite difference at ride height vs the sweep's gradient")
check("bar: its share of the roll, k_bar / (k_bar + k_spring)", A18["share"], A18["k_bar"] / (A18["k_bar"] + A18["k_wheel"]), 1e-12, "")
# virtual work: the damper's and the bar's wheel forces add up to the pushrod's, the pushrod unchanged
xs18 = {z: s18.states([z])[float(z)] for z in (-0.5, 0.5)}
mr18 = (sp18.state(xs18[-0.5])["damper_len"] - sp18.state(xs18[0.5])["damper_len"]) / 1.0
pts18 = _geometry(s18, sp18)[0]
v_rod18 = (sp18.state(xs18[0.5])["rod_out"] - sp18.state(xs18[-0.5])["rod_out"]) / 1.0
e_rod18 = (pts18["rod_in"] - pts18["rod_out"]) / np.linalg.norm(pts18["rod_in"] - pts18["rod_out"])
r18 = L18["results"]["corner outer"]
W_rod18 = -r18["pushrod"] * float(e_rod18 @ v_rod18)
W_d18 = -r18["damper"] * mr18
W_b18 = next(r_ for r_ in A18["rows"] if r_["case"] == "corner outer")["wheel"]
check("bar on the rocker: damper's + bar's wheel force = the pushrod's (corner outer), N", W_d18 + W_b18, W_rod18, 1e-3 * abs(W_rod18),
      "virtual work over a mm of bump; the rocker in balance about its axis")
pl18 = part_loads(fb18, s18, sp18, L18)["corner outer"]["rocker"]
fs18 = sum(F for _, _, F in pl18)
mk18 = sum(float(sp18.k @ np.cross(p - sp18.c, F)) for _, p, F in pl18)
check("bar on the rocker: the rocker's part loads (with the bar's link) balance, N and N m", float(np.linalg.norm(fs18)) + abs(mk18) / 1000, 0.0, 1e-6,
      "forces sum to zero, and moments about the rocker axis")

bad = [r for r in results if not r[0]]
print(f"\n{len(results) - len(bad)} of {len(results)} hand-calculation checks passed")
sys.exit(1 if bad else 0)
