"""Driver template and roll hoops in side view (Formula SAE Rules 2027, F.5.6 to F.5.9): the values the rules check
needs, from a handful of side-view points off the frame CAD (the car file's "cockpit" block).

Points are [x, z] in mm in the car frame used by the layout: X forward (the front corner's X), Z up from the ground,
on the car's centerline.
    main_hoop_top      top-most surface of the Main Hoop
    front_hoop_top     top-most surface of the Front Hoop (and where its rear face is, for the 250 mm check)
    brace_lower        lower end of the Main Hoop Bracing (behind the hoop = braces extend rearwards)
    brace_upper        where the Main Hoop Braces attach to the hoop
    hip                center of the template's 200 mm hip circle on the seat bottom, seat in its rearmost position
    back_angle         seat back angle from vertical, deg (the shoulder circle sits on the back)
    neck_angle         extra recline of the neck line, deg (0 = in line with the back)
    pedal_face_x       rearmost face of the pedals in their most forward position
    wheel_top_z        top of the steering wheel at any angle
    wheel_front_x      forward-most surface of the steering wheel rim, straight ahead
  optional, for the frame and harness rules:
    sis_upper_front, sis_upper_rear   top edge of the Upper Side Impact Member at its front and rear ends
    sis_lower_low      bottom of the Lower Side Impact Member at its lowest point (z = its height above the ground)
    front_hoop_at_sis  the Front Hoop where the upper side impact member meets it
    main_hoop_at_sis   the Main Hoop where the upper side impact member attaches
    main_hoop_bottom   the Main Hoop at its bottom (at the lowest frame member)
    lap_belt_mount     the lap belt's mounting point; shoulder_belt_mount: the shoulder harness bar (where the belt wraps)
    shoulder_belt_spacing   mm, center to center of the two shoulder belts (front view)
The template (F.5.6.5): 200 mm circles at the hip and the shoulders 490 mm apart, a 300 mm head circle 280 mm from
the shoulders. Its position here follows the seat back; check that the head circle sits within 25 mm of the head
restraint (F.5.6.6) on the CAD."""
from __future__ import annotations

import math

import numpy as np

KEYS_PT = ("main_hoop_top", "front_hoop_top", "brace_lower", "brace_upper", "hip")
# optional frame and harness points in the same side view: the side impact structure, the hoops where the upper side
# impact member meets them and the main hoop's bottom, the lap and shoulder belt mounts
KEYS_OPT = ("sis_upper_front", "sis_upper_rear", "sis_lower_low", "front_hoop_at_sis", "main_hoop_at_sis",
            "main_hoop_bottom", "lap_belt_mount", "shoulder_belt_mount")
KEYS_NUM = ("back_angle", "neck_angle", "pedal_face_x", "wheel_top_z", "wheel_front_x")


def template(ck):
    """Centers of the hip, shoulder and head circles."""
    hx, hz = ck["hip"]
    b = math.radians(float(ck["back_angle"]))
    n = b + math.radians(float(ck.get("neck_angle") or 0.0))
    sx, sz = hx - 490 * math.sin(b), hz + 490 * math.cos(b)
    return (hx, hz), (sx, sz), (sx - 280 * math.sin(n), sz + 280 * math.cos(n))


def side_dist(p, a, b):
    """Signed distance from point p to the line a-b, positive on the side below the line (toward the ground)."""
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dz)
    cr = (p[0] - a[0]) * dz - (p[1] - a[1]) * dx                # z-component of (p - a) x (b - a), x right z up
    s = cr / L
    # "below": on the same side as a point straight under the line's midpoint
    mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 1000.0
    ref = (mx - a[0]) * dz - (mz - a[1]) * dx
    return s if ref > 0 else -s


def cockpit_values(ck):
    """Values for the rules check: helmet clearances to the hoop lines, hip to pedals, front hoop vs the steering wheel,
    brace attachment drop. A check that doesn't apply (braces forwards, or backwards) gets {"na": reason}."""
    if not ck:
        return {}
    hip, sh, head = template(ck)
    mh, fh = ck["main_hoop_top"], ck["front_hoop_top"]
    v = {"_template": dict(hip=hip, shoulder=sh, head=head)}
    v["helmet_front_line"] = side_dist(head, mh, fh) - 150.0
    bl = ck.get("brace_lower")
    if bl:
        if bl[0] < mh[0]:                                          # braces extend rearwards
            # the head must be on the front side of the line from the hoop top down to the brace's lower end
            d = side_dist(head, mh, bl)
            v["helmet_brace_line"] = (abs(d) if head[0] > _x_on(mh, bl, head[1]) else -abs(d)) - 150.0
            v["helmet_behind_hoop"] = {"na": "braces extend rearwards"}
        else:                                                      # braces forwards: helmet not behind the hoop
            v["helmet_brace_line"] = {"na": "braces extend forwards"}
            v["helmet_behind_hoop"] = head[0] - 150.0 - mh[0]
    if ck.get("pedal_face_x") is not None:
        v["hip_to_pedals"] = float(ck["pedal_face_x"]) - hip[0]
    if ck.get("wheel_top_z") is not None:
        v["front_hoop_over_wheel"] = fh[1] - float(ck["wheel_top_z"])
    if ck.get("wheel_front_x") is not None:
        v["front_hoop_ahead_of_wheel"] = fh[0] - float(ck["wheel_front_x"])
    bu = ck.get("brace_upper")
    if bu:
        v["brace_drop"] = mh[1] - bu[1]
    v.update(frame_values(ck, (hip, sh, head)))
    return v


