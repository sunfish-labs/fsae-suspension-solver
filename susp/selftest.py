"""Validation: (1) KineSolver comparison runs (private file, if present), (2) first-principles physics checks."""
from __future__ import annotations

import copy
import json
import os

import numpy as np

from .config import SHORT2LONG, TEMPLATE_FRONT, TEMPLATE_REAR, make_config
from .kinematics import Suspension, evaluate
from .loads import solve_case
from .output import table
from .car import G, car_balance


def _hp(**kw):
    return {SHORT2LONG[k]: list(v) for k, v in kw.items()}


# KineSolver comparison cases live in private/kinesolver_cases.json (kept out of the public repo because they
# contain the team's hardpoints). Format: [{"name", "config", "checks": [[series, "top"|"bottom", value, tol]]}].
# KineSolver chart end-labels = data max/min padded by 5 % of the data range (observed on its charts).
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KS_FILE = os.path.join(_HERE, "private", "kinesolver_cases.json")


def _ks_tests():
    if not os.path.exists(KS_FILE):
        return None
    with open(KS_FILE) as f:
        return [(c["name"], c["config"], [tuple(x) for x in c["checks"]]) for c in json.load(f)]


# equal-length parallel horizontal arms, vertical upright, parallel tie rod: closed-form answers are known
PARALLEL = dict(name="parallel equal arms", axle="front", wheel={"camber_deg": 0.0, "toe_deg": 0.0},
                hardpoints=_hp(uif=(0, 200, 350), uir=(400, 200, 350), lif=(0, 200, 150), lir=(400, 200, 150),
                               ubj=(200, 600, 350), lbj=(200, 600, 150), tri=(100, 200, 250), tro=(100, 600, 250),
                               cp=(200, 650, 0)))


def kinesolver_checks():
    tests = _ks_tests()
    if tests is None:
        print("\nKineSolver comparison skipped: private/kinesolver_cases.json not found (it holds team hardpoints).")
        return 0
    bad = 0
    for name, over, checks in tests:
        rows = Suspension(make_config(over)).heave_sweep(41, 30.0)
        print(f"\n{name}")
        out = []
        for key, which, ks, tol in checks:
            vals = np.array([r[key] for r in rows])
            pad = 0.05 * (vals.max() - vals.min())
            mine = vals.max() + pad if which == "top" else vals.min() - pad
            ok = abs(mine - ks) <= tol
            bad += (not ok)
            out.append([f"{key} {which}", f"{ks:g}", f"{mine:.3f}", f"{mine - ks:+.3f}", "ok" if ok else "MISMATCH"])
        table(["chart label", "KineSolver", "this tool", "diff", ""], out)
    return bad


