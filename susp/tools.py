"""Design tools: sensitivity, single-move advice, optimizer, run history, CSV import."""
from __future__ import annotations

import copy
import csv
import datetime
import json
import os
import sys

import numpy as np

from .config import (HP, HP_ORDER, METRICS, SHORT2LONG, SPRING_POINTS, TEMPLATE_FRONT, TEMPLATE_REAR,
                     cfg_to_json)
from .kinematics import SolveError, check_targets, evaluate
from .output import f_num, table

HIST_METRICS = ["camber", "toe", "caster", "kpi", "scrub", "trail", "roll_center", "camber_gain", "bump_steer",
                "bump_steer_curve",
                "roll_camber", "rc_lat", "track_change", "antidive", "antisquat", "antilift", "ackermann",
                "motion_ratio", "ride_freq", "clearance_min"]

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
            sys.exit("this config has no 'spring' block")
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
            sys.exit(f"--metric must be one of: {', '.join(cols)}")
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


# --------------------------------------------------------------------------- #
#  Advice
# --------------------------------------------------------------------------- #
def _fails(cfg, m):
    return [(k, v, lo, hi) for k, v, lo, hi, st in check_targets(cfg, m) if st == "FAIL"]


def _aim(v, lo, hi):
    """Where to steer a failing metric: just inside the nearest bound (20 % of the window)."""
    win = (hi - lo) if (lo is not None and hi is not None) else 0.0
    if lo is not None and v < lo:
        return lo + 0.2 * win if win else lo + abs(lo) * 0.05 + 1e-3
    return hi - 0.2 * win if win else hi - abs(hi) * 0.05 - 1e-3


def _inside(v, lo, hi):
    return v == v and (lo is None or v >= lo) and (hi is None or v <= hi)


def advise(cfg, ev, delta=4.0, reach=40.0, top=3):
    """For every failing hardpoint-driven target find the single-coordinate moves that fix it with the fewest
    side effects. Each candidate is re-solved for real and re-checked against every other target, including
    link clearance. Returns [(metric, value, lo, hi, [candidates])]."""
    m0 = ev["metrics"]
    fails = [f for f in _fails(cfg, m0) if f[0] not in ("camber", "toe", "ride_freq", "damper_margin")]
    if not fails:
        return []
    need_steer = any(f[0] == "ackermann" for f in fails)
    base = quick(cfg, steer=need_steer)
    base_fail = {f[0] for f in _fails(cfg, base)}
    pk0 = ev.get("pack")
    pts = [p for p in HP if p != "contact_patch"]
    slopes = {}
    for p in pts:
        for i, ax in enumerate("xyz"):
            try:
                mp = quick(set_coord(cfg, p, ax, cfg["hardpoints"][p][i] + delta), steer=need_steer)
            except SolveError:
                continue
            slopes[(p, ax, i)] = mp
    out = []
    for k, v, lo, hi in fails:
        aim = _aim(v, lo, hi)
        cands = []
        for (p, ax, i), mp in slopes.items():
            if k not in mp or k not in base:
                continue
            s = (mp[k] - base[k]) / delta
            if abs(s) < 1e-9:
                continue
            mv = (aim - v) / s
            if abs(mv) > reach:
                continue
            res = None
            x0, y0 = 0.0, v
            for _ in range(4):  # secant refinement: the response is nonlinear for big moves
                c2 = set_coord(cfg, p, ax, cfg["hardpoints"][p][i] + mv)
                try:
                    m2 = quick(c2, steer=need_steer)
                except SolveError:
                    mv *= 0.5
                    continue
                if _inside(m2[k], lo, hi):
                    res = (c2, m2)
                    break
                if not (m2[k] == m2[k]) or abs(m2[k] - y0) < 1e-12:
                    break
                x1 = mv
                mv = x1 + (aim - m2[k]) * (x1 - x0) / (m2[k] - y0)
                x0, y0 = x1, m2[k]
                if abs(mv) > reach:
                    break
            if res is None:
                continue
            c2, m2 = res
            broken = sorted({f[0] for f in _fails(cfg, m2)} - base_fail)
            if pk0 is not None and pk0["ok"]:
                try:
                    if not evaluate(c2, full=False, steer=False, pack=True, ride=False)["pack"]["ok"]:
                        broken.append("link_clearance")
                except SolveError:
                    broken.append("link_clearance")
            cands.append(dict(coord=f"{p}.{ax}", move=mv, new=m2[k], broken=broken))
        cands.sort(key=lambda c: (len(c["broken"]), abs(c["move"])))
        out.append((k, v, lo, hi, cands[:top]))
    return out


