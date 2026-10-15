"""Quasi-static load cases -> forces in the wishbone legs, tie rod, pushrod, damper and rocker.

Members are pin-ended (rod ends / spherical bearings). The upright is in equilibrium under the tire force and
the link forces. If the pushrod sits on a wishbone, that wishbone is a three-force body: its ball-joint force is
solved first, then the moment about its pivot axis gives the pushrod force, and the remaining load at the outer
node is split between the two legs. Any part the legs cannot take in tension/compression is reported as a
bending load. That load is small when the pushrod mount is close to the ball joint."""
from __future__ import annotations

import math

import numpy as np

from .kinematics import SolveError, unit

G = 9.81
MEMBERS = ["upper_front", "upper_rear", "lower_front", "lower_rear", "tie_rod", "pushrod"]
MEMBER_LABEL = {"upper_front": "Upper leg (pivot {uif})", "upper_rear": "Upper leg (pivot {uir})",
                "lower_front": "Lower leg (pivot {lif})", "lower_rear": "Lower leg (pivot {lir})",
                "tie_rod": "Tie rod", "pushrod": "Pushrod/pullrod"}


def load_cases(cfg, susp):
    """Tire forces on this corner (the right-hand wheel) for each case.

    The car is symmetric, so one config covers both corners of its axle: in a left turn this wheel is the
    OUTER wheel, in a right turn it is the INNER wheel. Both are checked because the inner wheel's lateral force
    points the other way and can put a different member into compression.
    Returns (cases, info): cases = [(name, [(F, point_name)], description, Fz_breakdown)]."""
    veh, L = cfg["vehicle"], cfg["loads"]
    W = veh["mass"] * G
    wf, h, WB = veh["weight_front"], veh["cg_height"], veh["wheelbase"]
    front = cfg["axle"] == "front"
    share = wf if front else 1 - wf
    lltd = L.get("lltd_front") or wf
    lat_share = lltd if front else 1 - lltd
    t = susp.track
    info = dict(W=W, share=share, Fz0=W * share / 2, long_per_g=W * h / WB / 2, lat_per_g=W * h / t * lat_share,
                lat_share=lat_share, h=h, WB=WB, t=t)

    def wheel(ax=0.0, ay=0.0, side=1):
        """Vertical load and how it was built: static + longitudinal transfer + lateral transfer."""
        d_long = (-1 if front else 1) * ax * info["long_per_g"]   # braking (ax<0) loads the front
        d_lat = side * abs(ay) * info["lat_per_g"]
        Fz = max(0.0, info["Fz0"] + d_long + d_lat)
        parts = f"{info['Fz0']:.0f} static"
        if d_long:
            parts += f" {'+' if d_long > 0 else '-'} {abs(d_long):.0f} long."
        if d_lat:
            parts += f" {'+' if d_lat > 0 else '-'} {abs(d_lat):.0f} lat."
        return Fz, parts

    cp, c = "cp", "c"
    brake_pt = c if veh["brakes"] == "inboard" else cp
    drive_pt = c if veh["drive"] == "inboard" else cp
    cases = []
    Fz0 = info["Fz0"]
    cases.append(("bump", [(np.array([0, 0, L["bump_g"] * Fz0]), cp)], f"{L['bump_g']:g} x static wheel load",
                  f"{L['bump_g']:g} x {Fz0:.0f} static"))
    ay = L["corner_g"]
    for side, nm in ((1, "outer"), (-1, "inner")):
        Fz, parts = wheel(ay=ay, side=side)
        # both tires push the car toward the turn center: -Y for the outer (right) wheel, +Y for the inner
        cases.append((f"corner {nm}", [(np.array([0, 0, Fz]), cp), (np.array([0, -side * ay * Fz, 0]), cp)],
                      f"{ay:g} g lateral, {nm} wheel", parts))
    ax = -L["brake_g"]
    Fz, parts = wheel(ax=ax)
    cases.append(("braking", [(np.array([0, 0, Fz]), cp), (np.array([ax * Fz, 0, 0]), brake_pt)],
                  f"{L['brake_g']:g} g braking (Fx = {L['brake_g']:g} x Fz)", parts))
    g2 = L["combined_g"]
    for side, nm in ((1, "outer"), (-1, "inner")):
        Fz, parts = wheel(ax=-g2, ay=g2, side=side)
        cases.append((f"brake+corner {nm}", [(np.array([0, 0, Fz]), cp), (np.array([0, -side * g2 * Fz, 0]), cp),
                                             (np.array([-g2 * Fz, 0, 0]), brake_pt)],
                      f"{g2:g} g braking + {g2:g} g lateral, {nm} wheel", parts))
    if not front:
        ax = L["accel_g"]
        Fz, parts = wheel(ax=ax)
        cases.append(("acceleration", [(np.array([0, 0, Fz]), cp), (np.array([ax * W / 2, 0, 0]), drive_pt)],
                      f"{ax:g} g acceleration (rear drive, Fx = {ax:g} g x car weight / 2)", parts))
    return cases, info


