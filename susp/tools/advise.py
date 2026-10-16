"""Advice: single coordinate moves that fix a failing target without breaking others."""
from __future__ import annotations

from ..config import HP, METRICS
from ..kinematics import SolveError, evaluate
from ..output import f_num
from .common import _fails, quick, set_coord


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