def print_advice(adv, cfg, ev):
    pk = ev.get("pack")
    if not adv and not (pk and not pk["ok"]):
        print("\nAdvice: every hardpoint-driven target passes.")
        return
    print("\nAdvice - single-coordinate moves that fix a failing target (each re-solved and re-checked)")
    for k, v, lo, hi, cands in adv:
        rng = f"{'-inf' if lo is None else f'{lo:g}'} .. {'inf' if hi is None else f'{hi:g}'}"
        print(f"\n  {METRICS[k][0]} = {f_num(v, METRICS[k][2])} (target {rng})")
        if not cands:
            print("    no single move within 40 mm fixes it - change two coordinates or use 'optimize'")
        for c in cands:
            side = f"  (would break: {', '.join(c['broken'])})" if c["broken"] else "  (no other target breaks)"
            print(f"    move {c['coord']:<24s} {c['move']:+6.1f} mm -> {f_num(c['new'], METRICS[k][2])}{side}")
    if pk and not pk["ok"]:
        nm, (d, hz, rk, need) = pk["min_pair"]
        print(f"\n  Clearance: {nm} is {d:.1f} mm < {need:.1f} mm. Move the closer link away (for the tie rod: "
              "raise trackrod_*.z), then re-balance bump steer with\n  'optimize --vary trackrod_inboard.z,"
              "trackrod_outboard.z --goal bump_steer=0:0.02 --min-clearance N'.")
    m = ev["metrics"]
    if "ride_freq" in [f[0] for f in _fails(cfg, m)] and "spring_for_target" not in m:
        print("\n  Ride frequency is out of range: set spring.target_freq_hz to get the spring rate that fixes it.")


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
    sys.exit(f"bad --goal '{s}' (use metric=target[:tol], metric>=limit or metric<=limit, e.g. roll_center=35:4)")


def point_ref(cfg, name):
    """The [x, y, z] list for a hardpoint name or 'spring.<point>' (so callers can edit it in place)."""
    if name.startswith("spring."):
        key = name.split(".", 1)[1]
        if not cfg.get("spring") or key not in SPRING_POINTS or cfg["spring"].get(key) is None:
            sys.exit(f"'{name}' is not a spring point in this config. Spring points: "
                     + ", ".join(f"spring.{k}" for k in SPRING_POINTS if (cfg.get("spring") or {}).get(k) is not None))
        return cfg["spring"][key]
    if name not in HP:
        sys.exit(f"unknown point '{name}'. choose from: {', '.join(HP)} or spring.<point>")
    return cfg["hardpoints"][name]


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
                sys.exit(f"bad axis in '{item}'")
            vary.append((p, a))
    return vary


def optimize(cfg, vary_spec, goal_specs, bound=40.0, reg=0.005, min_clearance=None, max_nfev=60, out=None,
             keep_clear=False):
    from scipy.optimize import least_squares
    goals = [parse_goal(g) for g in goal_specs]
    for k, _, tol, _ in goals:
        if k not in TOL and tol is None:
            sys.exit(f"goal metric '{k}' needs a tolerance (e.g. {k}=10:2), or choose from: {', '.join(TOL)}")
        if k not in METRICS:
            sys.exit(f"unknown goal metric '{k}'. Metrics: {', '.join(METRICS)}")
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


