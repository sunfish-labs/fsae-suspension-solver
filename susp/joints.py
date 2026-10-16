"""Rod-end and spherical-bearing misalignment over the whole travel and rack range.

Every joint is a ball in a race. The bolt through the ball is fixed to one part (the "mount": chassis, upright, arm
or rocker); the race is fixed to the other. Over the suspension's motion the race tilts relative to the bolt, and
that tilt (the misalignment angle) must stay inside the part's catalog limit, or the joint binds and bends the bolt
or the link.

Two kinds of joint:
- rod end: the race is in a rod-end body screwed onto a link (wishbone leg, tie rod, pushrod, damper eye). The link
  can turn about its own axis, so only the angle between the link and the plane square to the bolt matters:
  misalignment = asin(|u . b|), u = link direction, b = bolt axis (moving with its mount).
- bearing: a spherical bearing pressed into a part (the ball joints: race in the wishbone, bolt in the upright),
  assumed aligned at ride height: misalignment = the angle between the bolt axis carried by each part.

Bolt directions (joints.<key>.bolt): "x", "y", "z", "pivot" (that wishbone's pivot axis), "kingpin" (ball joint to ball
joint), "rocker" (the rocker axis) or [x, y, z] at ride height. With "square": true the direction is first squared to the link at ride height (a bracket
built square to the rod end), so the joint starts at 0. Defaults are listed in DEFAULT_JOINTS. The limit is
joints.<key>.allow, else members.rod_end_misalign / members.bearing_misalign (degrees, from the catalog)."""
from __future__ import annotations

import math

import numpy as np

from .kinematics import heave_points, rodrigues, travel_range, unit

# key: (label, kind, bolt, square). Keys match the hardpoint / spring point each joint sits on.
DEFAULT_JOINTS = {
    "upper_inboard_front": ("Upper wishbone, inboard (pivot {uif})", "rod_end", "pivot", True),
    "upper_inboard_rear": ("Upper wishbone, inboard (pivot {uir})", "rod_end", "pivot", True),
    "lower_inboard_front": ("Lower wishbone, inboard (pivot {lif})", "rod_end", "pivot", True),
    "lower_inboard_rear": ("Lower wishbone, inboard (pivot {lir})", "rod_end", "pivot", True),
    "upper_outboard": ("Upper ball joint", "bearing", "kingpin", False),
    "lower_outboard": ("Lower ball joint", "bearing", "kingpin", False),
    "trackrod_inboard": ("{rod}, inboard", "rod_end", "z", True),
    "trackrod_outboard": ("{rod}, outboard", "rod_end", "z", True),
    "rod_outboard": ("Pushrod, outboard", "rod_end", "pivot", False),
    "rocker_rod": ("Pushrod, rocker end", "rod_end", "rocker", False),
    "rocker_damper": ("Damper, rocker end", "rod_end", "rocker", False),
    "damper_chassis": ("Damper, chassis end", "rod_end", "rocker", False),
}


def _arm_R(piv, bj0, bj):
    a, b = piv
    u = unit(b - a)
    v0, v1 = bj0 - a, bj - a
    v0, v1 = v0 - (v0 @ u) * u, v1 - (v1 @ u) * u
    return rodrigues(u * math.atan2(u @ np.cross(v0, v1), v0 @ v1))


def _joint_list(cfg, s, sp):
    """[(key, label, kind, mount, link(pose) -> unit vector, bolt0)]; mount names the part the bolt is fixed to."""
    h, rear = s.h, cfg["axle"] == "rear"
    piv = {"upper": (h["uif"], h["uir"]), "lower": (h["lif"], h["lir"])}
    out = []
    names = {"uif": f"X={h['uif'][0]:.0f}", "uir": f"X={h['uir'][0]:.0f}", "lif": f"X={h['lif'][0]:.0f}",
             "lir": f"X={h['lir'][0]:.0f}", "rod": "Toe link" if rear else "Tie rod"}
    for key, arm, pk, bj in (("upper_inboard_front", "upper", "uif", "ub"), ("upper_inboard_rear", "upper", "uir", "ub"),
                             ("lower_inboard_front", "lower", "lif", "lb"), ("lower_inboard_rear", "lower", "lir", "lb")):
        out.append((key, "chassis", lambda P, pk=pk, bj=bj: unit(P["pts"][bj] - h[pk]), arm))
    out.append(("upper_outboard", "upright", None, "upper"))
    out.append(("lower_outboard", "upright", None, "lower"))
    out.append(("trackrod_inboard", "chassis", lambda P: unit(P["pts"]["tro"] - P["pts"]["tri"]), None))
    out.append(("trackrod_outboard", "upright", lambda P: unit(P["pts"]["tro"] - P["pts"]["tri"]), None))
    if sp is not None:
        on = sp.on if sp.on in ("upper", "lower") else "upright"
        if not sp.direct:
            out.append(("rod_outboard", on, lambda P: unit(P["st"]["rod_in"] - P["st"]["rod_out"]), sp.on if on != "upright" else None))
            out.append(("rocker_rod", "rocker", lambda P: unit(P["st"]["rod_in"] - P["st"]["rod_out"]), None))
            out.append(("rocker_damper", "rocker", lambda P: unit(sp.dch - P["st"]["damper_out"]), None))
        else:
            out.append(("rod_outboard", on, lambda P: unit(sp.dch - P["st"]["damper_out"]), sp.on if on != "upright" else None))
        out.append(("damper_chassis", "chassis", lambda P: unit(sp.dch - P["st"]["damper_out"]), None))
    return out, piv, names


