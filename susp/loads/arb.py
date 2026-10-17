"""The anti-roll bar in the cornering load cases: its drop link's force, the bar's twist stress, and, when the bar is
driven from the rocker, the damper and rocker pivot forces with the bar taking its share.

In a corner the body rolls: the outer wheel goes up and the inner one down by the same amount, and the spring and
the bar both resist it, in proportion to their wheel rates (the spring's k_w and the bar's k_b = 2 K_t theta'^2 per
wheel in roll). The spring path's force for the roll is the antisymmetric part of the two wheels' cases, half the
difference between this wheel as the outer and as the inner one (the car is symmetric), measured as the force it
puts back on the wheel by virtual work: W = -f . v, f the pushrod's force on its mount and v that mount's movement
per mm of bump. The bar takes the share s = k_b / (k_w + k_b) of it; its drop link's force follows from the same
virtual work at the link's lower end, along the link.

The rest of the load cases keep the pushrod carrying everything (so the arms and the pushrod stay a little
conservative); a bar driven from the rocker only changes the damper and the rocker's pivot, solved here from the
rocker's balance about its axis."""
from __future__ import annotations

import math

import numpy as np

from ..kinematics import unit
from ..ride import ArbLink
from .statics import _geometry, wheel_rate_at_ride
from .strength import tube_props

PAIRS = (("corner outer", "corner inner"), ("brake+corner outer", "brake+corner inner"))


def bar_kt(a):
    """The bar's torsional stiffness (N mm / rad) and its polar moment J (mm^4)."""
    od = float(a["bar_od"])
    wall = a.get("bar_wall")
    di = 0.0 if not wall else max(0.0, od - 2 * float(wall))
    J = math.pi / 32 * (od ** 4 - di ** 4)
    Lb = float(a.get("bar_length") or 2 * abs(float(a["arm_tip"][1])))
    return float(a.get("bar_G") or 79300.0) * J / Lb, J


def _link_at(susp, sp, bar, z):
    x = susp.states([z])[float(z)]
    st = sp.state(x) if sp is not None else None
    return x, st, bar.link_out(x, st)


def arb_loads(cfg, susp, sp, results):
    """The bar's share in the cornering cases, or None without a bar linkage (cfg.arb). Changes results in place for
    a bar on the rocker (damper, rocker_pivot) and adds results[case]["arb_link"] (N, + = tension) to every case."""
    a = cfg.get("arb")
    if not a or sp is None:
        return None
    bar = ArbLink(susp, sp, a)
    h = 0.5
    th = {}
    for z in (-h, 0.0, h):
        x, st, _ = _link_at(susp, sp, bar, z)
        th[z] = bar.theta(x, st)
    tp = (th[h] - th[-h]) / (2 * h)                              # bar arm rad per mm of wheel travel
    Kt, J = bar_kt(a)
    k_b = 2 * Kt * tp ** 2
    k_w = wheel_rate_at_ride(cfg, susp, sp)
    s = k_b / (k_w + k_b) if k_w + k_b > 1e-12 else 0.0
    # how the pushrod's mount and the link's lower end move per mm of bump, at ride height
    pts, _, _, st0 = _geometry(susp, sp)
    xs = {z: susp.states([z])[float(z)] for z in (-h, h)}
    rod = {z: sp.state(xs[z])["rod_out"] for z in (-h, h)}
    v_rod = (rod[h] - rod[-h]) / (2 * h)
    lk = {z: bar.link_out(xs[z], sp.state(xs[z])) for z in (-h, h)}
    v_link = (lk[h] - lk[-h]) / (2 * h)
    p_link = bar.link_out(susp.states([0.0])[0.0], st0)
    e_link = unit(bar.t0 - p_link)                              # along the link, from its lower end to the bar arm
    ev = float(e_link @ v_link)
    r_eff = abs(float(bar.k @ np.cross(bar.t0 - bar.c, e_link)))   # the link's lever about the bar axis
    e_rod = unit(pts["rod_in"] - pts["rod_out"])
    for r in results.values():
        r["arb_link"] = 0.0

    def W(r):
        """The vertical force the pushrod path holds the wheel with (N), by virtual work over a mm of bump."""
        return -float(r["pushrod"]) * float(e_rod @ v_rod)
    rows = []
    for o, i in PAIRS:
        if o not in results or i not in results:
            continue
        dW = (W(results[o]) - W(results[i])) / 2                # the roll part, + on the outer wheel
        for case, sgn in ((o, 1.0), (i, -1.0)):
            Wb = s * sgn * dW
            lam = -Wb / ev if abs(ev) > 1e-9 else 0.0           # force on the link's lower end along e_link
            # the link pulls its lower end toward the bar arm with its tension: f = T e_link, so T = lam
            results[case]["arb_link"] = float(lam)
            M = abs(lam) * r_eff
            tau = M * (float(a["bar_od"]) / 2) / J
            rows.append(dict(case=case, link=float(lam), wheel=float(Wb), torque=float(M), tau=float(tau)))
            if bar.on == "rocker" and not sp.direct:
                _rocker_balance(sp, susp, results[case], lam * e_link, p_link)
    if not rows:
        return None
    yld = float(a.get("bar_yield") or cfg["members"]["yield"])
    od, wall = a.get("link_tube") or cfg["members"]["pushrod"]
    A, Imom = tube_props(float(od), float(wall))
    Lk = float(np.linalg.norm(bar.t0 - p_link))
    E, Sy = cfg["members"]["E"], cfg["members"]["yield"]
    peak = max(abs(r_["link"]) for r_ in rows)
    comp = max([-r_["link"] for r_ in rows if r_["link"] < 0] or [0.0])
    Pcr = math.pi ** 2 * E * Imom / Lk ** 2
    rating = cfg["members"].get("rod_end_rating")
    worst = max(rows, key=lambda r_: r_["tau"])
    return dict(on=bar.on, share=s, p_link=p_link, e_link=e_link, k_bar=k_b, k_wheel=k_w, rows=rows, link_length=Lk, link_od=float(od),
                link_wall=float(wall), peak=peak, compression=comp,
                sf_buckle=Pcr / comp if comp > 1e-9 else float("inf"), sf_yield=Sy * A / peak if peak > 1e-9 else float("inf"),
                sf_rod_end=(rating / peak if peak > 1e-9 else float("inf")) if rating else None,
                tau=worst["tau"], tau_case=worst["case"], sf_bar=0.577 * yld / worst["tau"] if worst["tau"] > 1e-9 else float("inf"))


def _rocker_balance(sp, susp, r, f_link, p_link):
    """With the bar's link on the rocker: the damper force from the rocker's balance about its axis (the pushrod as
    solved, the link's force f_link at p_link), and the pivot's resultant."""
    pts, _, _, st = _geometry(susp, sp)
    c, k = sp.c, sp.k
    f_rod = float(r["pushrod"]) * unit(pts["rod_out"] - pts["rod_in"])
    ed = unit(sp.dch - st["damper_out"])
    m_rod = k @ np.cross(pts["rod_in"] - c, f_rod)
    m_link = k @ np.cross(p_link - c, f_link)
    m_d = k @ np.cross(st["damper_out"] - c, ed)
    Td = -(m_rod + m_link) / m_d
    r["damper"] = float(Td)
    r["rocker_pivot"] = float(np.linalg.norm(f_rod + Td * ed + f_link))
