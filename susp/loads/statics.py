"""Statics: member forces that hold the upright (and the arm carrying the pushrod) in equilibrium."""
from __future__ import annotations

import math

import numpy as np

from ..kinematics import SolveError, unit

MEMBERS = ["upper_front", "upper_rear", "lower_front", "lower_rear", "tie_rod", "pushrod"]


MEMBER_LABEL = {"upper_front": "Upper leg (pivot {uif})", "upper_rear": "Upper leg (pivot {uir})",
                "lower_front": "Lower leg (pivot {lif})", "lower_rear": "Lower leg (pivot {lir})",
                "tie_rod": "Tie rod", "pushrod": "Pushrod/pullrod"}


def _geometry(susp, sp, dz=0.0):
    """Link end points at ride height (dz = 0) or at a wheel travel dz (mm, rack centered): (pts, inb, outb, st)."""
    h = susp.h
    if not dz:
        st = sp.static()
        ub, lb, tro, cp, c = h["ubj"], h["lbj"], h["tro"], h["cp"], susp.c0
    else:
        x = susp.states([dz])[float(dz)]
        q = susp.observe(x, dz)["_pts"]
        ub, lb, tro, cp, c = q["ub"], q["lb"], q["tro"], q["cp"], q["c"]
        th, n = 0.0, max(1, int(math.ceil(abs(dz) / 5.0)))       # walk the rocker out so it stays on its branch
        for i in range(1, n + 1):
            d = dz * i / n
            st = sp.state(susp.states([d])[float(d)], th)
            th = math.radians(st["rocker_deg"])
    pts = {"ubj": ub, "lbj": lb, "tro": tro, "cp": cp, "c": c, "rod_out": st["rod_out"], "rod_in": st["rod_in"]}
    inb = {"upper_front": h["uif"], "upper_rear": h["uir"], "lower_front": h["lif"], "lower_rear": h["lir"],
           "tie_rod": h["tri"], "pushrod": st["rod_in"]}
    outb = {"upper_front": ub, "upper_rear": ub, "lower_front": lb, "lower_rear": lb, "tie_rod": tro, "pushrod": st["rod_out"]}
    return pts, inb, outb, st


def solve_case(susp, sp, forces, geom=None):
    """Member forces (N, + = tension) for tire forces [(F, point)] applied to the upright."""
    geom = geom or _geometry(susp, sp)
    pts = geom[0]
    F = sum(f for f, _ in forces)
    M = sum(np.cross(pts[p], f) for f, p in forces)
    return solve_FM(susp, sp, F, M, geom)


def arm_reactions(p1, p2, e1, e2, Fsum, Mext):
    """Pivot reactions R1, R2 on a rigid wishbone carrying external force Fsum and moment Mext (about p1).
    Equilibrium fixes everything except how the load along the pivot axis is shared, so take the split that keeps
    the reactions closest to the leg directions e1, e2 (the legs are close to two-force members). With every load at
    the outer node this is exactly the pin-jointed truss answer."""
    d = p2 - p1
    u = unit(d)
    r2 = np.cross(d, Mext) / float(d @ d)                # the part of R2 the moments fix: d x R2 = -Mext
    x0 = np.r_[-Fsum - r2, r2]                           # forces then fix R1
    nvec = np.r_[-u, u]                                  # moving axial load from one pivot to the other
    P = np.zeros((6, 6))
    P[:3, :3] = np.eye(3) - np.outer(e1, e1)
    P[3:, 3:] = np.eye(3) - np.outer(e2, e2)
    Pn = P @ nvec
    lam = -float((P @ x0) @ Pn) / float(Pn @ Pn) if Pn @ Pn > 1e-18 else 0.0
    x = x0 + lam * nvec
    return x[:3], x[3:]


SINGULAR = ("The links can't hold the wheel in this position: two or more of them line up (for example the tie rod "
            "in line with a wishbone leg). Check the hardpoints.")


def cond1(A):
    """1-norm condition number (the browser uses the same measure)."""
    try:
        return float(np.linalg.norm(A, 1) * np.linalg.norm(np.linalg.inv(A), 1))
    except np.linalg.LinAlgError:
        return float("inf")


def _solve_statics(A, b):
    """A x = b for the link forces, refusing a near-singular layout (it would give huge, meaningless forces)."""
    if not cond1(A) < 1e12:
        raise SolveError(SINGULAR)
    return np.linalg.solve(A, b)