def misalignment(cfg, s, sp=None, heaves=None, racks=None):
    """Worst misalignment of every joint over the heave x rack grid (the packaging grid). Returns
    dict(rows=[...], margin=min(allow - worst), worst=the row with the least margin)."""
    sw, mem = cfg["sweep"], cfg["members"]
    D, B = travel_range(cfg)
    if heaves is None:
        heaves = heave_points(D, B, int(sw.get("pack_heave_steps") or 9))
    if racks is None:
        racks = heave_points(sw["rack_travel"], sw["rack_travel"], int(sw.get("pack_rack_steps") or 7)) if cfg["axle"] == "front" else [0.0]
    jl, piv, names = _joint_list(cfg, s, sp)
    user = cfg.get("joints") or {}
    P0 = {"ub": s.P0[0], "lb": s.P0[1]}
    # every pose: points, upright rotation, arm rotations, spring state and rocker rotation
    poses = []
    for (hz, rk), x in s.grid(heaves, racks).items():
        o = s.observe(x, hz, rk)
        pts = o["_pts"]
        Ru = s.transform(x)[0]
        Ra = {arm: _arm_R(piv[arm], P0[bj], pts[bj]) for arm, bj in (("upper", "ub"), ("lower", "lb"))}
        st = sp.state(x) if sp is not None else None
        Rr = rodrigues(sp.k * math.radians(st["rocker_deg"])) if (sp is not None and not sp.direct) else np.eye(3)
        poses.append(dict(hz=hz, rk=rk, pts=pts, st=st, R={"chassis": np.eye(3), "upright": Ru, "rocker": Rr, **Ra}))
    ride = min(poses, key=lambda q: abs(q["hz"]) + abs(q["rk"]))
    rows = []
    for key, mount, link, arm in jl:
        label, kind, bolt_d, square_d = DEFAULT_JOINTS[key]
        u_cfg = user.get(key) or {}
        kind = u_cfg.get("type", kind)
        bolt, square = u_cfg.get("bolt", bolt_d), u_cfg.get("square", square_d if "bolt" not in u_cfg else isinstance(u_cfg.get("bolt"), str) and u_cfg.get("bolt") in ("x", "y", "z"))
        if bolt == "rocker" and (sp is None or sp.direct):
            # no rocker (direct-acting damper): the damper's chassis bolt parallels the arm's pivot axis
            bolt, arm = ("pivot", sp.on) if sp is not None and sp.on in ("upper", "lower") else ("x", arm)
        if bolt == "pivot":
            pa = piv[arm or "lower"]
            b0 = unit(pa[1] - pa[0])
        elif bolt == "kingpin":
            b0 = unit(s.P0[0] - s.P0[1])
        elif bolt == "rocker":
            b0 = sp.k.copy()
        elif isinstance(bolt, str):
            b0 = np.eye(3)["xyz".index(bolt)]
        else:
            b0 = unit(np.array(bolt, float))
        allow = float(u_cfg.get("allow", mem.get("bearing_misalign" if kind == "bearing" else "rod_end_misalign") or (10.0 if kind == "bearing" else 12.0)))
        if kind == "bearing":
            # race in the arm, bolt in the upright, both square to each other at ride height (or at joints.<key>.align
            # mm of wheel travel): the race's axis, carried by the arm, starts on the bolt's axis at that pose
            al = float(u_cfg.get("align") or 0.0)
            race0 = b0
            if al:
                xa = s.states([al])[float(al)]
                pa_ = s.observe(xa, al)["_pts"]
                bj_ = "ub" if arm == "upper" else "lb"
                race0 = _arm_R(piv[arm], P0[bj_], pa_[bj_]).T @ (s.transform(xa)[0] @ b0)

            def ang(q, b0=b0, arm=arm, race0=race0):
                p_, r_ = q["R"][arm] @ race0, q["R"]["upright"] @ b0
                return math.degrees(math.atan2(float(np.linalg.norm(np.cross(p_, r_))), abs(float(p_ @ r_))))  # atan2: exact near 0
        else:
            if square:
                u0 = link(ride)
                b0 = unit(b0 - (b0 @ u0) * u0)
            def ang(q, b0=b0, link=link, mount=mount):
                return math.degrees(math.asin(min(1.0, abs(float(link(q) @ (q["R"][mount] @ b0))))))
        vals = [(ang(q), q["hz"], q["rk"]) for q in poses]
        worst = max(vals)
        row = dict(key=key, label=label.format(**names), kind=kind, mount=mount if kind == "rod_end" else arm,
                   align=float(u_cfg.get("align") or 0.0) if kind == "bearing" else None,
                   square=bool(square) and kind == "rod_end", bolt=bolt if isinstance(bolt, str) else "vector",
                   bolt0=[float(v) for v in b0], ride=ang(ride), worst=worst[0], at=(worst[1], worst[2]), allow=allow,
                   margin=allow - worst[0], best=None)
        if kind == "rod_end":
            # the bolt direction (square to the link at ride height) that keeps the worst angle smallest
            u0 = link(ride)
            e1 = unit(np.cross(u0, [0.0, 0.0, 1.0]) if abs(u0[2]) < 0.9 else np.cross(u0, [1.0, 0.0, 0.0]))
            e2 = np.cross(u0, e1)
            # |u . R (cos e1 + sin e2)| for 180 directions x every pose at once
            U = np.array([link(q) for q in poses])
            A = np.einsum("ij,ij->i", U, np.array([q["R"][mount] @ e1 for q in poses]))
            Bv = np.einsum("ij,ij->i", U, np.array([q["R"][mount] @ e2 for q in poses]))
            ph = np.pi * np.arange(180) / 180
            W = np.degrees(np.arcsin(np.minimum(1.0, np.abs(np.outer(np.cos(ph), A) + np.outer(np.sin(ph), Bv))))).max(axis=1)
            i = int(np.argmin(W))
            row["best"] = dict(worst=float(W[i]), bolt=[float(v) for v in math.cos(ph[i]) * e1 + math.sin(ph[i]) * e2])
        rows.append(row)
    wr = min(rows, key=lambda r: r["margin"])
    return dict(rows=rows, margin=wr["margin"], worst=wr, n_poses=len(poses))


