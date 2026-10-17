"""Rules checks: the design against a competition rulebook (schema/rules/*.json).

A rules file lists checks, each with its rule number, a short paraphrase (never the rulebook's text: read the book for
the exact wording), what kind of check it is and its limit. This module works out the value each check needs from
the car (two evaluated corners, the car balance and the layout) and says pass, fail, can't check (the input is
missing) or check yourself (a rule the solver can't measure).

Values:
    wheelbase, track_ratio (smaller / larger track)
    tilt_angle: the tilt the car survives without rolling (IN.11-style), from the CG height and the half track at the
        CG's position along the car, less the body's lean toward the low side: the sprung mass rolls by the roll
        gradient times sin(tilt) g (the lateral part of gravity in the car's frame), which moves the CG downhill by
        the roll arm times that angle. Static, rigid tires: an estimate.
    travel_front / _rear: usable wheel travel from the damper's full extension to full compression (stroke and
        eye-to-eye in the spring block), found on the heave sweep's damper length (extended past the sweep with the
        end motion ratio). A bump stop or coil bind that stops it sooner is not counted.
    wheel_front / _rear (rim diameter, mm), bolt_grades, shear_planes, steer_solves (the steering sweep reached the
    full rack travel), rim_margin (links inside the rim barrel over travel and steer, both axles), keepout_hits
    (layout parts in a tire's fore/aft keep-out zone), ground_clearance (the car file's lowest points against the
    ground over every body position the suspension allows: see ground_planes)."""
from __future__ import annotations

import json
import math
import os

import numpy as np

from .schema import _DIR

RULES_DIR = os.path.join(_DIR, "rules")


def rulesets():
    """{file stem: ruleset} for every schema/rules/*.json."""
    out = {}
    for f in sorted(os.listdir(RULES_DIR)):
        if f.endswith(".json"):
            with open(os.path.join(RULES_DIR, f), encoding="utf-8") as fh:
                out[f[:-5]] = json.load(fh)
    return out


def usable_travel(cfg, ev):
    """Wheel travel (mm) from full droop to full bump that the damper allows, or None without stroke and length."""
    sc = cfg.get("spring") or {}
    e2e, stroke = sc.get("damper_eye_to_eye"), sc.get("damper_stroke")
    if not (ev.get("ride") and e2e and stroke):
        return None
    rows = sorted(ev["rows"], key=lambda r: r["dz"])
    z = [r["dz"] for r in rows]
    L = [r["damper_len"] for r in rows]

    def at(Lt):
        """Wheel travel where the damper is Lt long: on the sweep, or past its ends with the end slope."""
        for i in range(len(z) - 1):
            a, b = L[i], L[i + 1]
            if (a - Lt) * (b - Lt) <= 0 and a != b:
                return z[i] + (Lt - a) * (z[i + 1] - z[i]) / (b - a)
        lo = (L[1] - L[0]) / (z[1] - z[0])
        hi = (L[-1] - L[-2]) / (z[-1] - z[-2])
        # the damper gets shorter in bump: past the bump end (short) or the droop end (long)
        if (Lt < min(L)) == (L[-1] < L[0]):
            return z[-1] + (Lt - L[-1]) / hi if hi else float("nan")
        return z[0] + (Lt - L[0]) / lo if lo else float("nan")
    zb, zd = at(float(e2e) - float(stroke)), at(float(e2e))
    return dict(total=abs(zb - zd), bump=zb, droop=zd)


def tilt_angle(fcfg, fev, rcfg, rev, bal):
    veh = fcfg["vehicle"]
    h = float(veh["cg_height"])
    WB = float(veh["wheelbase"])
    a = (1 - float(veh["weight_front"])) * WB                         # CG behind the front axle
    tf, tr = fev["susp"].track, rev["susp"].track
    half = tf / 2 + (tr / 2 - tf / 2) * a / WB
    shift = 0.0
    if bal:
        phi = math.radians(bal["grad"] * math.sin(math.radians(60)))  # body roll at the 60 deg tilt's lateral 0.87 g
        shift = bal["ms"] / float(veh["mass"]) * bal["arm"] * math.sin(phi)
    return float(math.degrees(math.atan2(half - shift, h))), dict(half_track=float(half), cg_height=h, lean=float(shift))