# --------------------------------------------------------------------------- #
#  History log
# --------------------------------------------------------------------------- #
def hp_flat(cfg):
    return {f"{HP[k]}.{ax}": cfg["hardpoints"][k][i] for k in HP_ORDER for i, ax in enumerate("xyz")}


def log_run(path, cfg, ev, note):
    m = ev["metrics"]
    fails = [f[0] for f in _fails(cfg, m)]
    pk = ev.get("pack")
    if pk and not pk["ok"]:
        fails.append("link_clearance")
    row = {"time": datetime.datetime.now().isoformat(timespec="seconds"), "name": cfg["name"], "note": note,
           "fails": ";".join(fails)}
    row.update({k: m.get(k, "") for k in HIST_METRICS})
    row.update(hp_flat(cfg))
    rd = []
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path, newline="") as f:
            rd = list(csv.DictReader(f))
    prev = rd[-1] if rd else None
    if rd and list(rd[0].keys()) != list(row.keys()):     # older log format: rewrite with the new columns
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(row.keys()), extrasaction="ignore")
            w.writeheader()
            for r in rd:
                w.writerow({k: r.get(k, "") for k in row})
    new = not os.path.exists(path) or os.path.getsize(path) == 0
    with open(path, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(row.keys()))
        if new:
            w.writeheader()
        w.writerow(row)
    print(f"\nlogged run #{len(rd) + 1} to {path}")
    if prev:
        ch = [(k, float(prev[k]), row[k]) for k in hp_flat(cfg)
              if prev.get(k, "") not in ("", None) and abs(float(prev[k]) - row[k]) > 1e-9]
        print("changed since last run: " + (", ".join(f"{k} {a:g} -> {b:g}" for k, a, b in ch) or "nothing"))
        if len(ch) > 1:
            print("  tip: you changed more than one coordinate - you can't tell which one caused each effect.")
        diffs = []
        for k in HIST_METRICS:
            a, b = prev.get(k, ""), row[k]
            if a not in ("", None) and b not in ("", None) and \
                    abs(float(a) - float(b)) > 10 ** -(METRICS[k][2] + 1) * 5:
                diffs.append([METRICS[k][0], f_num(float(a), METRICS[k][2]), f_num(float(b), METRICS[k][2]),
                              f"{float(b) - float(a):+.{METRICS[k][2]}f}"])
        if diffs:
            table(["metric", "previous", "now", "change"], diffs)


def show_history(path, metrics=None, plot=None):
    with open(path, newline="") as f:
        rd = list(csv.DictReader(f))
    if not rd:
        sys.exit("empty history")
    cols = metrics.split(",") if metrics else ["roll_center", "camber_gain", "roll_camber", "bump_steer", "caster",
                                               "scrub", "ackermann", "clearance_min"]
    cols = [c for c in cols if c in rd[0]]
    rows = []
    for i, r in enumerate(rd, 1):
        rows.append([str(i), r["time"][5:16].replace("T", " "), (r["note"] or r["name"])[:34],
                     str(len([x for x in r["fails"].split(";") if x]))] +
                    [f_num(float(r[c]), METRICS[c][2]) if r.get(c) not in ("", None) else "-" for c in cols])
    table(["#", "when", "note", "fails"] + cols, rows, left=0)
    if plot:
        from .output import _mpl
        plt = _mpl()
        if plt is None:
            return
        fig, axs = plt.subplots(1, len(cols), figsize=(3.2 * len(cols), 3))
        axs = np.atleast_1d(axs)
        for ax, c in zip(axs, cols):
            ys = [float(r[c]) if r.get(c) not in ("", None) else float("nan") for r in rd]
            ax.plot(range(1, len(rd) + 1), ys, "o-")
            ax.set_title(METRICS[c][0], fontsize=9)
            ax.set_xlabel("run #")
            ax.grid(alpha=0.3)
        fig.tight_layout()
        fig.savefig(plot, dpi=130)
        print(f"wrote {plot}")


