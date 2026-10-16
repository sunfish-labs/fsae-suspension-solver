"""Optimizer: move chosen coordinates to hit goals (least squares), keeping clearances."""
from __future__ import annotations

import copy
import json

import numpy as np

from ..config import METRICS, cfg_to_json
from ..errors import GoalError
from ..kinematics import SolveError, evaluate
from ..output import f_num, table
from .common import TOL, point_ref


# --------------------------------------------------------------------------- #
#  Optimizer
# --------------------------------------------------------------------------- #
def parse_goal(s):
    """'metric=target[:tol]', 'metric>=limit[:tol]' or 'metric<=limit[:tol]' -> (metric, target, tol, kind)."""
    for op in (">=", "<=", "="):
        if op in s:
            k, rhs = s.split(op, 1)
            tgt, _, tol = rhs.partition(":")
            try:
                return k.strip(), float(tgt), (float(tol) if tol else None), op
            except ValueError:
                break
    raise GoalError(f"bad --goal '{s}' (use metric=target[:tol], metric>=limit or metric<=limit, e.g. roll_center=35:4)")


def parse_vary(cfg, spec):
    vary = []
    for item in spec.split(","):
        item = item.strip()
        if item.startswith("spring."):
            parts = item.split(".")
            p, ax = ".".join(parts[:2]), (parts[2] if len(parts) > 2 else "")
        else:
            p, _, ax = item.partition(".")
        point_ref(cfg, p)
        for a in (ax or "xyz"):
            if a not in "xyz":
                raise GoalError(f"bad axis in '{item}'")
            vary.append((p, a))
    return vary


def optimize(cfg, vary_spec, goal_specs, bound=40.0, reg=0.005, min_clearance=None, max_nfev=60, out=None,
             keep_clear=False):
    from scipy.optimize import least_squares
    goals = [parse_goal(g) for g in goal_specs]
    for k, _, tol, _ in goals:
        if k not in METRICS:
            import difflib
            near = difflib.get_close_matches(k, list(METRICS), n=1, cutoff=0.6)
            raise GoalError(f"unknown goal metric '{k}'" + (f" - did you mean '{near[0]}'?" if near else f". Metrics: {', '.join(METRICS)}"))
        if k not in TOL and tol is None:
            raise GoalError(f"goal metric '{k}' needs a tolerance (e.g. {k}=10:2), or choose from: {', '.join(TOL)}")
    vary = parse_vary(cfg, vary_spec)
    need_steer = any(g[0] in ("ackermann", "turn_radius") for g in goals)
    need_pack = min_clearance is not None or keep_clear
    base_cfg = copy.deepcopy(cfg)

    def apply(d):
        c = copy.deepcopy(base_cfg)
        for (p, a), dv in zip(vary, d):
            point_ref(c, p)["xyz".index(a)] += float(dv)
        return c

    def resid(d):
        try:
            ev = evaluate(apply(d), full=False, steer=need_steer, pack=need_pack)
        except SolveError:
            return np.full(len(goals) + len(d) + 2, 50.0)
        m = ev["metrics"]
        r = []
        for k, tgt, tol, op in goals:
            v = m.get(k, float("nan"))
            if v != v:
                r.append(50.0)
                continue
            miss = v - tgt
            if op == ">=":
                miss = min(0.0, miss)
            elif op == "<=":
                miss = max(0.0, miss)
            r.append(miss / (tol or TOL[k]))
        r.append(max(0.0, min_clearance - m["clearance_min"]) / 2.0 if min_clearance is not None else 0.0)
        r.append(max(0.0, -m["clearance_margin"]) / 2.0 if keep_clear else 0.0)
        r += list(np.asarray(d) * reg)
        return np.array(r)

    print(f"optimizing {len(vary)} coordinates against {len(goals)} goals (this takes a little while)...")
    sol = least_squares(resid, np.zeros(len(vary)), bounds=(-bound, bound), diff_step=1e-3, max_nfev=max_nfev)
    new = apply(sol.x)
    for (p, a), dv in zip(vary, sol.x):
        i = "xyz".index(a)
        point_ref(new, p)[i] = round(point_ref(new, p)[i], 1)
    new["name"] = f"{cfg['name']} (optimized)"
    ev0 = evaluate(cfg, steer=need_steer, pack=need_pack)
    ev1 = evaluate(new, steer=need_steer, pack=need_pack)
    print("\nMoves (mm):")
    def was(c, p, a):
        return point_ref(c, p)["xyz".index(a)]
    table(["coordinate", "was", "now", "change"],
          [[f"{p}.{a}", f"{was(cfg, p, a):.2f}", f"{was(new, p, a):.1f}", f"{was(new, p, a) - was(cfg, p, a):+.1f}"]
           for p, a in vary])
    print("\nGoals (quick evaluation used while optimizing; full values below):")
    table(["metric", "goal", "before", "after"],
          [[METRICS[k][0], f"{'' if op == '=' else op}{t:g}", f_num(ev0["metrics"].get(k), METRICS[k][2]),
            f_num(ev1["metrics"].get(k), METRICS[k][2])] for k, t, _, op in goals])
    if keep_clear:
        nm, (d, hz, rk, need) = ev1["pack"]["min_pair"]
        print(f"\ntightest clearance after: {nm} {d:.1f} mm (needs {need:.1f})")
    if min_clearance is not None:
        print(f"\nlink clearance: before {ev0['metrics']['clearance_min']:.1f} mm, after "
              f"{ev1['metrics']['clearance_min']:.1f} mm (asked for >= {min_clearance:g})")
    with open(out, "w") as f:
        json.dump(cfg_to_json(new), f, indent=2)
    print(f"\nwrote {out}  - run it through 'run' to check everything else before trusting it.")
