"""Advice: single and paired coordinate moves that fix a failing target without breaking others."""
from __future__ import annotations

import copy

from ..config import METRICS
from ..kinematics import SolveError, evaluate
from ..output import f_num
from ..schema import MOVES_FILE
from .common import _fails, point_ref, quick


def _aim(v, lo, hi):
    """Where to steer a failing metric: just inside the nearest bound (20 % of the window)."""
    win = (hi - lo) if (lo is not None and hi is not None) else 0.0
    if lo is not None and v < lo:
        return lo + 0.2 * win if win else lo + abs(lo) * 0.05 + 1e-3
    return hi - 0.2 * win if win else hi - abs(hi) * 0.05 - 1e-3


def _inside(v, lo, hi):
    return v == v and (lo is None or v >= lo) and (hi is None or v <= hi)


def candidate_moves(cfg, key):
    """The moves worth trying for a failing metric (schema/moves.json, the same list the web app uses): each point
    along X, Y and Z, plus the paired moves. Spring-side metrics use the spring points. Each move is
    (label, [(point ref, axis index)]) - every listed coordinate moves by the same amount."""
    spring_side = key in MOVES_FILE["spring_metrics"]
    if spring_side:
        pts = [f"spring.{k}" for k in MOVES_FILE["spring_points"] if (cfg.get("spring") or {}).get(k) is not None]
    else:
        pts = list(MOVES_FILE["hardpoints"])
    out = [(f"{p}.{ax}", [(p, i)]) for p in pts for i, ax in enumerate("xyz")]
    if not spring_side:
        out += [(f"{'+'.join(g['points'])}.{g['axis']} ({g['name']})", [(p, "xyz".index(g["axis"])) for p in g["points"]])
                for g in MOVES_FILE["groups"]]
    return out


def apply_move(cfg, coords, mm):
    c = copy.deepcopy(cfg)
    for p, i in coords:
        point_ref(c, p)[i] += mm
    return c


def advise(cfg, ev, delta=4.0, reach=40.0, top=3, shortlist=8):
    """For every failing target find the moves (single coordinates and the paired moves) that fix it with the
    fewest side effects. Each candidate is re-solved with a quick evaluation, then the best few are re-checked with
    a full evaluation (every target and link clearance), as the web app does. Returns [(metric, value, lo, hi,
    [candidates])]."""
    m0 = ev["metrics"]
    fails = [f for f in _fails(cfg, m0) if f[0] not in ("camber", "toe", "ride_freq", "damper_margin")]
    if not fails:
        return []
    need_steer = any(f[0] == "ackermann" for f in fails)
    base = quick(cfg, steer=need_steer)
    base_fail = {f[0] for f in _fails(cfg, base)}
    full_fail = {f[0] for f in _fails(cfg, m0)}
    pk0 = ev.get("pack")
    slopes = {}
    out = []
    for k, v, lo, hi in fails:
        aim = _aim(v, lo, hi)
        cands = []
        for label, coords in candidate_moves(cfg, k):
            if label not in slopes:
                try:
                    slopes[label] = quick(apply_move(cfg, coords, delta), steer=need_steer)
                except SolveError:
                    slopes[label] = None
            mp = slopes[label]
            if mp is None or k not in mp or k not in base:
                continue
            sl = (mp[k] - base[k]) / delta
            if abs(sl) < 1e-9:
                continue
            mv = (aim - v) / sl
            if abs(mv) > reach:
                continue
            res = None
            x0, y0 = 0.0, v
            for _ in range(4):  # secant refinement: the response is nonlinear for big moves
                c2 = apply_move(cfg, coords, mv)
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
            cands.append(dict(coord=label, move=mv, new=m2[k], cfg=c2,
                              broken=sorted({f[0] for f in _fails(cfg, m2)} - base_fail)))
        cands.sort(key=lambda c: (len(c["broken"]), abs(c["move"])))
        # full re-check of the shortlist: the quick evaluation can miss a target that only fails mid-travel
        checked = []
        for c in cands[:shortlist]:
            try:
                e2 = evaluate(c["cfg"], steer=need_steer or cfg["axle"] == "front", pack=pk0 is not None)
            except SolveError:
                continue
            m2 = e2["metrics"]
            if not _inside(m2.get(k, float("nan")), lo, hi):
                continue
            broken = sorted({f[0] for f in _fails(cfg, m2)} - full_fail)
            if pk0 is not None and pk0["ok"] and not e2["pack"]["ok"]:
                broken.append("link_clearance")
            checked.append(dict(coord=c["coord"], move=c["move"], new=m2[k], broken=broken))
            if len([x for x in checked if not x["broken"]]) >= top:
                break
        checked.sort(key=lambda c: (len(c["broken"]), abs(c["move"])))
        out.append((k, v, lo, hi, checked[:top]))
    return out


def print_advice(adv, cfg, ev):
    pk = ev.get("pack")
    if not adv and not (pk and not pk["ok"]):
        print("\nAdvice: every hardpoint-driven target passes.")
        return
    print("\nAdvice - single and paired coordinate moves that fix a failing target (each re-solved, the best re-checked in full)")
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
