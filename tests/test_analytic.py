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

bad = [r for r in results if not r[0]]
print(f"\n{len(results) - len(bad)} of {len(results)} hand-calculation checks passed")
sys.exit(1 if bad else 0)
