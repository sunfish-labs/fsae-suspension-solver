"""The competition setup sheet: what to set each corner to, and what one turn of each adjuster does.

Lengths at ride height: pushrod and tie rod (or toe link) center to center, damper eye to eye. Adjusters, at ride
height and small changes (linear):
  camber per mm of shim at the upper ball joint = 1 / (distance between the ball joints)        (rad -> deg)
  toe per mm of tie-rod length                   = 1 / (the tie rod's arm about the steering axis)
  ride height per mm of pushrod length           = 1 / (the pushrod's installation ratio: how far its end moves
                                                    along the rod per mm of wheel travel)
Corner weight: the car's mass x its front share / 2 (left-right symmetric)."""
from __future__ import annotations

import math

import numpy as np

from .kinematics import unit

THREADS = {"3/8-24 UNF": 25.4 / 24, "5/16-24 UNF": 25.4 / 24, "1/4-28 UNF": 25.4 / 28, "M8x1.25": 1.25, "M10x1.25": 1.25,
           "M10x1.5": 1.5}


def setup_values(cfg, ev):
    s, m = ev["susp"], ev["metrics"]
    h = s.h
    ub, lb, tro, tri = (np.asarray(h[k], float) for k in ("ubj", "lbj", "tro", "tri"))
    kp = ub - lb
    u = unit(kp)
    arm = float(np.linalg.norm(np.cross(tro - lb, u)))                   # the tie rod's end about the steering axis
    veh = cfg["vehicle"]
    share = float(veh["weight_front"]) if cfg["axle"] == "front" else 1 - float(veh["weight_front"])
    out = dict(axle=cfg["axle"], camber=m.get("camber"), toe=m.get("toe"), caster=m.get("caster"), kpi=m.get("kpi"),
               corner_kg=float(veh["mass"]) * share / 2, tie_rod_len=float(np.linalg.norm(tro - tri)),
               camber_per_mm=math.degrees(1 / float(np.linalg.norm(kp))), toe_per_mm=math.degrees(1 / arm), steer_arm=arm)
    sp = ev.get("spring")
    if sp is not None:
        st = sp.static()
        out.update(spring_rate=float(cfg["spring"]["spring_rate"]), wheel_rate=m.get("wheel_rate"), ride_freq=m.get("ride_freq"),
                   damper_len=float(st["damper_len"]), pushrod_len=float(np.linalg.norm(st["rod_out"] - st["rod_in"])))
        hh = 0.5
        xs = s.states([-hh, hh])
        v = (sp.state(xs[hh])["rod_out"] - sp.state(xs[-hh])["rod_out"]) / (2 * hh)
        pr = abs(float(unit(st["rod_in"] - st["rod_out"]) @ v))
        out["pushrod_ratio"] = pr
        out["ride_per_mm"] = 1 / pr if pr > 1e-9 else None
    return out