def _geometry(susp, sp):
    h = susp.h
    st = sp.static()
    pts = {"ubj": h["ubj"], "lbj": h["lbj"], "tro": h["tro"], "cp": h["cp"], "c": susp.c0,
           "rod_out": st["rod_out"], "rod_in": st["rod_in"]}
    inb = {"upper_front": h["uif"], "upper_rear": h["uir"], "lower_front": h["lif"], "lower_rear": h["lir"],
           "tie_rod": h["tri"], "pushrod": st["rod_in"]}
    outb = {"upper_front": h["ubj"], "upper_rear": h["ubj"], "lower_front": h["lbj"], "lower_rear": h["lbj"],
            "tie_rod": h["tro"], "pushrod": st["rod_out"]}
    return pts, inb, outb, st


def solve_case(susp, sp, forces):
    """Member forces (N, + = tension) for tire forces [(F, point)] applied to the upright."""
    pts, inb, outb, st = _geometry(susp, sp)
    F = sum(f for f, _ in forces)
    M = sum(np.cross(pts[p], f) for f, p in forces)
    e = {k: unit(inb[k] - outb[k]) for k in MEMBERS}      # tension pulls the outboard end inboard
    out = {}
    if sp.on == "upright":
        cols = [np.r_[e[k], np.cross(outb[k], e[k])] for k in MEMBERS]
        A = np.array(cols).T
        T = np.linalg.solve(A, -np.r_[F, M])
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
        if np.linalg.cond(A) > 1e12:
            raise SolveError("Link layout is singular for statics - check hardpoints.")
        sol = np.linalg.solve(A, -np.r_[F, M])
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
        node = -Fb + Tp * e["pushrod"]                   # total load on the arm's outer node
        # leg tension T pulls the node toward its pivot: node + sum(T_i e_i) = 0
        legs = np.array([e[f"{arm}_front"], e[f"{arm}_rear"]]).T
        Tl, *_ = np.linalg.lstsq(legs, -node, rcond=None)
        resid = node + legs @ Tl
        out[f"{arm}_front"], out[f"{arm}_rear"] = float(Tl[0]), float(Tl[1])
        out["bending"] = float(np.linalg.norm(resid))
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


def tube_props(od, wall):
    di = od - 2 * wall
    A = math.pi / 4 * (od ** 2 - di ** 2)
    I = math.pi / 64 * (od ** 4 - di ** 4)
    return A, I


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
        A, I = tube_props(od, wall)
        L = float(np.linalg.norm(inb[k] - outb[k]))
        Pcr = math.pi ** 2 * E * I / L ** 2           # pin-ended Euler column (K = 1)
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


def run_loads(cfg, susp, sp):
    cases, info = load_cases(cfg, susp)
    res, desc, tire, fz = {}, {}, {}, {}
    for name, forces, d, parts in cases:
        res[name] = solve_case(susp, sp, forces)
        desc[name], fz[name] = d, parts
        tire[name] = sum(f for f, _ in forces)
    return dict(results=res, desc=desc, tire=tire, fz_parts=fz, Fz0=info["Fz0"], info=info,
                checks=member_checks(cfg, susp, sp, res))


def member_label(k, susp):
    h = susp.h
    return MEMBER_LABEL[k].format(uif=f"X={h['uif'][0]:.0f}", uir=f"X={h['uir'][0]:.0f}",
                                  lif=f"X={h['lif'][0]:.0f}", lir=f"X={h['lir'][0]:.0f}")
