"""The team's coordinate frame for files: ISO 8855 axes with the origin under the front axle.

Files carry `"frame": "iso8855"`: X forward, Y left, Z up, mm; origin on the ground plane, on the car's centerline,
under the front axle (the front tires' contact patches at ride height). Each corner is given as the car's LEFT-hand
corner, so its Y values are positive; rear corner points have X about minus the wheelbase. Car-level points (layout
parts, ground points, the driver and roll hoops) are where they physically are, so a part on the right has negative Y.

The solver itself keeps its own internal frame (X forward, Y outboard on the right-hand corner, Z up, each corner from
its own zero). The two meet only here, at loading and saving:
  corner points: the left-hand corner in ISO 8855 is the solver's right-hand corner mirrored, and mirroring undoes the
                 Y flip, so Y and Z carry over; X carries over at the front, and the rear corner moves forward by the
                 wheelbase (its own zero then sits at the rear axle).
  car-level points: X carries over (the solver's car frame is the front corner's), Y changes sign.
A file without "frame" is the solver's own frame (older files) and loads unchanged; directions (the rocker axis, the
rack direction) are the same in both."""
from __future__ import annotations

import copy

from .errors import ConfigError

FRAME = "iso8855"
FRAME_LABEL = "ISO 8855: X forward, Y left, Z up, mm; origin on the ground under the front axle, on the centerline"
CORNER_POINTS = {"hardpoints": None,
                 "spring": ("rod_outboard", "rocker_pivot", "rocker_rod", "rocker_damper", "damper_chassis"),
                 "arb": ("link_outboard", "arm_tip", "bar_pivot"),
                 "halfshaft": ("diff_output", "cv_outboard")}


def _corner_points(cfg):
    """(block, key) of every point a corner config holds."""
    for blk, keys in CORNER_POINTS.items():
        b = cfg.get(blk)
        if not isinstance(b, dict):
            continue
        for k in (b.keys() if keys is None else keys):
            v = b.get(k)
            if isinstance(v, list) and len(v) == 3:
                yield blk, k


def check_frame(f, where):
    if f not in (None, FRAME):
        raise ConfigError(f"{where}: frame must be \"{FRAME}\" (ISO 8855, origin under the front axle) or left out (the solver's own frame)")


def corner_in(cfg, where="config"):
    """A merged corner config from a file's frame into the solver's, in place; marks it _frame."""
    f = cfg.pop("frame", None)
    check_frame(f, where)
    if f != FRAME:
        return cfg
    if cfg.get("axle") == "rear":
        wb = float(cfg["vehicle"]["wheelbase"])
        for blk, k in _corner_points(cfg):
            p = cfg[blk][k]
            cfg[blk][k] = [float(p[0]) + wb, p[1], p[2]]
    cfg["_frame"] = FRAME
    return cfg


def corner_out(cfg):
    """A corner config (solver frame) as a file in the team frame: a converted copy carrying "frame". A corner that came
    from a team-frame file goes back exactly; an older one is moved so the front axle is at X = 0."""
    out = copy.deepcopy(cfg)
    if cfg.get("_frame") == FRAME:
        dx = -float(cfg["vehicle"]["wheelbase"]) if cfg["axle"] == "rear" else 0.0
    else:
        cp = float(cfg["hardpoints"]["contact_patch"][0])
        dx = -cp - (float(cfg["vehicle"]["wheelbase"]) if cfg["axle"] == "rear" else 0.0)
    for blk, k in _corner_points(out):
        p = out[blk][k]
        out[blk][k] = [round(float(p[0]) + dx, 6), p[1], p[2]]
    out.pop("_frame", None)
    out["frame"] = FRAME
    return out


def _car_points(raw, fn):
    """Apply fn(point) -> point to every car-level point of a car file (layout, ground points, cockpit), in place."""
    lay = raw.get("layout")
    if isinstance(lay, dict):
        for c in lay.get("components") or []:
            if isinstance(c, dict) and isinstance(c.get("at"), list) and len(c["at"]) == 3:
                c["at"] = fn(c["at"])
    for g in raw.get("ground_points") or []:
        if isinstance(g, dict) and isinstance(g.get("at"), list) and len(g["at"]) == 3:
            g["at"] = fn(g["at"])
    ck = raw.get("cockpit")
    if isinstance(ck, dict):
        for k, v in list(ck.items()):
            if isinstance(v, list) and len(v) == 2:                        # side-view points [x, z]
                x, _, z = fn([v[0], 0.0, v[1]])
                ck[k] = [x, z]
            elif k in ("pedal_face_x", "wheel_front_x") and isinstance(v, (int, float)):
                ck[k] = fn([v, 0.0, 0.0])[0]


def car_in(raw, where="car"):
    """A car file's car-level points into the solver's car frame (copy). Corners are converted by normalize."""
    f = raw.get("frame")
    check_frame(f, where)
    out = copy.deepcopy(raw)
    if f == FRAME:
        _car_points(out, lambda p: [float(p[0]), -float(p[1]) + 0.0, float(p[2])])
    return out


def car_out(raw, front_cfg, from_team=True):
    """Car-level points (solver car frame) in the team frame, in place; from_team: they came from a team-frame file."""
    dx = 0.0 if from_team else -float(front_cfg["hardpoints"]["contact_patch"][0])
    _car_points(raw, lambda p: [round(float(p[0]) + dx, 6), -float(p[1]) + 0.0, float(p[2])])
    raw["frame"] = FRAME
    return raw


def _shift_corner_raw(c, dx):
    for blk, k in list(_corner_points(c)):
        p = c[blk][k]
        c[blk][k] = [round(float(p[0]) + dx, 6), p[1], p[2]]


def raw_to_team(raw, default_wheelbase):
    """An older file (a design or a car file, the solver's own frame) as a team-frame file, keeping every other key.
    A file already in the team frame comes back unchanged."""
    out = copy.deepcopy(raw)
    if out.get("frame") == FRAME:
        return out
    check_frame(out.get("frame"), "file")
    if isinstance(out.get("front"), dict) and isinstance(out.get("rear"), dict):       # a car file
        veh = dict(out["front"].get("vehicle") or {}, **(out.get("vehicle") or {}))
        wb = float(veh.get("wheelbase") or default_wheelbase)
        cpf = float(out["front"]["hardpoints"]["contact_patch"][0])
        cpr = float(out["rear"]["hardpoints"]["contact_patch"][0])
        _shift_corner_raw(out["front"], -cpf)
        _shift_corner_raw(out["rear"], -cpr - wb)
        _car_points(out, lambda p: [round(float(p[0]) - cpf, 6), -float(p[1]) + 0.0, float(p[2])])
        out = {"frame": FRAME, **out}
        return out
    axle = out.get("axle", "front")
    wb = float((out.get("vehicle") or {}).get("wheelbase") or default_wheelbase)
    cp = float(out["hardpoints"]["contact_patch"][0])
    _shift_corner_raw(out, -cp - (wb if axle == "rear" else 0.0))
    return {"frame": FRAME, **out}
