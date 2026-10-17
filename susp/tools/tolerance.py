"""Build tolerance: how far each hardpoint may be off before a target is lost, so the jig holds the ones that matter.

Each coordinate of each point is moved by +/- tol (default 1 mm) and the corner re-solved. Its effect on a metric is
the larger of the two changes. For each metric with a target range:
    margin = how far it sits inside its range (0 when it already fails)
    RSS    = the root sum of squares of every coordinate's effect: the likely miss when every point is built
             tol off in a random direction
    worst  = the plain sum: every error in the worst direction at once
Each coordinate's allowed error shares a metric's margin equally (in the RSS sense) with the N coordinates that move
that metric noticeably:
    allowed = tol x margin / (effect x sqrt(N))
and its overall allowance is the smallest over the metrics. Below 0.5 mm: needs a precise jig and checking after
welding; below about 1 mm: hold it in the jig; above 2 mm: ordinary shop tolerance.

allowed_shim is the same without the bump-steer targets, for a car with a shim stack at the tie rod's outer end to tune
bump steer after the build. Static camber and toe are left out: they are set with shims at alignment. Ackermann is left out too (it needs the
steering sweep); bump steer's sensitivity to the tie-rod height is the classic one this catches."""
from __future__ import annotations

import copy
import math

from ..config import HP, default_targets
from ..kinematics import SolveError
from .common import point_ref, quick

TOL_METRICS = ["roll_center", "rc_lat", "camber_gain", "bump_steer", "bump_steer_max", "caster", "kpi", "scrub", "trail",
               "antidive", "antisquat", "motion_ratio", "ride_freq"]
SPRING_CHASSIS = ["rocker_pivot", "damper_chassis"]
SHIMMED = ("bump_steer", "bump_steer_max")    # tuned after the build with a shim stack at the tie rod's outer end
CAP = 10.0                                     # mm: allowances past this are shown as "10+"


def tol_points(cfg):
    pts = [p for p in HP if p != "contact_patch"]
    if cfg.get("spring"):
        pts += [f"spring.{k}" for k in SPRING_CHASSIS if cfg["spring"].get(k) is not None]
    return pts


def where_built(p):
    """Which fixture holds this point: the frame jig (chassis pickups) or the upright's machining."""
    return "upright" if p.endswith("outboard") and not p.startswith("spring.") else "chassis"


def tolerance(cfg, tol=1.0):
    base = quick(cfg)
    tg = default_targets(cfg)
    keys = [k for k in TOL_METRICS if k in tg and base.get(k) is not None]
    effects = []                       # (point, axis, {metric: effect})
    for p in tol_points(cfg):
        for i, ax in enumerate("xyz"):
            eff = {k: 0.0 for k in keys}
            for s in (1, -1):
                c = copy.deepcopy(cfg)
                point_ref(c, p)[i] += s * tol
                try:
                    m = quick(c)
                except SolveError:
                    eff = {k: float("inf") for k in keys}
                    break
                for k in keys:
                    if m.get(k) is not None:
                        eff[k] = max(eff[k], abs(m[k] - base[k]))
            effects.append((p, ax, eff))
    metrics = []
    for k in keys:
        lo, hi = tg[k]
        v = base[k]
        margin = max(0.0, min(v - lo if lo is not None else math.inf, hi - v if hi is not None else math.inf))
        es = [e[k] for _, _, e in effects]
        big = max(es) if es else 0.0
        n = sum(1 for x in es if x > 0.05 * big) if big > 0 else 0
        metrics.append(dict(key=k, value=v, lo=lo, hi=hi, margin=margin, rss=math.sqrt(sum(x * x for x in es)), worst=sum(es),
                            n=max(n, 1)))
    by = {m["key"]: m for m in metrics}
    def allow(eff, skip=()):
        best, limit = math.inf, None
        for k, e in eff.items():
            if e <= 1e-12 or k in skip:
                continue
            a = tol * by[k]["margin"] / (e * math.sqrt(by[k]["n"]))
            if a < best:
                best, limit = a, k
        return best, limit
    coords = []
    for p, ax, eff in effects:
        allowed, limit = allow(eff)
        shim, shim_limit = allow(eff, SHIMMED)
        coords.append(dict(point=p, axis=ax, where=where_built(p), allowed=allowed, limit=limit, allowed_shim=shim,
                           limit_shim=shim_limit, effects=eff))
    return dict(tol=tol, metrics=metrics, coords=coords)


def tol_class(allowed):
    return "precise jig" if allowed < 0.5 else "jig" if allowed < 1.0 else "jig, some slack" if allowed < 2.0 else "shop tolerance"


def print_tolerance(cfg, res):
    from ..config import METRICS
    from ..output import f_num, table
    t = res["tol"]
    print(f"\nBuild tolerance: {cfg.get('name') or cfg['axle']} corner, each coordinate moved +/-{t:g} mm")
    rows = []
    for m in res["metrics"]:
        lab, unit, dec = METRICS[m["key"]]
        st = "already off target" if m["margin"] <= 0 else "OK" if m["worst"] <= m["margin"] else "OK (likely)" \
            if m["rss"] <= m["margin"] else "AT RISK"
        rows.append([lab, f_num(m["value"], dec), f_num(m["margin"], dec), f_num(m["rss"], dec), f_num(m["worst"], dec), unit, st])
    table(["metric", "value", "margin to target", f"RSS at +/-{t:g} mm", "worst case", "unit", ""], rows)
    pts = {}
    for c in res["coords"]:
        pts.setdefault(c["point"], {})[c["axis"]] = c
    def mm(v):
        return f"+/-{CAP:g}+" if v >= CAP else f"+/-{v:.1f}"
    rows = []
    for p, d in sorted(pts.items(), key=lambda kv: min(c["allowed"] for c in kv[1].values())):
        lim = min(d.values(), key=lambda c: c["allowed"])
        shim = min(c["allowed_shim"] for c in d.values())
        rows.append([p, d["x"]["where"], *[mm(d[a]["allowed"]) for a in "xyz"], tol_class(lim["allowed"]),
                     METRICS[lim["limit"]][0] if lim["limit"] else "-", mm(shim)])
    print()
    table(["point", "built in", "x, mm", "y, mm", "z, mm", "", "limited by", "tightest with bump-steer shims"], rows)
    print("\nAllowed = the error one coordinate may have while every other point is also off by its own allowance (RSS).")
    print("Static camber and toe are set with shims at alignment, so they're not counted here. With a shim stack at the tie")
    print("rod's outer end, bump steer is tuned after the build too: the last column is the tightest allowance then.")
