"""Member forces by a stiffness (displacement) model, written to validation/stiffness_*.json.

    python3 validation/tools/stiffness_model.py            (rewrites the files)
    python3 validation/tools/stiffness_model.py --check    (compares with the files on disk, for CI)

The solver finds member forces by equilibrium (the force method): the upright's six balance equations, the arm
carrying the pushrod as one rigid body, then the rocker. This tool gets them the other way, the way a finite-element
program does (the displacement method), and shares no statics code with the solver:

  - every part (upright, the arm that carries the rod, the rocker) is a rigid body with 6 small displacements;
  - every joint is a very stiff spring: a ball joint or pivot ties two points together in all three directions,
    a rod (wishbone leg, tie rod, pushrod, damper) resists only stretching along its length;
  - the tire forces go on the upright, the stiffness matrix is assembled and solved for the displacements, and each
    member's force is its stiffness times its stretch.

The arm that carries the rod is held by a ball joint at each inboard pivot, so how the load along the pivot axis is
shared between its two pivots is set by stiffness, not statics: those two legs are not compared (the solver reports
an assumed split for them). Everything else is statically determinate, so both methods must agree exactly.

Inputs from the solver: the tire forces of each load case (cases.py) and, for the deflected cases, where the parts
are at that wheel travel (the kinematics). Both are inputs to the statics, not the statics."""
import json
import os
import sys

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from susp.config import load_config, make_config  # noqa: E402
from susp.kinematics import Suspension  # noqa: E402
from susp.loads import _geometry, run_loads  # noqa: E402  (positions only; run_loads lists the deflected cases)
from susp.loads.cases import load_cases  # noqa: E402
from susp.ride import Spring  # noqa: E402

K = 1.0e6       # N/mm, every joint and rod: only ratios matter for a statically determinate structure


def G(p):
    """Displacement of point p for a body twist (v, w): v + w x p = [I, -[p]x] (v, w)."""
    x, y, z = p
    return np.hstack([np.eye(3), np.array([[0, z, -y], [-z, 0, x], [y, -x, 0]])])


class Model:
    def __init__(self, bodies):
        self.idx = {b: 6 * i for i, b in enumerate(bodies)}
        n = 6 * len(bodies)
        self.Kg, self.f = np.zeros((n, n)), np.zeros(n)
        self.el = []

    def _B(self, body, p, rows):
        """Rows mapping all body displacements to the displacement of point p on body (ground: zero)."""
        B = np.zeros((rows.shape[0], len(self.f)))
        if body != "ground":
            i = self.idx[body]
            B[:, i:i + 6] = rows @ G(p)
        return B

    def pin(self, name, p, a, b):
        """Ball joint at p between bodies a and b (all three directions)."""
        B = self._B(a, p, np.eye(3)) - self._B(b, p, np.eye(3))
        self.Kg += K * B.T @ B
        self.el.append((name, "pin", B))

    def rod(self, name, p, a, q, b):
        """Two-force member from p on body a to q on body b. Tension positive."""
        e = (q - p) / np.linalg.norm(q - p)
        B = self._B(b, q, e[None, :]) - self._B(a, p, e[None, :])        # stretch
        self.Kg += K * B.T @ B
        self.el.append((name, "rod", B))

    def load(self, body, p, F):
        i = self.idx[body]
        self.f[i:i + 6] += G(p).T @ F

    def solve(self):
        u = np.linalg.solve(self.Kg, self.f)
        return {n: (K * B @ u) for n, kind, B in self.el}


def member_forces(cfg, susp, sp, forces, pose):
    """forces: [(F, point name)] on the upright. pose: positions of every point at this wheel travel."""
    h = susp.h
    on, direct = sp.on, sp.direct
    bodies = ["upright"] + ([f"{on}_arm"] if on in ("upper", "lower") else []) + ([] if direct else ["rocker"])
    m = Model(bodies)
    legs = {"upper": ("ubj", ("upper_front", "uif"), ("upper_rear", "uir")),
            "lower": ("lbj", ("lower_front", "lif"), ("lower_rear", "lir"))}
    for arm, (bj, *lg) in legs.items():
        if arm == on:                                    # rigid arm: pinned at both pivots and at the ball joint
            for name, piv in lg:
                m.pin(f"{arm}_pivot_{name}", h[piv], "ground", f"{arm}_arm")
            m.pin(f"{arm}_balljoint", pose[bj], f"{arm}_arm", "upright")
        else:                                            # two legs straight from the pivots to the ball joint
            for name, piv in lg:
                m.rod(name, h[piv], "ground", pose[bj], "upright")
    m.rod("tie_rod", h["tri"], "ground", pose["tro"], "upright")
    carrier = f"{on}_arm" if on in ("upper", "lower") else "upright"
    if direct:
        m.rod("pushrod", pose["rod_out"], carrier, sp.dch, "ground")
    else:
        m.rod("pushrod", pose["rod_out"], carrier, pose["rod_in"], "rocker")
        m.pin("rocker_pin_a", sp.c + 20 * sp.k, "ground", "rocker")
        m.pin("rocker_pin_b", sp.c - 20 * sp.k, "ground", "rocker")
        m.rod("damper", pose["damper_out"], "rocker", sp.dch, "ground")
    for F, p in forces:
        m.load("upright", pose[p], F)
    r = m.solve()
    out = {k: float(v[0]) for k, v in r.items() if v.shape == (1,)}
    if direct:
        out["damper"] = out["pushrod"]
    else:
        # force from the rocker on the chassis at the pivot (both pins together)
        out["rocker_pivot"] = float(np.linalg.norm(r["rocker_pin_a"] + r["rocker_pin_b"]))
    return out


