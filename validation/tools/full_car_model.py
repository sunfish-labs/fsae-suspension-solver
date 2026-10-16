"""Roll gradient and lateral load transfer by a full-car stiffness model, written to validation/car_*.json.

    python3 validation/tools/full_car_model.py            (rewrites the files)
    python3 validation/tools/full_car_model.py --check    (compares with the files on disk, for CI)

The solver's car balance (susp/car.py) uses the closed-form roll-axis formulas: axle roll stiffnesses from wheel
rates, bars and tires in series, the elastic transfer split by stiffness, the geometric part through the roll
centers. This tool builds the same physical model as a set of springs and masses and solves it as a matrix
problem instead, sharing no code with car.py:

  - the sprung body has heave, roll and pitch; each wheel moves up and down on its tire;
  - each corner's wheel rate is a spring between the body and the wheel, each tire a spring between the wheel
    and the ground, and each anti-roll bar a spring on the difference of its two corners' travel;
  - per g of lateral acceleration, the sprung weight's moment about the roll axis rolls the body, and the lateral
    forces that pass through the roll centers (sprung share at the roll center, unsprung mass at its own center)
    load the outer tires and unload the inner ones directly.

Solving the stiffness matrix gives every tire's load change and the body roll; the roll gradient and the LLTD
follow. Inputs from the solver: each corner's wheel rate, roll center height, loaded radius and, when the corner
has an anti-roll bar linkage, that bar's roll stiffness (all from the kinematics)."""
import json
import math
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from susp.config import load_car  # noqa: E402
from susp.kinematics import evaluate  # noqa: E402

G = 9.81
CARS = [("example_car", "designs/example_car.json", None),
        ("example_car_stiff_front_bar", "designs/example_car.json", (400.0, 120.0)),
        ("example_car_bars", "designs/example_car_bars.json", None)]


def car_model(fc, fe, rc, re_, arb_f, arb_r):
    veh = fc["vehicle"]
    m, wf, h, WB = veh["mass"], veh["weight_front"], veh["cg_height"] / 1000, veh["wheelbase"] / 1000
    ax = []
    for cfg, ev, arb_in, x in ((fc, fe, arb_f, 0.0), (rc, re_, arb_r, -WB)):
        bar = ev["ride"].get("arb_roll")                       # Nm/deg of body roll, from the bar's geometry
        ax.append(dict(t=ev["susp"].track / 1000, x=x, kw=ev["ride"]["wheel_rate"] * 1000,
                       kt=cfg["spring"]["tire_rate"] * 1000, mu=2 * cfg["spring"]["unsprung_mass"],
                       R=ev["susp"].R / 1000, zrc=ev["metrics"]["roll_center"] / 1000,
                       arb=(bar if bar is not None else arb_in) * 180 / math.pi))   # Nm/rad
    f_, r_ = ax
    f_["ms"], r_["ms"] = m * wf - f_["mu"], m * (1 - wf) - r_["mu"]
    ms = f_["ms"] + r_["ms"]
    hs = (m * h - f_["mu"] * f_["R"] - r_["mu"] * r_["R"]) / ms
    xs = (f_["ms"] * f_["x"] + r_["ms"] * r_["x"]) / ms           # sprung center of mass
    z_axis = f_["zrc"] + (r_["zrc"] - f_["zrc"]) * (f_["x"] - xs) / (f_["x"] - r_["x"])
    # degrees of freedom (all positive down): body heave z, roll phi (+ pushes the outer side, +y, down), pitch th;
    # wheel travel w for front-outer, front-inner, rear-outer, rear-inner. Tire load change = kt w.
    n = 7
    Kmat, f = np.zeros((n, n)), np.zeros(n)
    wheels = []
    for i, a in enumerate(ax):
        for side in (1, -1):
            wheels.append((a, side, 3 + 2 * i + (side < 0)))

    def spring(k, coef):
        c = np.zeros(n)
        for j, v in coef:
            c[j] += v
        Kmat[:] += k * np.outer(c, c)
        return c
    travel = {}
    for a, side, j in wheels:
        y = side * a["t"] / 2
        travel[j] = [(0, 1.0), (1, y), (2, -a["x"]), (j, -1.0)]      # body point minus wheel = suspension travel
        spring(a["kw"], travel[j])
        spring(a["kt"], [(j, 1.0)])
    for i, a in enumerate(ax):
        if a["arb"]:
            jo, ji = 3 + 2 * i, 4 + 2 * i
            # bar energy k_bar (d_o - d_i)^2 / 4 per axle, k_bar = 2 K / t^2 (wheel rate in pure roll)
            spring(2 * a["arb"] / a["t"] ** 2 / 2, travel[jo] + [(j, -v) for j, v in travel[ji]])
    # twist test: the front-outer wheel stands on a shim 1 mm (0.001 m) high, no lateral acceleration
    ft = np.zeros(n)
    ft[3] = ax[0]["kt"] * 0.001                                    # tire spring pushed up from below by the shim
    ut = np.linalg.solve(Kmat, ft)
    dFt_r = ax[1]["kt"] * (ut[5] - ut[6]) / 2                     # rear diagonal load change per wheel, N per mm
    K_warp = dFt_r * r_["t"] / math.degrees(0.001 / f_["t"])       # moment through the car per degree of front twist
    f[1] = ms * G * (hs - z_axis)                                  # roll moment per g about the roll axis
    for i, a in enumerate(ax):
        geo = (a["ms"] * G * a["zrc"] + a["mu"] * G * a["R"]) / a["t"]
        f[3 + 2 * i] += geo                                        # outer wheel pushed down, inner lifted
        f[4 + 2 * i] -= geo
    u = np.linalg.solve(Kmat, f)
    dF = [ax[i]["kt"] * (u[3 + 2 * i] - u[4 + 2 * i]) / 2 for i in range(2)]     # per-wheel transfer
    tf, tr = f_["t"], r_["t"]
    return dict(K_warp=abs(K_warp), grad=math.degrees(u[1]), dFz_f=dF[0], dFz_r=dF[1], lltd=dF[0] * tf / (dF[0] * tf + dF[1] * tr),
                heave=u[0] * 1000, moment_check=dF[0] * tf + dF[1] * tr - m * G * h)