# --------------------------------------------------------------------------- #
#  CSV import (e.g. SolidWorks sketch points)
# --------------------------------------------------------------------------- #
_ALIASES = {"tie_rod_inboard": "tri", "tie_rod_outboard": "tro", "tierod_inboard": "tri", "tierod_outboard": "tro",
            "toe_link_inboard": "tri", "toe_link_outboard": "tro",
            "upper_ball_joint": "ubj", "lower_ball_joint": "lbj", "upper_balljoint": "ubj", "lower_balljoint": "lbj",
            "contact": "cp", "tire_contact_patch": "cp", "tyre_contact_patch": "cp",
            "uca_front": "uif", "uca_rear": "uir", "lca_front": "lif", "lca_rear": "lir"}
_SPRING_ALIASES = {"pushrod_outboard": "rod_outboard", "pullrod_outboard": "rod_outboard",
                   "rocker_pushrod": "rocker_rod", "damper_inboard": "damper_chassis", "shock_chassis": "damper_chassis",
                   "rocker_shock": "rocker_damper"}


def import_csv(path, axle, mapping="x,y,z", scale=1.0, offset="0,0,0", name=None):
    def term(spec):
        sign = -1.0 if spec.startswith("-") else 1.0
        idx = "xyz".find(spec.lstrip("+-").lower())
        if idx < 0:
            sys.exit(f"bad --map term '{spec}' (use x, y, z with optional minus, e.g. 'z,-x,y')")
        return sign, idx
    mp = [term(t.strip()) for t in mapping.split(",")]
    if len(mp) != 3:
        sys.exit("--map needs three terms, e.g. 'x,y,z'")
    off = [float(v) for v in offset.split(",")]
    pts, spring = {}, {}
    with open(path, newline="") as f:
        for row in csv.reader(f):
            row = [c.strip() for c in row if c.strip() != ""]
            if len(row) < 4:
                continue
            try:
                xyz = [float(c) for c in row[1:4]]
            except ValueError:
                continue  # header
            nm = row[0].lower().replace(" ", "_").replace("-", "_")
            v = [mp[i][0] * xyz[mp[i][1]] * scale + off[i] for i in range(3)]
            sk = _SPRING_ALIASES.get(nm, nm)
            if sk in ("rod_outboard", "rocker_pivot", "rocker_rod", "rocker_damper", "damper_chassis"):
                spring[sk] = [round(c, 3) for c in v]
                continue
            if sk == "rocker_axis":     # a direction: no offset
                spring[sk] = [round(mp[i][0] * xyz[mp[i][1]], 6) for i in range(3)]
                continue
            key = SHORT2LONG.get(_ALIASES.get(nm, nm), _ALIASES.get(nm, nm))
            if key not in HP:
                print(f"skipping unknown point '{row[0]}'", file=sys.stderr)
                continue
            pts[key] = v
    miss = [k for k in HP if k not in pts]
    if miss:
        sys.exit("missing points: " + ", ".join(miss) + "\nnames accepted: " + ", ".join(HP) + " (or short names "
                 + ", ".join(HP.values()) + ")")
    t = copy.deepcopy(TEMPLATE_FRONT if axle == "front" else TEMPLATE_REAR)
    t["name"] = name or f"{axle} from {path}"
    t["axle"] = axle
    t["hardpoints"] = {k: [round(v, 3) for v in pts[k]] for k in HP}
    if spring:
        rates = {k: v for k, v in t["spring"].items() if k not in SPRING_POINTS}
        t["spring"] = {**rates, "rod_on": "lower", **spring}
    else:
        t.pop("spring")
    return {k: t[k] for k in ("name", "axle", "hardpoints", "wheel", "vehicle", "spring") if k in t}