def pose_at(susp, sp, dz):
    pts, _, _, st = _geometry(susp, sp, dz)
    return dict(pts, damper_out=st["damper_out"])


def variants():
    """The example corners plus the other ways the rod can be mounted (same hardpoints, mount moved)."""
    front = json.load(open(os.path.join(ROOT, "designs", "example_front.json")))
    on_upright = json.loads(json.dumps(front))
    on_upright["name"] = "Example front, rod on the upright"
    on_upright["spring"]["rod_on"] = "upright"
    on_upper = json.loads(json.dumps(front))
    on_upper["name"] = "Example front, pullrod on the upper wishbone"
    on_upper["spring"].update(rod_on="upper", rod_outboard=[-5.0, 535.0, 340.0], rocker_pivot=[-5.0, 205.0, 150.0],
                              rocker_rod=[-5.0, 246.4, 103.0], rocker_damper=[-5.0, 201.5, 70.3],
                              damper_chassis=[-5.0, 372.0, 83.7])
    direct = json.loads(json.dumps(front))
    direct["name"] = "Example front, damper acting directly on the lower wishbone"
    direct["spring"].update(rocker_pivot=None, rocker_axis=None, rocker_rod=None, rocker_damper=None,
                            rod_outboard=[-5.0, 470.0, 160.0], damper_chassis=[-5.0, 240.0, 420.0])
    return [("example_front", "designs/example_front.json", None),
            ("example_rear", "designs/example_rear.json", None),
            ("front_rod_on_upright", None, on_upright),
            ("front_pullrod_upper", None, on_upper),
            ("front_direct_damper", None, direct)]


def build(design, conf):
    cfg = load_config(os.path.join(ROOT, design)) if design else make_config(conf)
    susp = Suspension(cfg)
    sp = Spring(susp, cfg["spring"])
    cases, _ = load_cases(cfg, susp)
    run = run_loads(cfg, susp, sp)                     # only to know which deflected cases exist, and where
    forces = {n: f for n, f, *_ in cases}
    loads = {}
    for name in run["results"]:
        base = name.replace(" (deflected)", "")
        dz = run["deflect"].get(name, 0.0)
        r = member_forces(cfg, susp, sp, forces[base], pose_at(susp, sp, dz))
        skip = {f"{sp.on}_front", f"{sp.on}_rear"}       # stiffness-shared legs of the arm carrying the rod
        loads[name] = {k: [round(v, 6), round(1e-6 * max(1000.0, abs(v)), 9)] for k, v in r.items() if k not in skip}
    return cfg, loads


def main():
    check = "--check" in sys.argv
    bad = 0
    for tag, design, conf in variants():
        cfg, loads = build(design, conf)
        out = {"name": f"{cfg.get('name', tag)}: member forces by a stiffness model",
               "source": "validation/tools/stiffness_model.py, displacement method (rigid bodies on stiff joints), "
                         "no solver statics code",
               **({"design": design} if design else {"config": conf}),
               "loads": loads}
        path = os.path.join(ROOT, "validation", f"stiffness_{tag}.json")
        if check:
            old = json.load(open(path))
            for c, mem in loads.items():
                for k, (v, tol) in mem.items():
                    if abs(old["loads"][c][k][0] - v) > tol:
                        bad += 1
                        print(f"{tag} {c} {k}: file {old['loads'][c][k][0]}, now {v}")
        else:
            with open(path, "w") as f:
                json.dump(out, f, indent=1)
                f.write("\n")
            print(f"wrote {os.path.relpath(path, ROOT)}: {len(loads)} cases")
    if check:
        print("stiffness model files up to date" if not bad else f"{bad} values differ")
        sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
