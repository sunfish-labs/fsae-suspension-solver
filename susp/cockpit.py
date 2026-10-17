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
The template (F.5.6.5): 200 mm circles at the hip and the shoulders 490 mm apart, a 300 mm head circle 280 mm from
the shoulders. Its position here follows the seat back; check that the head circle sits within 25 mm of the head
restraint (F.5.6.6) on the CAD."""
from __future__ import annotations

import math

KEYS_PT = ("main_hoop_top", "front_hoop_top", "brace_lower", "brace_upper", "hip")
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
    for k in KEYS_NUM[1:]:
        if ck.get(k) is not None and not isinstance(ck[k], (int, float)):
            raise ConfigError(f"{where}: cockpit.{k} must be a number")