def solve_FM(susp, sp, F, M, geom=None):
    """Member forces for a net force F (N) and moment M (N mm, about the origin) on the upright."""
    pts, inb, outb, st = geom or _geometry(susp, sp)
    e = {k: unit(inb[k] - outb[k]) for k in MEMBERS}      # tension pulls the outboard end inboard
    out = {}
    if sp.on == "upright":
        cols = [np.r_[e[k], np.cross(outb[k], e[k])] for k in MEMBERS]
        A = np.array(cols).T
        T = _solve_statics(A, -np.r_[F, M])
        out = dict(zip(MEMBERS, T))
        out["bending"] = 0.0
    else:
        arm = sp.on                                      # "lower" or "upper"
        other = "upper" if arm == "lower" else "lower"
        bj = pts["lbj"] if arm == "lower" else pts["ubj"]
        unk = [f"{other}_front", f"{other}_rear", "tie_rod"]
        cols = [np.r_[np.eye(3)[i], np.cross(bj, np.eye(3)[i])] for i in range(3)]
        cols += [np.r_[e[k], np.cross(outb[k], e[k])] for k in unk]
        A = np.array(cols).T
        sol = _solve_statics(A, -np.r_[F, M])
        Fb = sol[:3]                                     # force from the arm on the upright, at the ball joint
        out.update(zip(unk, sol[3:]))
        # arm: -Fb at the ball joint, pushrod T e_p at rod_out, zero moment about the pivot axis
        a = inb[f"{arm}_front"]
        u = unit(inb[f"{arm}_rear"] - a)
        m_bj = u @ np.cross(bj - a, -Fb)
        m_p = u @ np.cross(pts["rod_out"] - a, e["pushrod"])     # moment of a unit rod tension on the arm
        if abs(m_p) < 1e-9:
            raise SolveError("The pushrod has no lever arm about the wishbone pivot axis.")
        Tp = -m_bj / m_p
        out["pushrod"] = Tp
        # the arm as one rigid body: -Fb at the ball joint, the pushrod at its mount, a reaction at each pivot
        f_rod = Tp * e["pushrod"]
        p1, p2 = inb[f"{arm}_front"], inb[f"{arm}_rear"]
        e1, e2 = e[f"{arm}_front"], e[f"{arm}_rear"]
        Mext = np.cross(bj - p1, -Fb) + np.cross(pts["rod_out"] - p1, f_rod)
        R1, R2 = arm_reactions(p1, p2, e1, e2, -Fb + f_rod, Mext)
        out[f"{arm}_front"], out[f"{arm}_rear"] = float(R1 @ e1), float(R2 @ e2)   # leg tension at the pivot
        # load the legs carry across themselves (zero when the pushrod mounts at the ball-joint node)
        out["bending"] = float(math.hypot(np.linalg.norm(R1 - (R1 @ e1) * e1), np.linalg.norm(R2 - (R2 @ e2) * e2)))
    # rocker: rod pulls the rocker toward rod_out with T, damper tension Td along rocker_damper -> chassis
    Tp = out["pushrod"]
    if sp.direct:
        Td = Tp
        piv = 0.0
    else:
        c, k = sp.c, sp.k
        f_rod = Tp * unit(pts["rod_out"] - pts["rod_in"])
        ed = unit(sp.dch - st["damper_out"])
        m_rod = k @ np.cross(pts["rod_in"] - c, f_rod)
        m_d = k @ np.cross(st["damper_out"] - c, ed)
        Td = -m_rod / m_d
        piv = float(np.linalg.norm(f_rod + Td * ed))
    out["damper"] = Td
    out["rocker_pivot"] = piv
    return out


def wheel_rate_at_ride(cfg, susp, sp):
    """Spring rate x motion ratio^2 at ride height, the motion ratio from +/-1 mm of wheel travel."""
    xs = susp.states([-1.0, 1.0])
    L1, L2 = (sp.state(xs[d])["damper_len"] for d in (-1.0, 1.0))
    mr = abs(L1 - L2) / 2.0
    from ..ride import spring_rate_at   # local import: ride imports kinematics, as statics does
    return spring_rate_at(cfg["spring"], 0.0) * mr * mr


def member_label(k, susp):
    """Legs named by where the pivot physically is (larger X = front); the JSON keys follow KineSolver's naming."""
    h = susp.h
    def fr(a, b):
        return "front" if a[0] >= b[0] else "rear"
    return {"upper_front": f"Upper {fr(h['uif'], h['uir'])} leg", "upper_rear": f"Upper {fr(h['uir'], h['uif'])} leg",
            "lower_front": f"Lower {fr(h['lif'], h['lir'])} leg", "lower_rear": f"Lower {fr(h['lir'], h['lif'])} leg",
            "tie_rod": "Tie rod", "pushrod": "Pushrod/pullrod"}[k]