def keepout_hits(lay, fcfg, rcfg, wheelbase):
    """Layout parts (solid, with a size) inside a tire's keep-out zone: fore and aft of the tire by 75 mm, between the
    tire's inner and outer planes, any height, wheels straight. [(part, wheel)]."""
    if not lay:
        return None
    hits = []
    xf0 = fcfg["hardpoints"]["contact_patch"][0]
    for cfg, ax in ((fcfg, "front"), (rcfg, "rear")):
        R = float(cfg["wheel"].get("tire_radius") or 254.0)
        w = float(cfg["wheel"].get("tire_width") or 190.0)
        yc = float(cfg["hardpoints"]["contact_patch"][1])
        xc = xf0 - (wheelbase if ax == "rear" else 0.0)
        for c in lay.get("components", []):
            if c.get("solid") is False or not c.get("size"):
                continue
            x, y = float(c["at"][0]), float(c["at"][1])
            hx, hy = float(c["size"][0]) / 2, float(c["size"][1]) / 2
            if x + hx < xc - R - 75 or x - hx > xc + R + 75:
                continue
            for side in (1, -1):
                lo, hi = side * yc - w / 2, side * yc + w / 2
                if y + hy > lo and y - hy < hi:
                    hits.append((c.get("name") or "part", f"{ax} {'right' if side > 0 else 'left'}"))
    return hits


def corner_limits(cfg, ev):
    """How far the body can come down (+, bump) and go up (droop) at one corner, mm: the damper's usable travel (or
    the sweep's travel without stroke and length), plus the tire squashing under the extra load at full bump."""
    t = usable_travel(cfg, ev)
    if t:
        bump, droop = max(t["bump"], t["droop"]), min(t["bump"], t["droop"])
    else:
        from .kinematics import travel_range
        D, B = travel_range(cfg)
        bump, droop = B, -D
    kw = ev["metrics"].get("wheel_rate") if ev.get("ride") else None
    kt = (cfg.get("spring") or {}).get("tire_rate")
    squash = float(kw) * bump / float(kt) if kw and kt else 0.0
    return dict(bump=float(bump), droop=float(droop), squash=float(squash))


def ground_planes(fcfg, fev, rcfg, rev, wheelbase):
    """Every extreme body position the four corners allow, as planes: the body comes down by a + b x + c y (mm) at a
    point (x, y) of the car frame. The body is rigid (heave, pitch, roll), each corner between full droop and full
    bump (plus tire squash); the lowest a point can get is at one of these vertices (a linear program's corners: three
    corners at a limit, the fourth inside its range)."""
    xf = float(fcfg["hardpoints"]["contact_patch"][0])
    corners = []
    for cfg, ev, x, ax in ((fcfg, fev, xf, "front"), (rcfg, rev, xf - float(wheelbase), "rear")):
        lim = corner_limits(cfg, ev)
        y = float(cfg["hardpoints"]["contact_patch"][1])
        for side, yy in (("right", y), ("left", -y)):
            corners.append(dict(name=f"{ax} {side}", x=x, y=yy, lo=lim["droop"], hi=lim["bump"] + lim["squash"]))
    planes = []
    import itertools
    for tri in itertools.combinations(range(4), 3):
        other = [i for i in range(4) if i not in tri][0]
        A = np.array([[1.0, corners[i]["x"], corners[i]["y"]] for i in tri])
        for lims in itertools.product(("lo", "hi"), repeat=3):
            d = np.array([corners[i][s] for i, s in zip(tri, lims)])
            try:
                a, b, c = np.linalg.solve(A, d)
            except np.linalg.LinAlgError:
                continue
            o = corners[other]
            d4 = a + b * o["x"] + c * o["y"]
            if o["lo"] - 1e-6 <= d4 <= o["hi"] + 1e-6:
                state = {corners[i]["name"]: ("full bump" if s == "hi" else "full droop") for i, s in zip(tri, lims)}
                planes.append(dict(a=float(a), b=float(b), c=float(c), state=state))
    return planes, corners


