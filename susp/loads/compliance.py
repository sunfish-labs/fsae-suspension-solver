"""Compliance: toe and camber change from the links, rod ends and chassis tabs stretching under load."""
from __future__ import annotations

import math

import numpy as np

from .statics import MEMBERS, _geometry, solve_FM
from .strength import tube_props


def link_stiffness(cfg, k, length):
    """Axial stiffness (N/mm) of one link: two rod ends, the tube (E A / L) and the chassis mount in series."""
    mem = cfg["members"]
    size = "wishbone" if k.startswith(("upper", "lower")) else k
    A, _ = tube_props(*mem[size])
    parts = [mem["E"] * A / length]
    if mem.get("rod_end_k"):
        parts += [mem["rod_end_k"]] * 2
    if mem.get("mount_k"):
        parts.append(mem["mount_k"])
    if k == "tie_rod" and cfg["axle"] == "front":
        parts += steering_stiffness(cfg)
    return 1.0 / sum(1.0 / x for x in parts)


def steering_stiffness(cfg):
    """Front tie rod only: the rack and its mounts (members.rack_k, N/mm along the rack) and the steering column's
    torsion (members.column_k, N m/deg at the wheel) seen at the rack through vehicle.rack_c_factor (mm of rack per
    steering-wheel turn): a rack force F turns the column by F (c / 2 pi) / 1000 / column_k degrees, which moves the
    rack by that x c / 360 mm."""
    mem, out = cfg["members"], []
    if mem.get("rack_k"):
        out.append(float(mem["rack_k"]))
    cf = cfg["vehicle"].get("rack_c_factor")
    if mem.get("column_k") and cf:
        out.append(float(mem["column_k"]) / ((cf / (2 * math.pi) / 1000.0) * (cf / 360.0)))
    return out


IMPACT_CASES = ("bump", "pothole", "kerb strike", "bump (deflected)", "pothole (deflected)")


def compliance(cfg, susp, sp, results):
    """Toe and camber change from link stretch under each load case (not in the kinematic curves).
    Each link is an axial spring (two rod ends, the tube and the chassis mount in series); the wishbone bodies,
    upright, rocker and rack are rigid and the damper is held at its length.
    Right-hand wheel: camber change = -theta_x, toe-in change = -theta_z (deg)."""
    _, inb, outb, _ = _geometry(susp, sp)
    k = {m: link_stiffness(cfg, m, float(np.linalg.norm(inb[m] - outb[m]))) for m in MEMBERS}
    cp = susp.h["cp"]
    # unit-load method: the member forces from a unit force (at the origin) or unit moment on the upright, so the
    # upright's translation and rotation come out exactly consistent with the statics (work in = sum T^2 / k)
    unit_rows = [solve_FM(susp, sp, np.eye(3)[i], np.zeros(3)) for i in range(3)] + \
                [solve_FM(susp, sp, np.zeros(3), np.eye(3)[i]) for i in range(3)]
    cases = []
    for name, r in results.items():
        st = {m: r[m] / k[m] for m in MEMBERS}
        q = np.array([sum(st[m] * u[m] for m in MEMBERS) for u in unit_rows])
        d, th = q[:3], q[3:]
        dcp = d + np.cross(th, cp)
        cases.append(dict(case=name, camber=-math.degrees(th[0]), toe=-math.degrees(th[2]),
                          cp_y=float(dcp[1]), cp_z=float(dcp[2]),
                          worst_stretch=max(abs(v) for v in st.values()), d=d.tolist(), theta=th.tolist(),
                          driving=name not in IMPACT_CASES))
    mem = cfg["members"]
    tl, cl = mem.get("toe_comp_limit"), mem.get("camber_comp_limit")
    drv = [c for c in cases if c["driving"]] or cases       # limits apply to driving cases, not bumps and impacts
    w_toe = max(drv, key=lambda c: abs(c["toe"]))
    w_cam = max(drv, key=lambda c: abs(c["camber"]))
    return dict(stiffness=k, cases=cases, toe_limit=tl, camber_limit=cl, worst_toe=w_toe, worst_camber=w_cam,
                toe_ok=(tl is None or abs(w_toe["toe"]) <= tl), camber_ok=(cl is None or abs(w_cam["camber"]) <= cl))
