"""Input sanity checks: catch CAD-import and typing mistakes before solving, and target keys that aren't metrics."""
from __future__ import annotations

import math

import numpy as np

from .config import HP, METRICS


def front_view_swing_arm(h):
    """Front-view swing arm at ride height from the hardpoints (mm, inf when the arms are parallel in that view)."""
    from .kinematics import plane
    n1, d1 = plane(h["uif"], h["uir"], h["ubj"])
    n2, d2 = plane(h["lif"], h["lir"], h["lbj"])
    dv = np.cross(n1, n2)
    if np.linalg.norm(dv) < 1e-9 or abs(dv[0]) < 1e-9:
        return float("inf")
    pt = np.linalg.solve(np.vstack([n1, n2, dv]), [d1, d2, 0.0])
    q = pt + ((h["cp"][0] - pt[0]) / dv[0]) * dv
    return float(abs(q[1] - h["cp"][1]))


def validate(cfg):
    """Return a list of (level, message). level is 'error' or 'warn'."""
    h = {HP[k]: np.array(v, float) for k, v in cfg["hardpoints"].items()}
    out = []
    def W(m):
        return out.append(("warn", m))
    def E(m):
        return out.append(("error", m))
    R = cfg["wheel"]["tire_radius"]
    if abs(h["cp"][2]) > 1.0:
        W(f"contact_patch Z is {h['cp'][2]:.1f} mm. The ground should be Z = 0 (Z up). "
          "Check the axis mapping or the offset you used when importing from CAD.")
    if h["cp"][1] <= 0:
        E("contact_patch Y must be positive (right-hand wheel, Y outboard). Your Y axis may be flipped.")
    if h["ubj"][2] <= h["lbj"][2]:
        E("upper_outboard is not above lower_outboard - upper and lower ball joints may be swapped, or Z is not up.")
    for arm, pts in (("upper", ("uif", "uir", "ubj")), ("lower", ("lif", "lir", "lbj"))):
        a, b, bj = (h[p] for p in pts)
        if max(a[1], b[1]) >= bj[1]:
            W(f"{arm} wishbone: an inboard pivot is not inboard of the ball joint (Y). Check for swapped axes.")
        u = (b - a) / max(np.linalg.norm(b - a), 1e-9)
        v = bj - a
        if np.linalg.norm(v - (v @ u) * u) < 50:
            E(f"{arm} wishbone: the ball joint is almost on the pivot axis - the arm cannot control the wheel.")
        if abs(u[0]) < 0.5:
            W(f"{arm} wishbone pivot axis is far from fore-aft ({math.degrees(math.acos(min(1, abs(u[0])))):.0f} deg off X). "
              "Unusual - check the pivot coordinates.")
    fvsa = front_view_swing_arm(h)
    if fvsa > 15000:
        W("the wishbones are almost parallel in the front view (front-view swing arm "
          + ("infinite" if fvsa == float("inf") else f"{fvsa / 1000:.0f} m") + ", 1.5 to 5 m is typical): the roll center "
          "height then swings a lot with small hardpoint changes or CAD rounding. Fine if intended; otherwise angle the arms.")
    for nm, p in (("upper_outboard", "ubj"), ("lower_outboard", "lbj"), ("trackrod_outboard", "tro")):
        if h[p][1] > h["cp"][1] + 5:
            W(f"{nm} is outboard of the tire center plane (Y {h[p][1]:.0f} > {h['cp'][1]:.0f}). "
              "Possible with lots of wheel offset, but check it fits inside the rim.")
        if h[p][2] > 2 * R:
            W(f"{nm} is above the top of the tire - check units (mm) and Z.")
    if abs(h["tro"][1] - h["tri"][1]) < 100:
        W("tie rod is very short (< 100 mm laterally). Bump steer will be hard to control.")
    # steering arm: distance from TRO to the kingpin axis
    k = h["ubj"] - h["lbj"]
    k = k / np.linalg.norm(k)
    v = h["tro"] - h["lbj"]
    arm = float(np.linalg.norm(v - (v @ k) * k))
    if cfg["axle"] == "front" and arm < 50:
        W(f"steering arm is only {arm:.0f} mm. Rack forces will be high and steering very quick.")
    veh = cfg["vehicle"]
    if veh["wheelbase"] < 1525:
        W(f"wheelbase {veh['wheelbase']:.0f} mm is below the FSAE minimum (1525 mm in recent rules - check the current rulebook).")
    if not 0.3 <= veh["weight_front"] <= 0.7:
        W("vehicle.weight_front should be a fraction (e.g. 0.46), not a percentage.")
    sp = cfg.get("spring")
    if sp:
        p = np.array(sp["rod_outboard"], float)
        if sp["rod_on"] in ("lower", "upper"):
            a, b, bj = (h[q] for q in (("lif", "lir", "lbj") if sp["rod_on"] == "lower" else ("uif", "uir", "ubj")))
            u = (b - a) / np.linalg.norm(b - a)
            d_bj = np.linalg.norm((bj - a) - ((bj - a) @ u) * u)
            d_p = np.linalg.norm((p - a) - ((p - a) @ u) * u)
            if d_p < 0.6 * d_bj:
                W(f"pushrod mounts {d_p:.0f} mm from the {sp['rod_on']} arm axis vs {d_bj:.0f} mm for the ball joint - "
                  "far inboard of the ball joint puts big bending loads in the arm.")
        inner = np.array(sp["rocker_rod"] if sp.get("rocker_pivot") is not None else sp["damper_chassis"], float)
        e = inner - p
        L = np.linalg.norm(e)
        ang = math.degrees(math.asin(min(1.0, abs(e[2]) / L)))
        if ang < 20:
            W(f"pushrod/pullrod is only {ang:.0f} deg from horizontal in the front view - low motion ratio and "
              "high rod forces. 30-60 deg is typical.")
        if sp.get("rocker_axis") is not None:
            ax = np.array(sp["rocker_axis"], float)
            if np.linalg.norm(ax) < 1e-9:
                E("spring.rocker_axis is zero - give the direction of the rocker pivot bolt, e.g. [1, 0, 0].")
            else:
                ax = ax / np.linalg.norm(ax)
                c = np.array(sp["rocker_pivot"], float)
                r = np.array(sp["rocker_rod"], float) - c
                tq = np.cross(r, e / L) @ ax
                if abs(tq) < 0.2 * np.linalg.norm(r - (r @ ax) * ax):
                    W("the pushrod points almost through the rocker pivot - tiny lever arm, rocker will be "
                      "near a toggle position.")
    out += [("warn", m) for m in unknown_target_keys(cfg)]
    return sorted(out, key=lambda t: t[0] != "error")


def unknown_target_keys(cfg):
    """Messages for target keys that aren't metrics the solver reports (usually a misspelling), from the design's
    own targets and its team targets file. Those targets would otherwise be ignored without a word."""
    import difflib
    msgs = []
    for src, tab in (("targets", cfg.get("targets")), ("the team targets file", cfg.get("_team_targets"))):
        for k in sorted((tab or {}).keys()):
            if k.startswith("_") or k in METRICS:
                continue
            near = difflib.get_close_matches(k, list(METRICS), n=1, cutoff=0.6)
            msgs.append(f"target '{k}' in {src} is not a metric the solver reports, so it is ignored"
                        + (f" - did you mean '{near[0]}'?" if near else ". Check the spelling against the Targets list."))
    return msgs


def unknown_car_target_keys(car_targets, known):
    msgs = []
    import difflib
    for k in sorted((car_targets or {}).keys()):
        if k not in known and not k.startswith("_"):
            near = difflib.get_close_matches(k, list(known), n=1, cutoff=0.6)
            msgs.append(f"car target '{k}' is not a car metric, so it is ignored" + (f" - did you mean '{near[0]}'?" if near else
                        f" (car targets: {', '.join(known)})."))
    return msgs
