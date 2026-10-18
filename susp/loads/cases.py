"""Load cases: the tire forces on one corner for each driving and impact case."""
from __future__ import annotations

import numpy as np

from ..kinematics import unit  # noqa: F401

G = 9.81


def load_cases(cfg, susp, lltd=None):
    """Tire forces on this corner (the right-hand wheel) for each case.

    The car is symmetric, so one config covers both corners of its axle: in a left turn this wheel is the
    OUTER wheel, in a right turn it is the INNER wheel. Both are checked because the inner wheel's lateral force
    points the other way and can put a different member into compression.
    lltd: the car's front lateral load transfer share from the whole-car balance; loads.lltd_front overrides it, and
    without either the front weight share is used.
    Braking: loads.brake_split "bias" (default) shares the total braking force by vehicle.front_brake_share, the same
    split the anti-dive figure uses; "grip" gives every tire the same friction use (Fx = g x that tire's Fz).
    Returns (cases, info): cases = [(name, [(F, point_name)], description, Fz_breakdown)]."""
    veh, L = cfg["vehicle"], cfg["loads"]
    lltd_car = lltd
    W = veh["mass"] * G
    wf, h, WB = veh["weight_front"], veh["cg_height"], veh["wheelbase"]
    front = cfg["axle"] == "front"
    share = wf if front else 1 - wf
    lltd = L.get("lltd_front") or lltd or wf
    lat_share = lltd if front else 1 - lltd
    bias = (L.get("brake_split") or "bias") == "bias"
    b_share = veh["front_brake_share"] if front else 1 - veh["front_brake_share"]
    t = susp.track
    info = dict(W=W, share=share, Fz0=W * share / 2, long_per_g=W * h / WB / 2, lat_per_g=W * h / t * lat_share,
                lat_share=lat_share, lltd=lltd, lltd_from_car=bool(lltd_car and not L.get("lltd_front")), h=h, WB=WB, t=t, brake_split="bias" if bias else "grip", brake_share=b_share)

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
    def brake_fx(g, Fz):
        """Braking force on this tire (negative = rearward) at g of deceleration."""
        return -g * W * b_share / 2 if bias else -g * Fz
    bdesc = (lambda g: f"Fx = {g:g} g x car weight x {b_share:.0%} brake share / 2") if bias else (lambda g: f"Fx = {g:g} x Fz")
    ax = -L["brake_g"]
    Fz, parts = wheel(ax=ax)
    cases.append(("braking", [(np.array([0, 0, Fz]), cp), (np.array([brake_fx(L["brake_g"], Fz), 0, 0]), brake_pt)],
                  f"{L['brake_g']:g} g braking ({bdesc(L['brake_g'])})", parts))
    g2 = L["combined_g"]
    for side, nm in ((1, "outer"), (-1, "inner")):
        Fz, parts = wheel(ax=-g2, ay=g2, side=side)
        fx = brake_fx(g2, Fz)              # with the bias split, both wheels of an axle brake alike
        cases.append((f"brake+corner {nm}", [(np.array([0, 0, Fz]), cp), (np.array([0, -side * g2 * Fz, 0]), cp),
                                             (np.array([fx, 0, 0]), brake_pt)],
                      f"{g2:g} g braking + {g2:g} g lateral, {nm} wheel ({bdesc(g2)})", parts))
    pg, kg = L.get("pothole_g"), L.get("kerb_g")
    if pg:
        cases.append(("pothole", [(np.array([0, 0, pg * Fz0]), cp)], f"{pg:g} x static wheel load, impact", f"{pg:g} x {Fz0:.0f} static"))
    if kg:
        cases.append(("curb strike", [(np.array([0, 0, Fz0]), cp), (np.array([0, -kg * Fz0, 0]), cp)],
                      f"{kg:g} x static wheel load sideways (wheel pushed inboard) + static load, impact", f"{Fz0:.0f} static"))
    if not front:
        ax = L["accel_g"]
        Fz, parts = wheel(ax=ax)
        cases.append(("acceleration", [(np.array([0, 0, Fz]), cp), (np.array([ax * W / 2, 0, 0]), drive_pt)],
                      f"{ax:g} g acceleration (rear drive, Fx = {ax:g} g x car weight / 2)", parts))
    return cases, info
