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


def rod_leg(susp, sp):
    """The leg of the arm carrying the rod that the rod mount sits closest to: (leg, length, a from pivot, offset)."""
    pts, inb, outb, _ = _geometry(susp, sp)
    best = None
    for leg in (f"{sp.on}_front", f"{sp.on}_rear"):
        p0, p1 = inb[leg], outb[leg]
        u = unit(p1 - p0)
        Lg = float(np.linalg.norm(p1 - p0))
        a = float(np.clip((pts["rod_out"] - p0) @ u, 0.0, Lg))
        off = float(np.linalg.norm(pts["rod_out"] - (p0 + a * u)))
        if best is None or off < best[3]:
            best = (leg, Lg, a, off)
    return best


def section(od, wall, t_g=0.0, h=0.0):
    """The leg's cross-section with a gusset plate welded along it: the tube plus a t_g x h rectangle standing on the
    tube's surface in the plane of the load. Returns (area, I about the combined neutral axis, distance from that
    axis to the farther extreme fiber). h = 0 is the bare tube."""
    A_t, I_t = tube_props(od, wall)
    r = od / 2
    if h <= 1e-9 or t_g <= 0:
        return A_t, I_t, r
    A_p, y_p = t_g * h, r + h / 2                       # plate area and its centroid's distance from the tube axis
    A = A_t + A_p
    yb = A_p * y_p / A                                  # neutral axis, measured from the tube axis toward the plate
    Imom = I_t + A_t * yb ** 2 + t_g * h ** 3 / 12 + A_p * (y_p - yb) ** 2
    return A, Imom, max(r + yb, r + h - yb)


def gusset_of(cfg):
    """members.gusset, how the pushrod mount is reinforced, or None for a bare tube:
      {"type": "along_leg" (default), thickness, height (at the mount), length_in (toward the pivot), length_out
       (toward the ball joint)}: a triangular plate welded along the leg under the mount;
      {"type": "to_node"}: a bracket that carries the pushrod's push straight into the ball-joint node, so the leg
       is not bent (check the bracket itself in CAD with the exported part loads)."""
    g = (cfg.get("members") or {}).get("gusset")
    if not g:
        return None
    if g.get("type") == "to_node":
        return dict(type="to_node")
    return dict(type="along_leg", thickness=float(g["thickness"]), height=float(g["height"]),
                length_in=float(g.get("length_in") or 0.0), length_out=float(g.get("length_out") or 0.0),
                fat=float(g["fat"]) if g.get("fat") else None)


def leg_stress(cfg, leg, r, geom):
    """Peak fiber stress (bending + |axial|) in that leg for member forces r at geometry geom. The leg is a beam pinned
    at the pivot and the ball joint with the pushrod's push across it at the mount; with a gusset (members.gusset,
    a triangle from its full height at the mount down to nothing at each end) the section along it is the tube plus
    the plate, so the stress is searched along the whole leg. end_stress: the bare tube's stress at the gusset's ends,
    where its weld stops (the fatigue hot spot)."""
    gp, gi, go, _ = geom
    od, wall = cfg["members"]["wishbone"]
    p0, p1 = gi[leg], go[leg]
    uu, Lc = unit(p1 - p0), float(np.linalg.norm(p1 - p0))
    ac = float(np.clip((gp["rod_out"] - p0) @ uu, 0.0, Lc))
    F = r["pushrod"] * unit(gp["rod_in"] - gp["rod_out"])         # the pushrod's pull on the arm at the mount
    P_perp = float(np.linalg.norm(F - (F @ uu) * uu))
    M = P_perp * ac * (Lc - ac) / Lc
    n_pivot = float(r[leg])                                        # tension between the pivot and the mount
    n_node = float(n_pivot - F @ uu)                               # tension between the mount and the ball joint
    g = gusset_of(cfg)
    if g is not None and g["type"] == "to_node":                   # the bracket takes the push into the node
        A, _ = tube_props(od, wall)
        return dict(P_perp=P_perp, moment=0.0, stress=max(abs(n_pivot), abs(n_node)) / A, n_pivot=n_pivot,
                    n_node=n_node, x=ac, where="carried to the ball-joint node by the bracket", end_stress=None)
    if g is None:
        A, Imom = tube_props(od, wall)
        sig = M * (od / 2) / Imom + max(abs(n_pivot), abs(n_node)) / A
        return dict(P_perp=P_perp, moment=M, stress=sig, n_pivot=n_pivot, n_node=n_node, x=ac, where="at the mount",
                    end_stress=None)
    x_in, x_out = max(0.0, ac - g["length_in"]), min(Lc, ac + g["length_out"])

    def h_at(x):
        if x < x_in or x > x_out:
            return 0.0
        side = ac - x_in if x <= ac else x_out - ac
        return g["height"] * (1 - abs(x - ac) / side) if side > 1e-9 else (g["height"] if abs(x - ac) < 1e-9 else 0.0)

    def stress_at(x, h=None):
        h = h_at(x) if h is None else h
        A, Imom, c = section(od, wall, g["thickness"], h)
        Mx = P_perp * x * (Lc - ac) / Lc if x <= ac else P_perp * ac * (Lc - x) / Lc
        return Mx * c / Imom + abs(n_pivot if x <= ac else n_node) / A

    xs = sorted(set([Lc * i / 400 for i in range(401)] + [x_in, x_out, ac]))
    best = max((stress_at(x), x) for x in xs)
    ends = [stress_at(x, 0.0) for x in (x_in, x_out) if 0.0 < x < Lc]      # gusset ends on the tube (not at a pivot)
    x = best[1]
    where = ("gusset end" if min(abs(x - x_in), abs(x - x_out)) < Lc / 400 + 1e-9 and x != ac
             else "in the gusset" if x_in < x < x_out else "bare tube")
    return dict(P_perp=P_perp, moment=M, stress=best[0], n_pivot=n_pivot, n_node=n_node, x=x, where=where,
                end_stress=max(ends) if ends else None)


def bending_check(cfg, susp, sp, results, deflect=None):
    """The wishbone leg that carries the pushrod mount, as a beam pinned at the inboard pivot and the ball joint.
    The pushrod force's component across the leg at distance a from the pivot gives M = P a (L - a) / L. The axial
    force steps at the mount by the pushrod's component along the leg, so the larger of the two segment forces
    (N at the pivot, N minus that component beyond the mount) is used: stress = M c / I + max |N| / A.
    deflect: {case name: wheel travel} for cases solved at a deflected position."""
    if sp.on not in ("lower", "upper"):
        return None
    deflect = deflect or {}
    geom0 = _geometry(susp, sp)
    leg, Lg, a, off = rod_leg(susp, sp)
    od, wall = cfg["members"]["wishbone"]
    worst = None
    for name, r in results.items():
        g = _geometry(susp, sp, deflect[name]) if deflect.get(name) else geom0
        s = leg_stress(cfg, leg, r, g)
        if worst is None or s["stress"] > worst["stress"]:
            worst = dict(case=name, **s)
    sy = cfg["members"]["yield"]
    return dict(leg=leg, length=Lg, a=a, offset=off, od=od, wall=wall, gusset=gusset_of(cfg),
                sf=sy / worst["stress"] if worst["stress"] > 1e-9 else float("inf"), **worst)
