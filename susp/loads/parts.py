"""Part loads for FEA: every force on each part of one corner (the right-hand side), with where it acts, for each
load case. Apply them to the part's model in CAD (Onshape, SolidWorks Simulation, Fusion) to check a gusset, a bracket
or an upright in detail.

Parts and forces (N, + along the solver's X forward, Y right, Z up; points in mm):
  upright       the tire's forces (and the wheel center's, for inboard brakes or drive), each ball joint, the tie rod
                (toe link), and the pushrod when it mounts on the upright
  each wishbone its ball joint and both pivots; the one carrying the pushrod also its mount. Its pivots take the
                load along the pivot axis in the split the statics assume (closest to the legs' directions)
  rocker        the pushrod end, the damper end and the pivot (the pivot's bearing also takes a couple, so in FEA hold
                the rocker at its pivot bore and apply the other two)
Each part's forces add up to zero, and so do their moments (the rocker's only about its own axis): a fixed support
at the pivots in FEA then carries almost nothing, which is a good check that the loads went in right."""
from __future__ import annotations

import numpy as np

from ..kinematics import unit
from .cases import load_cases
from .statics import arm_reactions, _geometry

TIRE_PT = {"cp": "contact patch", "c": "wheel center"}


def part_loads(cfg, susp, sp, run):
    """run: run_loads output. Returns {case: {part: [(point name, point, force)]}}."""
    cases, _ = load_cases(cfg, susp, run["info"].get("lltd"))            # the same tire forces run_loads used
    forces = {n: f for n, f, *_ in cases}
    out = {}
    for name, r in run["results"].items():
        dz = run["deflect"].get(name, 0.0)
        pts, inb, outb, st = _geometry(susp, sp, dz) if dz else _geometry(susp, sp)
        e = {k: unit(inb[k] - outb[k]) for k in inb}           # tension pulls the outboard end inboard
        T = {k: float(r[k]) for k in ("upper_front", "upper_rear", "lower_front", "lower_rear", "tie_rod", "pushrod")}
        up = [(f"tire force at the {TIRE_PT[p]}", pts[p], np.array(F, float)) for F, p in forces[name.replace(" (deflected)", "")]]
        up.append(("tie rod outboard", pts["tro"], T["tie_rod"] * e["tie_rod"]))
        f_rod = T["pushrod"] * unit(pts["rod_in"] - pts["rod_out"])     # the rod's pull on whatever it mounts on
        parts = {}
        arms = {"upper": ("ubj", "upper_front", "upper_rear"), "lower": ("lbj", "lower_front", "lower_rear")}
        for arm, (bj, kf, kr) in arms.items():
            if arm == sp.on:
                continue
            on_up = T[kf] * e[kf] + T[kr] * e[kr]
            up.append((f"{arm} ball joint", pts[bj], on_up))
            parts[f"{arm} wishbone"] = [("ball joint", pts[bj], -on_up), ("front pivot" if inb[kf][0] >= inb[kr][0] else "rear pivot", inb[kf], T[kf] * e[kf]),
                                        ("rear pivot" if inb[kf][0] >= inb[kr][0] else "front pivot", inb[kr], T[kr] * e[kr])]
        if sp.on == "upright":
            up.append(("pushrod mount", pts["rod_out"], f_rod))
        else:
            arm = sp.on
            bj, kf, kr = arms[arm]
            Fb = -sum(F for _, _, F in up)                          # the arm's push on the upright closes its balance
            up.append((f"{arm} ball joint", pts[bj], Fb))
            p1, p2 = inb[kf], inb[kr]
            Mext = np.cross(pts[bj] - p1, -Fb) + np.cross(pts["rod_out"] - p1, f_rod)
            R1, R2 = arm_reactions(p1, p2, e[kf], e[kr], -Fb + f_rod, Mext)
            fr_first = inb[kf][0] >= inb[kr][0]
            parts[f"{arm} wishbone"] = [("ball joint", pts[bj], -Fb), ("pushrod mount", pts["rod_out"], f_rod),
                                        ("front pivot" if fr_first else "rear pivot", p1, R1),
                                        ("rear pivot" if fr_first else "front pivot", p2, R2)]
        parts = {"upright": up, **dict(sorted(parts.items(), reverse=True))}
        if not sp.direct:
            Td = float(r["damper"])
            ed = unit(sp.dch - st["damper_out"])
            push = T["pushrod"] * unit(pts["rod_out"] - pts["rod_in"])
            dmp = Td * ed
            parts["rocker"] = [("pushrod end", pts["rod_in"], push), ("damper end", st["damper_out"], dmp),
                               ("pivot", sp.c, -(push + dmp))]
        out[name] = {k: [(n, np.array(p, float), np.array(F, float)) for n, p, F in v] for k, v in parts.items()}
    return out


def to_csv(loads):
    rows = ["case,part,point,x_mm,y_mm,z_mm,Fx_N,Fy_N,Fz_N"]
    for case, parts in loads.items():
        for part, items in parts.items():
            for n, p, F in items:
                rows.append(",".join([case, part, n] + [f"{v:.3f}" for v in p] + [f"{v:.2f}" for v in F]))
    return "\n".join(rows) + "\n"
