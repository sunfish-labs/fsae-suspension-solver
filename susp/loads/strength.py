"""Strength: buckling and yield of the links, rod ends and bolts, and the pushrod mount bending its leg."""
from __future__ import annotations

import math

import numpy as np

from ..kinematics import unit
from .statics import MEMBERS, _geometry


def tube_props(od, wall):
    di = od - 2 * wall
    A = math.pi / 4 * (od ** 2 - di ** 2)
    Imom = math.pi / 64 * (od ** 4 - di ** 4)
    return A, Imom


def member_checks(cfg, susp, sp, results):
    """Per member: worst compression vs Euler buckling load, worst |force| vs yield force, and the FOS of each."""
    mem = cfg["members"]
    E, Sy = mem["E"], mem["yield"]
    _, inb, outb, _ = _geometry(susp, sp)
    size = {"upper_front": "wishbone", "upper_rear": "wishbone", "lower_front": "wishbone",
            "lower_rear": "wishbone", "tie_rod": "tie_rod", "pushrod": "pushrod"}
    rows = []
    for k in MEMBERS:
        od, wall = mem[size[k]]
        A, Imom = tube_props(od, wall)
        L = float(np.linalg.norm(inb[k] - outb[k]))
        Pcr = math.pi ** 2 * E * Imom / L ** 2           # pin-ended Euler column (K = 1)
        Py = Sy * A                                    # axial force that yields the tube
        vals = [(r[k], name) for name, r in results.items()]
        tmax = max(vals)
        cmin = min(vals)
        comp = -cmin[0] if cmin[0] < 0 else 0.0
        peak, p_case = max((abs(v), n) for v, n in vals)
        rows.append(dict(member=k, size=size[k], length=L, od=od, wall=wall, area=A,
                         tension=max(0.0, tmax[0]), t_case=tmax[1], compression=comp, c_case=cmin[1],
                         Pcr=Pcr, Py=Py, peak=peak, p_case=p_case,
                         sf_buckle=Pcr / comp if comp > 1e-6 else float("inf"),
                         sf_yield=Py / peak if peak > 1e-6 else float("inf"), rod_end=peak))
    return rows


BOLT_UTS = {"8.8": 800.0, "10.9": 1040.0, "12.9": 1220.0, "SAE 5": 827.0, "SAE 8": 1034.0}   # MPa, minimum tensile


def part_checks(cfg, rows):
    """Rod ends and bolts at each member end, against the worst |force| in that member over all cases.
    Bolt shear capacity = shear planes x area x 0.6 x tensile strength (ultimate). Rod end: catalog rating."""
    mem = cfg["members"]
    d, planes = float(mem.get("bolt_dia") or 0), int(mem.get("bolt_shear_planes") or 2)
    uts = BOLT_UTS.get(str(mem.get("bolt_grade")), 0.0)
    cap = planes * math.pi / 4 * d * d * 0.6 * uts if d and uts else None
    rating = mem.get("rod_end_rating")
    out = []
    for r in rows:
        out.append(dict(member=r["member"], peak=r["peak"], p_case=r["p_case"], bolt_capacity=cap,
                        sf_bolt=(cap / r["peak"] if cap and r["peak"] > 1e-6 else (float("inf") if cap else None)),
                        rod_end_rating=rating, sf_rod_end=(rating / r["peak"] if rating and r["peak"] > 1e-6 else (float("inf") if rating else None))))
    return out


def bending_check(cfg, susp, sp, results, deflect=None):
    """The wishbone leg that carries the pushrod mount, as a beam pinned at the inboard pivot and the ball joint.
    The pushrod force's component across the leg at distance a from the pivot gives M = P a (L - a) / L. The axial
    force steps at the mount by the pushrod's component along the leg, so the larger of the two segment forces
    (N at the pivot, N minus that component beyond the mount) is used: stress = M c / I + max |N| / A.
    deflect: {case name: wheel travel} for cases solved at a deflected position."""
    if sp.on not in ("lower", "upper"):
        return None
    deflect = deflect or {}
    pts, inb, outb, st = _geometry(susp, sp)
    arm = sp.on
    best = None
    for leg in (f"{arm}_front", f"{arm}_rear"):
        p0, p1 = inb[leg], outb[leg]
        u = unit(p1 - p0)
        Lg = float(np.linalg.norm(p1 - p0))
        a = float(np.clip((pts["rod_out"] - p0) @ u, 0.0, Lg))
        off = float(np.linalg.norm(pts["rod_out"] - (p0 + a * u)))
        if best is None or off < best[3]:
            best = (leg, u, Lg, off, a)
    leg, _u, Lg, off, a = best
    od, wall = cfg["members"]["wishbone"]
    A, Imom = tube_props(od, wall)
    worst = None
    for name, r in results.items():
        gp, gi, go, _ = _geometry(susp, sp, deflect[name]) if deflect.get(name) else (pts, inb, outb, st)
        p0, p1 = gi[leg], go[leg]
        uu, Lc = unit(p1 - p0), float(np.linalg.norm(p1 - p0))
        ac = float(np.clip((gp["rod_out"] - p0) @ uu, 0.0, Lc))
        F = r["pushrod"] * unit(gp["rod_in"] - gp["rod_out"])         # the pushrod's pull on the arm at the mount
        P_perp = float(np.linalg.norm(F - (F @ uu) * uu))
        M = P_perp * ac * (Lc - ac) / Lc
        n_pivot = r[leg]                                               # tension between the pivot and the mount
        n_node = n_pivot - F @ uu                                      # tension between the mount and the ball joint
        sig = M * (od / 2) / Imom + max(abs(n_pivot), abs(n_node)) / A
        if worst is None or sig > worst["stress"]:
            worst = dict(case=name, P_perp=P_perp, moment=M, stress=sig, n_pivot=float(n_pivot), n_node=float(n_node))
    sy = cfg["members"]["yield"]
    return dict(leg=leg, length=Lg, a=a, offset=off, od=od, wall=wall, sf=sy / worst["stress"] if worst["stress"] > 1e-9 else float("inf"), **worst)