def ground_clearance(points, planes):
    """The least clearance (mm) of the given points [{name, at: [x, y, z]}] over the body positions: z minus the
    largest drop there. {value, point, at, drop, state} or None without points."""
    best = None
    for p in points or []:
        x, y, z = (float(v) for v in p["at"])
        for pl in planes:
            dr = pl["a"] + pl["b"] * x + pl["c"] * y
            cl = z - dr
            if best is None or cl < best["value"]:
                best = dict(value=cl, point=p.get("name") or "point", at=[x, y, z], drop=dr, state=pl["state"])
    return best


def rule_values(fcfg, fev, rcfg, rev, bal=None, layout=None, cockpit=None, ground=None):
    veh = fcfg["vehicle"]
    tf, tr = fev["susp"].track, rev["susp"].track
    v = dict(wheelbase=float(veh["wheelbase"]), track_ratio=min(tf, tr) / max(tf, tr))
    v["tilt_angle"], v["_tilt"] = tilt_angle(fcfg, fev, rcfg, rev, bal)
    for cfg, ev, ax in ((fcfg, fev, "front"), (rcfg, rev, "rear")):
        t = usable_travel(cfg, ev)
        v[f"travel_{ax}"] = t["total"] if t else None
        v[f"_travel_{ax}"] = t
        v[f"wheel_{ax}"] = float(cfg["wheel"].get("rim_diameter_in") or 0) * 25.4
    v["bolt_grades"] = [str(c["members"].get("bolt_grade")) for c in (fcfg, rcfg)]
    v["shear_planes"] = [int(c["members"].get("bolt_shear_planes") or 2) for c in (fcfg, rcfg)]
    st = fev.get("steer") or []
    rk = float(fcfg["sweep"].get("rack_travel") or 0)
    v["steer_solves"] = bool(st) and max(abs(float(s["rack"])) for s in st) >= rk - 1e-6
    rm = [e["metrics"].get("rim_margin") for e in (fev, rev)]
    v["rim_margin"] = min(rm) if all(x is not None for x in rm) else None
    v["keepout_hits"] = keepout_hits(layout, fcfg, rcfg, float(veh["wheelbase"]))
    if cockpit:
        from .cockpit import cockpit_values
        v.update(cockpit_values(cockpit))
    g = ground_clearance(ground, ground_planes(fcfg, fev, rcfg, rev, float(veh["wheelbase"]))[0]) if ground else None
    v["ground_clearance"] = g["value"] if g else None
    v["_ground"] = g
    return v


def check_rules(ruleset, values):
    """Rows {id, rule, summary, status (pass | fail | unknown | manual | na), value, limit, note} for each check."""
    rows = []
    for c in ruleset["checks"]:
        k, val = c["kind"], values.get(c.get("value", ""))
        row = dict(id=c["id"], rule=c["rule"], summary=c["summary"], kind=k, value=val, limit=c.get("limit"),
                   unit=c.get("unit", ""), estimate=bool(c.get("estimate")), note="")
        if k == "manual":
            row["status"] = "manual"
        elif isinstance(val, dict) and "na" in val:
            row["status"], row["note"], row["value"] = "na", val["na"], None
        elif val is None:
            row["status"] = "unknown"
        elif k == "min":
            row["status"] = "pass" if val >= c["limit"] else "fail"
        elif k == "max":
            row["status"] = "pass" if val <= c["limit"] else "fail"
        elif k == "oneof":
            bad = [x for x in val if x not in c["allowed"]]
            row["status"] = "fail" if bad else "pass"
            row["note"] = ", ".join(sorted(set(val)))
        elif k == "double_shear":
            row["status"] = "pass" if all(n >= 2 for n in val) else "manual"
            row["note"] = "double shear" if row["status"] == "pass" else "single shear: needs a capturing bolt head or washer"
        elif k == "true":
            row["status"] = "pass" if val else "fail"
        elif k == "none":
            row["status"] = "pass" if not val else "fail"
            row["note"] = "; ".join(f"{p} ({w})" for p, w in val)
        rows.append(row)
    return rows
