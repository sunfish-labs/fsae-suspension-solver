"""The shareable one-file HTML report: the numbers are gathered here, the page itself is templates/report.html.j2
(Jinja, autoescaped)."""
from __future__ import annotations

import base64
import datetime
import os
import tempfile

from ..config import HP_ORDER, METRIC_HELP, METRICS, validate
from ..kinematics import rack_for_angle
from ..loads import MEMBERS, member_label
from .plots import make_plot, make_rocker_plot
from .text import all_checks, f_num

_TEMPLATES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")


def _png(fn, *args):
    """Run a plot function into a temporary PNG and return it base64-encoded ('' if matplotlib is missing)."""
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        if fn(*args, tmp, quiet=True):
            with open(tmp, "rb") as f:
                return base64.b64encode(f.read()).decode()
        return ""
    finally:
        os.remove(tmp)


def report_context(cfg, ev, baseline=None, delta=5.0, sens=None, adv=None, loads=None):
    """Everything the report template shows, as plain values and preformatted strings."""
    m, pk, s = ev["metrics"], ev.get("pack"), ev["susp"]
    lab = lambda k: METRICS[k][0]                             # noqa: E731
    fmt = lambda k, v: f_num(v, METRICS[k][2])                # noqa: E731
    chk = all_checks(cfg, ev)
    bm = None
    if baseline:
        from ..kinematics import evaluate
        bm = evaluate(baseline)["metrics"]
    checks = []
    for key, label, v, rng, st in chk:
        row = dict(label=label, value=f"{v} {METRICS[key][1] if key in METRICS else 'mm'}", range=rng, ok=st == "PASS", status=st)
        if bm is not None:
            b = bm.get(key) if key in METRICS else None
            ok = b is not None and key in m and isinstance(m[key], float)
            row["base"] = f_num(b, METRICS[key][2]) if ok else ""
            row["change"] = f"{m[key] - b:+.{METRICS[key][2]}f}" if ok else ""
        checks.append(row)
    show = ["camber", "camber_gain", "roll_camber", "caster", "kpi", "scrub", "trail", "roll_center", "rc_lat", "bump_steer", "track_change"]
    show += ["antidive"] if cfg["axle"] == "front" else ["antisquat", "antilift"]
    show += [k for k in ("ackermann", "turn_radius", "motion_ratio", "ride_freq") if k in m]
    ctx = dict(
        name=cfg["name"], axle=cfg["axle"], generated=f"{datetime.datetime.now():%Y-%m-%d %H:%M}",
        sub=f"wheelbase {s.WB:.0f} mm · track {s.track:.0f} mm · CG {s.CG:.0f} mm · mass {cfg['vehicle']['mass']:g} kg · tire R {s.R:.0f} mm",
        issues=validate(cfg), npass=sum(1 for c in chk if c[4] == "PASS"), ntot=len(chk),
        tiles=[dict(label=lab(k), value=fmt(k, m[k]), unit=METRICS[k][1]) for k in show if k in m],
        checks=checks, baseline=bm is not None, img=_png(make_plot, [ev], [cfg["name"]]),
        rocker_img=_png(make_rocker_plot, ev) if ev.get("spring") is not None else "",
        help=[dict(label=lab(k), text=METRIC_HELP[k]) for k in show + ["toe", "fvsa", "roll_steer", "steer_arm", "clearance_min"] if k in METRIC_HELP],
    )
    if adv is not None:
        ctx["advice"] = [dict(label=lab(k), value=fmt(k, v), range=f"{'' if lo is None else f'{lo:.4g}'} … {'' if hi is None else f'{hi:.4g}'}",
                              moves=[dict(coord=c["coord"], move=f"{c['move']:+.1f} mm", new=fmt(k, c["new"]),
                                          side=("breaks " + ", ".join(c["broken"])) if c["broken"] else "none") for c in cands])
                         for k, v, lo, hi, cands in adv]
        ctx["advice_all_clear"] = not adv and (pk is None or pk["ok"])
        if pk and not pk["ok"]:
            nm, (d, _hz, _rk, need) = pk["min_pair"]
            ctx["advice_clearance"] = dict(pair=nm, d=f"{d:.1f}", need=f"{need:.1f}")
    if ev.get("roll"):
        R = ev["roll"]
        ctx["roll"] = dict(roll_camber=f_num(m["roll_camber"], 3), rc_lat=f_num(m["rc_lat"], 1),
                           rows=[[f"{r['roll']:.1f}", f"{r['camber_outer']:.2f}", f"{r['camber_inner']:.2f}", f"{r['toe_outer']:.3f}",
                                  f_num(r["rc_height"], 1), f_num(r["rc_lateral"], 1)] for r in R[len(R) // 2:]])
    if ev.get("steer"):
        st = ev["steer"]
        sel = [st[i] for i in range(0, len(st), max(1, len(st) // 7))]
        if st[-1] not in sel:
            sel.append(st[-1])
        ri = rack_for_angle(st, "inner", 25.0)
        ctx["steer"] = dict(rows=[[f"{r['rack']:.1f}", f"{r['inner']:.2f}", f"{r['outer']:.2f}", f_num(r["ackermann"], 0),
                                   f"{r['camber_inner']:.2f}", f"{r['camber_outer']:.2f}"] for r in sel],
                            rack25=f"{ri:.1f} mm" if ri is not None else "more than the range tested",
                            ack_at=f"{cfg['sweep']['ackermann_at_outer_deg']:g}",
                            turn=f"{m['turn_radius']:.2f}" if "turn_radius" in m else None, arm=f"{m['steer_arm']:.0f}")
    if ev.get("ride"):
        rd, sc = ev["ride"], cfg["spring"]
        ctx["ride"] = dict(
            intro=f"{sc['rod_on']}-arm rod, {'direct-acting damper' if ev['spring'].direct else 'rocker'}; spring {sc['spring_rate']:g} N/mm, "
                  f"tire {sc['tire_rate']:g} N/mm, sprung corner mass {rd['_m_sprung']:.1f} kg.",
            rows=[dict(label=lab(k), value=f"{fmt(k, m[k])} {METRICS[k][1]}") for k in (
                "motion_ratio", "mr_progression", "wheel_rate", "wheel_rate_preload", "wheel_rate_bump", "bumpstop_travel", "ride_rate", "ride_freq",
                "static_spring_force", "spring_for_target", "damper_used", "damper_margin", "damper_static_pos", "damper_topout",
                "damper_bottomout", "rod_angle", "rocker_rot", "trans_min", "arb_twist", "arb_wheel_rate", "arb_roll", "arb_tau",
                "arb_fos") if k in m],
            target=(f"For {sc['target_freq_hz']:g} Hz use about {m['spring_for_target']:.0f} N/mm ({m['spring_for_target'] * 5.71:.0f} lbf/in) "
                    "at this motion ratio.") if sc.get("target_freq_hz") and "spring_for_target" in m else None)
    if loads:
        names, mem = list(loads["results"]), cfg["members"]
        res = loads["results"]
        ctx["loads"] = dict(
            cases=names,
            rows=[[member_label(k, s)] + [f"{res[n][k]:+.0f}" for n in names] for k in MEMBERS] + [["Damper/spring"] + [f"{res[n]['damper']:+.0f}" for n in names]],
            material=f"Material: {mem.get('material', 'steel')}, E {mem['E']:g} MPa, yield {mem['yield']:g} MPa, required FOS {mem['sf_target']:g}.",
            checks=[dict(member=member_label(r["member"], s), tube=f"{r['od']:g}×{r['wall']:g}", comp=f"{r['compression']:.0f} N",
                         pcr=f"{r['Pcr']:.0f} N", sfb=f_num(r["sf_buckle"], 1), peak=f"{r['peak']:.0f} N", py=f"{r['Py']:.0f} N",
                         sfy=f_num(r["sf_yield"], 1), ok=min(r["sf_buckle"], r["sf_yield"]) >= mem["sf_target"]) for r in loads["checks"]])
        D = loads.get("durability")
        if D:
            end = {"damper": "Damper chassis end", "rocker_pivot": "Rocker pivot"}

            def item(r):
                it = r["item"]
                if it.startswith("tab:"):
                    return f"Tab weld, {(end.get(it[4:]) or member_label(it[4:], s)).lower()}"
                if it.startswith("leg:"):
                    return f"{member_label(it[4:], s)} with the pushrod mount (bending)"
                if it.startswith("gusset:"):
                    return f"{member_label(it[7:], s)}, weld where the gusset ends"
                return f"{member_label(it, s)}, {'tube' if r['kind'] == 'tube' else 'end weld'}"
            ctx["loads"]["tabs"] = [dict(end=end.get(r["member"]) or member_label(r["member"], s), force=f"{r['force']:.0f} N",
                                         fos=[f_num(r["fos"][k], 1) for k in ("bearing", "tearout", "net", "weld")], ok=r["sf"] >= mem["sf_target"])
                                    for r in D["tabs"]]
            tb = D["tab"]
            ctx["loads"]["tab_text"] = (f"{tb['count']:g} tabs × {tb['thickness']:g} mm, {tb['width']:g} mm wide, {tb['edge']:g} mm from the hole to the end; "
                                        f"weld {tb['weld_leg']:g} mm leg × {tb['weld_length']:g} mm per tab (members.tab)")
            ctx["loads"]["fatigue"] = [dict(part=item(r), case=f"{r['case']} × {r['cycles']:,.0f}", applied=f"{r['s_a'] * (2 if r['kind'] == 'weld' else 1):.1f}",
                                            allow=f"{r['allow']:.0f}", n=f_num(r["n"], 2), life="no limit" if r["life"] == float("inf") else f"{r['life']:.2g}", ok=r["ok"])
                                       for r in sorted(D["fatigue"], key=lambda q: q["n"])]
            ctx["loads"]["fatigue_text"] = (f"Each driving case repeated {D['cycles']:,.0f} times and the bump {D['bump_cycles']:,.0f} times, from the car at rest, and the swings between opposite cases (left and right turns, braking and accelerating). "
                                            f"Tubes: Goodman on the Shigley S-N line (applied = amplitude); welds: IIW stress range against FAT {D['weld_fat_tube']:g} "
                                            f"(tube ends) and {D['weld_fat_tab']:g} (tab throats). Required margin {D['fatigue_sf']:g}. A screen at the design g levels, "
                                            "not a life prediction.")
    if pk:
        ctx["pack"] = dict(rows=[dict(pair=n, d=f"{d:.1f}", ok=d >= need, need=f"{need:.1f}", hz=f"{hz:+.0f}", rk=f"{rk:+.0f}")
                                 for n, (d, hz, rk, need) in sorted(pk["pairs"].items(), key=lambda kv: kv[1][0] - kv[1][3])],
                           rim=f"{pk['rim_margin']:.1f}")
    if ev.get("joints"):
        from ..joints import NOTE, best_text, bolt_text
        J = ev["joints"]
        ctx["joints"] = dict(front=cfg["axle"] == "front", n=J["n_poses"], note=NOTE, rows=[
            dict(label=r["label"], kind="spherical bearing" if r["kind"] == "bearing" else "rod end", mount=bolt_text(r),
                 ride=f"{r['ride']:.1f}", worst=f"{r['worst']:.1f}", at=f"{r['at'][0]:+.0f}" + (f" / {r['at'][1]:+.0f}" if cfg["axle"] == "front" else ""),
                 allow=f"{r['allow']:.1f}", margin=f"{r['margin']:+.1f}", ok=r["margin"] >= 0, best=best_text(r)) for r in J["rows"]])
    hps = []
    from ..frame import FRAME, corner_out
    shown = corner_out(cfg)["hardpoints"] if cfg.get("_frame") == FRAME else cfg["hardpoints"]   # as in the file
    for k in HP_ORDER:
        v = shown[k]
        row = dict(name=k, xyz=[f"{x:.2f}" for x in v])
        if baseline:
            dv = [a - b for a, b in zip(cfg["hardpoints"][k], baseline["hardpoints"][k])]
            row["delta"] = ", ".join(f"{n}{x:+.1f}" for n, x in zip("XYZ", dv) if abs(x) > 1e-9) or "-"
        hps.append(row)
    ctx["hardpoints"], ctx["has_baseline_points"] = hps, bool(baseline)
    from ..frame import FRAME_LABEL
    ctx["frame_label"] = (FRAME_LABEL + "; this corner shown as the left-hand one") if cfg.get("_frame") == FRAME else \
        "The solver's own frame: X forward, Y outboard, Z up, mm, X from this corner's own zero"
    if sens:
        cols, srows = sens
        mx = [max(abs(r[1][j]) for r in srows) or 1.0 for j in range(len(cols))]
        rows = []
        for name, vals in srows:
            cells = []
            for j, (v, k) in enumerate(zip(vals, cols)):
                a = min(0.55, 0.55 * abs(v) / mx[j]) if abs(v) > 1e-9 else 0
                dec = METRICS[k][2] if METRICS[k][2] > 1 else 2
                cells.append(dict(rgb="207,34,46" if v < 0 else "9,105,218", a=f"{a:.2f}", text=f"{v:+.{dec}f}"))
            rows.append(dict(name=name, cells=cells))
        ctx["sens"] = dict(delta=f"{delta:g}", cols=[lab(k) for k in cols], rows=rows)
    return ctx


def build_report(cfg, ev, path, baseline=None, delta=5.0, sens=None, adv=None, loads=None):
    import jinja2
    env = jinja2.Environment(loader=jinja2.FileSystemLoader(_TEMPLATES), autoescape=True, trim_blocks=True, lstrip_blocks=True)
    html = env.get_template("report.html.j2").render(**report_context(cfg, ev, baseline, delta, sens, adv, loads))
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {path}")