def _incline(lo, hi):
    """Angle (deg) from vertical of the line from lo up to hi in side view; positive when hi is behind lo (leans
    rearward, X forward)."""
    dx, dz = hi[0] - lo[0], hi[1] - lo[1]
    return math.degrees(math.atan2(-dx, dz))


def frame_values(ck, template_pts):
    """The frame and harness checks from the optional side-view points (whatever is given)."""
    v = {}
    g = ck.get
    if g("sis_lower_low"):
        h = float(ck["sis_lower_low"][1])
        v["lsis_height"] = {"v": h, "note": "should be 75 mm or less" if h > 75 else ""}
        tops = [ck[k][1] - h for k in ("sis_upper_front", "sis_upper_rear") if g(k)]
        if tops:
            v["upper_sis_low"], v["upper_sis_high"] = min(tops), max(tops)
    fh, mh = ck["front_hoop_top"], ck["main_hoop_top"]
    if g("front_hoop_at_sis"):
        inc = _incline(ck["front_hoop_at_sis"], fh)
        v["front_hoop_incline"] = abs(inc)
        v["front_hoop_rear_lean"] = ({"na": (f"leans rearward {inc:.1f} deg, 10 or less" if inc > 0 else
                                             f"leans forward {-inc:.1f} deg")} if inc <= 10 else
                                     {"manual": f"leans rearward {inc:.1f} deg: needs rearward Front Hoop Braces to a "
                                                "triangulated node"})
    if g("main_hoop_at_sis"):
        inc = _incline(ck["main_hoop_at_sis"], mh)
        v["main_hoop_incline_above"] = abs(inc)
        if g("main_hoop_bottom"):
            v["main_hoop_rear_lean_below"] = max(0.0, _incline(ck["main_hoop_bottom"], ck["main_hoop_at_sis"]))
        bu, bl = g("brace_upper"), g("brace_lower")
        if bu and bl:
            a = np.array(mh, float) - np.array(ck["main_hoop_at_sis"], float)
            b = np.array(bl, float) - np.array(bu, float)
            ang = math.degrees(math.acos(abs(a @ b) / (np.linalg.norm(a) * np.linalg.norm(b))))
            v["brace_angle"] = ang
            lean = "vertical" if abs(inc) < 0.5 else "rearward" if inc > 0 else "forward"
            side = "rearward" if bl[0] < bu[0] else "forward"
            v["brace_side"] = {"v": lean == "vertical" or lean == side,
                               "note": f"hoop {('leans ' + lean) if lean != 'vertical' else 'vertical'}, braces {side}"}
    hip, sh, _ = template_pts
    upright = float(ck["back_angle"]) <= 30
    if g("lap_belt_mount"):
        m = ck["lap_belt_mount"]
        ang = math.degrees(math.atan2(abs(hip[1] - m[1]), abs(hip[0] - m[0])))
        v["lap_belt_upright"] = ang if upright else {"na": "reclined seat: back over 30 deg"}
        v["lap_belt_reclined"] = ang if not upright else {"na": "upright seat: back 30 deg or less"}
    if g("shoulder_belt_mount"):
        m = ck["shoulder_belt_mount"]
        top = (sh[0], sh[1] + 100.0)                                # the top of the shoulder circle
        v["shoulder_belt_angle"] = math.degrees(math.atan2(top[1] - m[1], abs(top[0] - m[0])))   # + below horizontal
    if g("shoulder_belt_spacing") is not None:
        v["shoulder_belt_spacing"] = float(ck["shoulder_belt_spacing"])
    return v


def _x_on(a, b, z):
    """x of the line a-b at height z."""
    if abs(b[1] - a[1]) < 1e-9:
        return min(a[0], b[0])
    return a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1])


def check_cockpit(ck, where="cockpit"):
    from .errors import ConfigError
    if not isinstance(ck, dict):
        raise ConfigError(f"{where}: cockpit must be an object of side-view points")
    for k in KEYS_PT:
        p = ck.get(k)
        if p is None and k in ("brace_lower", "brace_upper"):
            continue
        if not (isinstance(p, list) and len(p) == 2 and all(isinstance(q, (int, float)) for q in p)):
            raise ConfigError(f"{where}: cockpit.{k} needs [x, z] in mm")
    if not isinstance(ck.get("back_angle"), (int, float)) or not 0 <= ck["back_angle"] < 80:
        raise ConfigError(f"{where}: cockpit.back_angle is the seat back's angle from vertical, 0 to 80 deg")
    for k in KEYS_OPT:
        p = ck.get(k)
        if p is not None and not (isinstance(p, list) and len(p) == 2 and all(isinstance(q, (int, float)) for q in p)):
            raise ConfigError(f"{where}: cockpit.{k} needs [x, z] in mm")
    if ck.get("shoulder_belt_spacing") is not None and not isinstance(ck["shoulder_belt_spacing"], (int, float)):
        raise ConfigError(f"{where}: cockpit.shoulder_belt_spacing must be a number (mm)")
    for k in KEYS_NUM[1:]:
        if ck.get(k) is not None and not isinstance(ck[k], (int, float)):
            raise ConfigError(f"{where}: cockpit.{k} must be a number")
