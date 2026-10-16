"""Shared helpers for the design tools: a quick evaluation, setting one coordinate, goal tolerances."""
from __future__ import annotations

import copy

from ..config import HP, SPRING_POINTS
from ..errors import UnknownPointError
from ..kinematics import check_targets, evaluate

# typical "one unit of miss" per metric, used to weight optimizer goals
TOL = {"roll_center": 4.0, "camber_gain": 0.04, "bump_steer": 0.03, "bump_steer_max": 0.03, "bump_steer_curve": 0.02, "antidive": 2.0,
       "antisquat": 5.0, "antilift": 3.0, "caster": 0.3, "kpi": 0.3, "scrub": 2.0, "trail": 2.0, "ackermann": 5.0,
       "track_change": 0.5, "camber": 0.1, "toe": 0.05, "fvsa": 200.0, "roll_camber": 0.03, "rc_lat": 2.0,
       "motion_ratio": 0.03, "ride_freq": 0.1, "mr_progression": 3.0, "rocker_rot": 3.0, "trans_min": 5.0,
       "damper_static_pos": 5.0, "damper_topout": 2.0, "damper_bottomout": 2.0, "damper_used": 2.0,
       "damper_margin": 2.0, "rod_angle": 3.0, "turn_radius": 0.1, "clearance_margin": 2.0}


def quick(cfg, steer=False, pack=False):
    return evaluate(cfg, full=False, steer=steer, pack=pack)["metrics"]


def set_coord(cfg, point, axis, value):
    c = copy.deepcopy(cfg)
    c["hardpoints"][point]["xyz".index(axis)] = value
    return c


def point_ref(cfg, name):
    """The [x, y, z] list for a hardpoint name or 'spring.<point>' (so callers can edit it in place)."""
    if name.startswith("spring."):
        key = name.split(".", 1)[1]
        if not cfg.get("spring") or key not in SPRING_POINTS or cfg["spring"].get(key) is None:
            raise UnknownPointError(f"'{name}' is not a spring point in this config. Spring points: "
                     + ", ".join(f"spring.{k}" for k in SPRING_POINTS if (cfg.get("spring") or {}).get(k) is not None))
        return cfg["spring"][key]
    if name not in HP:
        raise UnknownPointError(f"unknown point '{name}'. choose from: {', '.join(HP)} or spring.<point>")
    return cfg["hardpoints"][name]


# --------------------------------------------------------------------------- #
#  Advice
# --------------------------------------------------------------------------- #
def _fails(cfg, m):
    return [(k, v, lo, hi) for k, v, lo, hi, st in check_targets(cfg, m) if st == "FAIL"]