def main():
    check = "--check" in sys.argv
    bad = 0
    for tag, path, arbs in CARS:
        fc, rc, info = load_car(os.path.join(ROOT, path))
        arb_f, arb_r = arbs or (info["arb_f"], info["arb_r"])
        fe, re_ = evaluate(fc, steer=False, pack=False), evaluate(rc, steer=False, pack=False)
        r = car_model(fc, fe, rc, re_, arb_f, arb_r)
        assert abs(r["moment_check"]) < 1e-6 and abs(r["heave"]) < 1e-9, r
        vals = {k: r[k] for k in ("grad", "lltd", "dFz_f", "dFz_r", "K_warp")}
        ref = {k: [round(v, 9), round(1e-6 * max(1.0, abs(v)), 12)] for k, v in vals.items()}
        out = {"name": f"{info['name']}: roll gradient and load transfer by a full-car stiffness model"
                       + (f" (bars {arb_f:g} / {arb_r:g} Nm/deg)" if arbs else ""),
               "source": "validation/tools/full_car_model.py: springs-and-masses matrix model, no car.py code",
               "car": path, "arb": [arb_f, arb_r], "car_balance": ref}
        fn = os.path.join(ROOT, "validation", f"car_{tag}.json")
        if check:
            old = json.load(open(fn))["car_balance"]
            for k, (v, tol) in ref.items():
                if abs(old[k][0] - v) > tol:
                    bad += 1
                    print(f"{tag} {k}: file {old[k][0]}, now {v}")
        else:
            with open(fn, "w") as fh:
                json.dump(out, fh, indent=1)
                fh.write("\n")
            print(f"wrote {os.path.relpath(fn, ROOT)}: " + ", ".join(f"{k} {v:.4g}" for k, v in vals.items()))
    if check:
        print("full-car model files up to date" if not bad else f"{bad} values differ")
        sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