def physics_checks():
    res = []

    def check(name, got, want, tol):
        ok = abs(got - want) <= tol
        res.append([name, f"{want:.6g}", f"{got:.6g}", "ok" if ok else "FAIL"])
        return ok

    # 1. parallel equal arms
    ev = evaluate(make_config(PARALLEL), steer=False)
    m = ev["metrics"]
    cam = [r["camber"] for r in ev["rows"]]
    check("parallel arms: camber change over heave (deg)", max(cam) - min(cam), 0.0, 1e-6)
    check("parallel arms: bump steer (deg over travel)", m["bump_steer_max"], 0.0, 1e-6)
    check("parallel arms: roll camber (deg/deg)", m["roll_camber"], 1.0, 1e-6)
    check("parallel arms: roll center height (mm)", m["roll_center"], 0.0, 1e-6)

    # 2. roll sweep at 0 deg reproduces the heave roll center; symmetric roll keeps RC on centerline
    ev = evaluate(make_config(TEMPLATE_FRONT))
    m, R = ev["metrics"], ev["roll"]
    r0 = R[len(R) // 2]
    check("roll sweep RC at 0 deg = heave RC (mm)", r0["rc_height"], m["roll_center"], 1e-6)
    check("roll sweep RC lateral at 0 deg (mm)", r0["rc_lateral"], 0.0, 1e-6)
    check("outer camber(+roll) = inner camber(-roll) (symmetry)", R[-1]["camber_outer"], R[0]["camber_inner"], 1e-9)

    # 3. virtual work: statics and kinematics must agree. Damper compression C satisfies
    #    C * MR = Fz + Fy * d(cp_y)/dz   (contact-patch forces; MR = -dL_damper/dz)
    s, sp = ev["susp"], ev["spring"]
    rows = ev["rows"]
    i0 = len(rows) // 2
    dz = rows[i0 + 1]["dz"] - rows[i0 - 1]["dz"]
    dcpy = (rows[i0 + 1]["cp_y"] - rows[i0 - 1]["cp_y"]) / dz
    MR = (rows[i0 - 1]["damper_len"] - rows[i0 + 1]["damper_len"]) / dz
    Fz, Fy = 1000.0, -800.0
    T = solve_case(s, sp, [(np.array([0, 0, Fz]), "cp"), (np.array([0, Fy, 0]), "cp")])
    want = (Fz + Fy * dcpy) / MR
    check("virtual work, rocker + lower-arm pushrod: damper force (N)", -T["damper"], want, 2e-3 * abs(want))
    # same with a direct-acting damper mounted on the upright
    c2 = copy.deepcopy(TEMPLATE_FRONT)
    c2["spring"] = dict(c2["spring"], rod_on="upright", rod_outboard=[-5.0, 555.0, 200.0],
                        rocker_pivot=None, rocker_axis=None, rocker_rod=None, rocker_damper=None,
                        damper_chassis=[-5.0, 280.0, 420.0])
    e2 = evaluate(make_config(c2), pack=False, steer=False)
    rows = e2["rows"]
    MR2 = (rows[i0 - 1]["damper_len"] - rows[i0 + 1]["damper_len"]) / dz
    dcpy2 = (rows[i0 + 1]["cp_y"] - rows[i0 - 1]["cp_y"]) / dz
    T2 = solve_case(e2["susp"], e2["spring"], [(np.array([0, 0, Fz]), "cp"), (np.array([0, Fy, 0]), "cp")])
    want2 = (Fz + Fy * dcpy2) / MR2
    check("virtual work, direct damper on upright: damper force (N)", -T2["damper"], want2, 2e-3 * abs(want2))

    # 4. equilibrium of the upright when every member is a two-force link (upright-mounted rod)
    from .loads import MEMBERS, _geometry
    from .kinematics import unit
    pts, inb, outb, _ = _geometry(e2["susp"], e2["spring"])
    F = np.array([300.0, -900.0, 1500.0])
    T3 = solve_case(e2["susp"], e2["spring"], [(F, "cp")])
    netF = F + sum(T3[k] * unit(inb[k] - outb[k]) for k in MEMBERS)
    netM = np.cross(pts["cp"], F) + sum(np.cross(outb[k], T3[k] * unit(inb[k] - outb[k])) for k in MEMBERS)
    check("upright equilibrium: |net force| (N)", float(np.linalg.norm(netF)), 0.0, 1e-6)
    check("upright equilibrium: |net moment| (Nmm)", float(np.linalg.norm(netM)), 0.0, 1e-3)

    # 5. the suggested spring hits the target frequency
    c3 = copy.deepcopy(TEMPLATE_FRONT)
    k_need = ev["metrics"]["spring_for_target"]
    c3["spring"]["spring_rate"] = k_need
    f3 = evaluate(make_config(c3), steer=False, pack=False)["metrics"]["ride_freq"]
    check("spring_for_target gives the target ride frequency (Hz)", f3, c3["spring"]["target_freq_hz"], 1e-6)

    # 6. whole-car lateral load transfer adds up to m*g*h per g
    fc, rc = make_config(TEMPLATE_FRONT), make_config(TEMPLATE_REAR)
    fe, re_ = evaluate(fc, steer=False, pack=False), evaluate(rc, steer=False, pack=False)
    cb = car_balance(fc, fe, rc, re_)
    tot = cb["dFz_f"] * fe["susp"].track / 1000 + cb["dFz_r"] * re_["susp"].track / 1000
    veh = fc["vehicle"]
    check("car: total load-transfer moment = m g h (Nm/g)", tot, veh["mass"] * G * veh["cg_height"] / 1000, 1e-6)

    print("\nPhysics checks (first principles - independent of KineSolver)")
    table(["check", "expected", "this tool", ""], res)
    return sum(1 for r in res if r[3] != "ok")


def run():
    bad = kinesolver_checks() + physics_checks()
    print("\nNote: mechanical trail in heave is measured from the current contact patch (KineSolver differs).")
    print("ALL CHECKS PASSED" if not bad else f"{bad} CHECKS FAILED")
    return 1 if bad else 0