MOUNT_NAME = {"chassis": "chassis", "upright": "upright", "upper": "upper wishbone", "lower": "lower wishbone", "rocker": "rocker"}
BOLT_NAME = {"x": "fore-aft (X)", "y": "sideways (Y)", "z": "vertical (Z)", "pivot": "along the wishbone pivot axis",
             "kingpin": "along the kingpin axis", "rocker": "along the rocker axis", "vector": "set direction"}
NOTE = ("Misalignment = how far each rod end or spherical bearing tilts from square to its bolt, searched over the whole "
        "travel and rack range. A rod end can spin on its link, so only the link's angle to the plane square to the bolt "
        "counts; a spherical bearing (the ball joints) is assumed aligned at ride height. Limits are the catalog's "
        "misalignment angles (members.rod_end_misalign / bearing_misalign, or joints.<key>.allow). Past the limit the "
        "joint binds: use a high-misalignment rod end or misalignment spacers, or turn the bracket to the better bolt direction.")


def bolt_text(r):
    if r["kind"] == "bearing":
        al = r.get("align") or 0.0
        return (f"race in the {MOUNT_NAME[r['mount']]}, bolt in the upright {BOLT_NAME.get(r['bolt'], r['bolt'])}, aligned at "
                + (f"{al:+g} mm of wheel travel" if al else "ride height"))
    return (f"bolt on the {MOUNT_NAME[r['mount']]}, {BOLT_NAME.get(r['bolt'], r['bolt'])}"
            + (", bracket square to the rod end at ride height" if r["square"] else ""))


def best_text(r):
    if not r["best"] or r["worst"] - r["best"]["worst"] <= 0.5:
        return ""
    v = r["best"]["bolt"]
    a = [abs(c) for c in v]
    i = a.index(max(a))
    return f"[{', '.join(f'{c:.2f}' for c in v)}]" + (f" (~{'XYZ'[i]})" if a[i] > 0.9 else "") + f": worst {r['best']['worst']:.1f} deg"
