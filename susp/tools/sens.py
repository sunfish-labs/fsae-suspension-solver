"""Sensitivity: what +delta mm on each coordinate does to every metric."""
from __future__ import annotations

import copy

from ..config import HP, METRICS, SPRING_POINTS
from ..errors import ConfigError, GoalError
from ..kinematics import SolveError
from ..output import f_num, table
from .common import point_ref, quick


def sens_cols(cfg):
    ax_keys = ["antidive"] if cfg["axle"] == "front" else ["antisquat", "antilift"]
    cols = ["roll_center", "camber_gain", "roll_camber", "rc_lat", "bump_steer", "bump_steer_curve"] + ax_keys + \
           ["caster", "kpi", "scrub", "trail", "track_change"]
    if cfg.get("spring"):
        cols.append("motion_ratio")
    return cols


def spring_cols(cfg):
    cols = ["motion_ratio", "mr_progression", "rocker_rot", "trans_min", "damper_used", "rod_angle"]
    if cfg["spring"].get("damper_eye_to_eye"):
        cols.append("damper_static_pos")
    if cfg["spring"].get("rocker_pivot") is None:
        cols = [c for c in cols if c not in ("rocker_rot", "trans_min")]
    return cols


def compute_sens(cfg, delta=5.0, points=None, spring=False):
    base = quick(cfg)
    if spring:
        if not cfg.get("spring"):
            raise ConfigError("this config has no 'spring' block")
        cols = spring_cols(cfg)
        pts = [f"spring.{k}" for k in SPRING_POINTS if k != "rocker_axis" and cfg["spring"].get(k) is not None]
    else:
        cols = sens_cols(cfg)
        pts = [p for p in HP if p != "contact_patch"]
    if points:
        pts = [p for p in pts if any(s in p for s in points.split(","))]
    rows = []
    for p in pts:
        for i, ax in enumerate("xyz"):
            c = copy.deepcopy(cfg)
            point_ref(c, p)[i] += delta
            try:
                mp = quick(c)
            except SolveError:
                continue
            rows.append((f"{p}.{ax}", [mp.get(k, float("nan")) - base.get(k, float("nan")) for k in cols]))
    return cols, rows, base


def print_sens(cfg, delta, cols, rows, base, metric=None, top=None):
    if metric:
        if metric not in cols:
            raise GoalError(f"--metric must be one of: {', '.join(cols)}")
        j = cols.index(metric)
        rows = sorted(rows, key=lambda r: -abs(r[1][j]))
        rows = rows[:top] if top else rows
    print(f"\nSensitivity: {cfg['name']}   (+{delta:g} mm on one coordinate, change in each metric)")
    print("base: " + ", ".join(f"{METRICS[k][0]} {f_num(base[k], METRICS[k][2])}" for k in cols))
    print("note: bump steer + = toe-in in bump; camber gain + = more negative camber in bump\n" if "camber_gain" in cols
          else "note: motion ratio = damper travel / wheel travel; progression + = rising rate\n")
    table(["coordinate"] + [f"d {k}" for k in cols],
          [[n] + [f"{v:+.{METRICS[k][2] if METRICS[k][2] > 1 else 2}f}" for v, k in zip(vals, cols)]
           for n, vals in rows])
