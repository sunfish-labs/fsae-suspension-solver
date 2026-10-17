#!/usr/bin/env python3
"""
susp_solver.py - FSAE double-wishbone design tool (one corner, rigid links)

Commands
    template  front|rear     print a starter config (JSON) incl. a pushrod/rocker spring block
    run       cfg.json       heave, roll, steer, springs, packaging, target checks
                             (--advise suggests fixes, --log h.csv --note "..." records the run, --plot p.png)
    loads     cfg.json       member forces for standard load cases + buckling/yield safety factors
    car       front rear     whole car: ride frequencies, roll gradient, LLTD, anti-roll bar needed
    report    cfg.json       shareable HTML report (--baseline other.json shows changes)
    sens      cfg.json       what does +5 mm on each hardpoint coordinate do?
    compare   a.json b.json  side-by-side metrics for two configs
    optimize  cfg.json       tune chosen coordinates to hit goals (writes a new config)
    history   h.csv          table/plot of every logged run
    import    pts.csv        build a config from name,x,y,z points (SolidWorks export)
    ui                       open the browser UI: KineSolver-style inputs, live 3D corner, all results
    selftest                 KineSolver comparison + first-principles physics checks

Conventions: X forward, Y outboard, Z up, mm, deg, N; right-hand wheel; ground at Z = 0.
Toe + = toe-in. Camber - = top leaning in. Requires python 3.8+, numpy, scipy; matplotlib for plots.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy  # noqa: F401
    import scipy  # noqa: F401
except ImportError:  # pragma: no cover
    sys.exit("This tool needs numpy and scipy:  pip install numpy scipy matplotlib")

from susp import config as C                      # noqa: E402
from susp import output as O                      # noqa: E402
from susp import tools as T                       # noqa: E402
from susp.errors import SuspError                # noqa: E402
from susp.kinematics import evaluate              # noqa: E402


def load(path, warn=True):
    cfg = C.load_config(path)
    if warn:
        issues = O.print_warnings(cfg)
        if any(lv == "error" for lv, _ in issues):
            sys.exit("\nFix the input errors above first.")
    return cfg


def cmd_template(a):
    t = C.TEMPLATE_FRONT if a.axle == "front" else C.TEMPLATE_REAR
    print(json.dumps(t, indent=2))


def cmd_run(a):
    cfg = load(a.config)
    ev = evaluate(cfg, steer=not a.no_steer, pack=not a.no_pack or bool(a.advise or a.log))
    O.print_report(cfg, ev)
    if a.csv:
        O.write_csv(a.csv, ev)
    if a.plot:
        O.make_plot([ev], [cfg["name"]], a.plot)
    if a.rocker_plot:
        O.make_rocker_plot(ev, a.rocker_plot)
    if a.advise:
        T.print_advice(T.advise(cfg, ev), cfg, ev)
    if a.log:
        T.log_run(a.log, cfg, ev, a.note)


def _loads(cfg, ev, lltd=None):
    from susp.loads import run_loads
    if ev.get("spring") is None:
        sys.exit("Loads need a 'spring' block (the pushrod/pullrod carries the vertical load). "
                 "See 'template front' for an example.")
    return run_loads(cfg, ev["susp"], ev["spring"], lltd)


def cmd_loads(a):
    if C.is_car_file(a.config):
        # a car file: both corners, with the lateral load transfer split from the car's own roll balance
        from susp.car import car_balance
        f, r, info = C.load_car(a.config)
        fe, re_ = evaluate(f, steer=False, pack=False), evaluate(r, steer=False, pack=False)
        lltd = None
        if fe.get("spring") and re_.get("spring"):
            lltd = car_balance(f, fe, r, re_, None, None, info["arb_f"], info["arb_r"], info["car_targets"])["lltd"]
            print(f"Front LLTD from the car's roll balance: {lltd * 100:.1f} %")
        fea = []
        for cfg, ev in ((f, fe), (r, re_)):
            L = _loads(cfg, ev, lltd)
            O.print_loads(cfg, ev, L)
            fea.append((cfg, ev, L))
        _write_fea(a, fea)
        return
    cfg = load(a.config)
    ev = evaluate(cfg, steer=False, pack=False)
    L = _loads(cfg, ev)
    O.print_loads(cfg, ev, L)
    _write_fea(a, [(cfg, ev, L)])


def _write_fea(a, corners):
    """--fea FILE: every force on the upright, wishbones and rocker for each case, for FEA in CAD (solver frame, mm, N)."""
    if not a.fea:
        return
    from susp.loads.parts import part_loads, to_csv
    text = ""
    for cfg, ev, L in corners:
        csv = to_csv(part_loads(cfg, ev["susp"], ev["spring"], L))
        lines = csv.splitlines()
        if len(corners) > 1:                                   # a car: say which axle each row is
            lines = (["axle," + lines[0]] if not text else []) + [f"{cfg['axle']},{ln}" for ln in lines[1:]]
        text += "\n".join(lines) + "\n"
    with open(a.fea, "w") as fh:
        fh.write(text)
    print(f"\nPart loads for FEA written to {a.fea} (right-hand corner, solver frame: X forward, Y right, Z up; mm and N)")


def cmd_layout(a):
    """Layout totals (mass, CG, shares, inertia) and the drivetrain's straight-line run, from a car file."""
    from susp.layout import accel_run
    if not C.is_car_file(a.car):
        sys.exit("layout needs a car file (front and rear corners, a vehicle block and a layout and/or drivetrain block)")
    f, r, info = C.load_car(a.car)
    lr = info.get("layout_res")
    if lr:
        print(f"Layout: {lr['n']} parts + 4 wheel assemblies ({lr['unsprung']:.1f} kg unsprung)")
        for g, m in sorted(lr["groups"].items(), key=lambda kv: -kv[1]):
            print(f"  {g:<14} {m:7.1f} kg")
        x, y, z = lr["cg"]
        print(f"  total {lr['mass']:.1f} kg; CG x {x:.0f}, y {y:.0f}, z {z:.0f} mm; front {lr['weight_front'] * 100:.1f} %, "
              f"left {lr['weight_left'] * 100:.1f} %")
        print(f"  inertia about the CG: roll {lr['Ixx']:.1f}, pitch {lr['Iyy']:.1f}, yaw {lr['Izz']:.1f} kg m^2")
        print("  the car's mass and CG come from the layout (layout.apply)" if (info["layout"] or {}).get("apply")
              else "  not applied: the vehicle block's typed mass and CG are used (set layout.apply to use these)")
    d = info.get("drivetrain")
    if d:
        v = f["vehicle"]
        ar = accel_run(d, v, r["wheel"]["tire_radius"], v["wheelbase"])
        print(f"\nDrivetrain{': ' + d['name'] if d.get('name') else ''} ({v['mass']:.0f} kg, mu {ar['mu']:g})")
        for g in ar["gears"]:
            print(f"  gear {g['gear']}: overall ratio {g['ratio']:.2f}, {g['top_speed'] * 3.6:.1f} km/h at the redline"
                  + (f" (drag holds it to {g['max_speed'] * 3.6:.1f})" if g["max_speed"] < g["top_speed"] - 1e-6 else ""))
        print(f"  {ar['distance']:g} m in {ar['time']:.2f} s, {ar['speed'] * 3.6:.1f} km/h at the line; grip-limited for the first "
              f"{ar['grip_limited_to']:.1f} m (launch {ar['launch_accel']:.2f} g, grip limit {ar['grip_accel']:.2f} g)")
        for s in ar["shifts"]:
            print(f"  shift to {s['gear']} at {s['t']:.2f} s, {s['x']:.1f} m, {s['v'] * 3.6:.1f} km/h")
    if not lr and not d:
        print("This car file has no layout or drivetrain block yet. See designs/example_car_layout.json.")


def cmd_rules(a):
    """The car against a rulebook (schema/rules/*.json): pass / fail / can't check / check yourself, by rule number."""
    from susp.car import car_balance
    from susp.rules import check_rules, rule_values, rulesets
    sets = rulesets()
    if a.rules not in sets:
        sys.exit(f"no rules file '{a.rules}'; available: {', '.join(sets)}")
    rs = sets[a.rules]
    if not C.is_car_file(a.car):
        sys.exit("rules needs a car file (front and rear corners and a vehicle block)")
    f, r, info = C.load_car(a.car)
    fe, re_ = evaluate(f), evaluate(r)
    bal = car_balance(f, fe, r, re_, None, None, info["arb_f"], info["arb_r"]) if fe.get("ride") and re_.get("ride") else None
    rows = check_rules(rs, rule_values(f, fe, r, re_, bal, info.get("layout"), info.get("cockpit")))
    print(f"{rs['name']} ({rs['version']}): rule numbers and paraphrases; read the rulebook for the exact wording.\n")
    mark = {"pass": "PASS ", "fail": "FAIL ", "unknown": "  ?  ", "manual": "CHECK", "na": " n/a "}
    for row in rows:
        v = row["value"]
        vt = (f"{v * 100:.1f} %" if row["id"] == "track_ratio" else f"{v:.1f} {row['unit']}".rstrip()) if isinstance(v, float) else ""
        lim = ("" if row.get("limit") is None or row["kind"] not in ("min", "max") else
               f" (limit {row['limit'] * 100:g} %)" if row["id"] == "track_ratio" else f" (limit {row['limit']:g} {row['unit']})".replace(" )", ")"))
        extra = (("; " if vt else "") + row["note"]) if row["note"] else ""
        est = " (estimate)" if row["estimate"] else ""
        if row["status"] == "na":
            print(f"  {mark['na']} {row['rule']:<22} {row['summary']}: doesn't apply ({row['note']})")
            continue
        print(f"  {mark[row['status']]} {row['rule']:<22} {row['summary']}" + (f": {vt}{lim}{est}{extra}" if vt or extra else ""))
    n = {s: sum(r_["status"] == s for r_ in rows) for s in mark}
    print(f"\n{n['pass']} pass, {n['fail']} fail, {n['unknown']} can't check (missing inputs), {n['manual']} to check yourself"
          + (f", {n['na']} don't apply" if n["na"] else ""))


def cmd_car(a):
    from susp.car import car_balance
    info = {"arb_f": 0.0, "arb_r": 0.0, "car_targets": {}}
    if a.rear is None:
        if not C.is_car_file(a.front):
            sys.exit("give a car file (with 'front' and 'rear'), or a front config and a rear config")
        f, r, info = C.load_car(a.front)
        from susp.car import CAR_TARGETS
        for m in C.unknown_car_target_keys(info["car_targets"], CAR_TARGETS):
            print("WARNING: " + m)
    else:
        f, r = load(a.front), load(a.rear)
        if f["axle"] != "front" or r["axle"] != "rear":
            sys.exit("give the front config first, then the rear config")
    if not (f.get("spring") and r.get("spring")):
        sys.exit("both corners need a 'spring' block")
    arb_f = a.arb_front if a.arb_front is not None else info["arb_f"]
    arb_r = a.arb_rear if a.arb_rear is not None else info["arb_r"]
    fe, re_ = evaluate(f, steer=False, pack=False), evaluate(r, steer=False, pack=False)
    O.print_car(f, r, car_balance(f, fe, r, re_, a.grad, a.lltd / 100 if a.lltd else None, arb_f, arb_r, info["car_targets"]))


def cmd_report(a):
    cfg = load(a.config)
    base = C.load_config(a.baseline) if a.baseline else None
    ev = evaluate(cfg)
    cols, srows, _ = T.compute_sens(cfg, a.delta)
    loads = _loads(cfg, ev) if ev.get("spring") else None
    O.build_report(cfg, ev, a.out, base, a.delta, sens=(cols, srows), adv=T.advise(cfg, ev), loads=loads)


def cmd_sens(a):
    cfg = load(a.config, warn=False)
    cols, rows, base = T.compute_sens(cfg, a.delta, a.points, a.spring)
    T.print_sens(cfg, a.delta, cols, rows, base, a.metric, a.top)


def cmd_compare(a):
    cfgs = [load(a.a, warn=False), load(a.b, warn=False)]
    evs = [evaluate(c) for c in cfgs]
    keys = ["camber", "toe", "caster", "kpi", "scrub", "trail", "roll_center", "fvsa", "camber_gain",
            "bump_steer", "bump_steer_curve", "bump_steer_max", "track_change", "roll_camber", "rc_lat", "roll_steer", "antidive",
            "antisquat", "antilift", "ackermann", "turn_radius", "motion_ratio", "wheel_rate", "ride_freq",
            "damper_used", "clearance_min", "rim_margin"]
    print(f"\nCompare: A = {cfgs[0]['name']}   B = {cfgs[1]['name']}")
    out = []
    for k in keys:
        x, y = evs[0]["metrics"].get(k), evs[1]["metrics"].get(k)
        if x is None and y is None:
            continue
        d = "" if (x is None or y is None) else f"{y - x:+.{C.METRICS[k][2]}f}"
        out.append([C.METRICS[k][0], O.f_num(x, C.METRICS[k][2]), O.f_num(y, C.METRICS[k][2]), d, C.METRICS[k][1]])
    O.table(["metric", "A", "B", "B - A", "unit"], out)
    for c, e, tag in zip(cfgs, evs, "AB"):
        bad = [lab for key, lab, v, rng, st in O.all_checks(c, e) if st == "FAIL"]
        print(f"{tag}: failing checks -> {', '.join(bad) if bad else 'none'}")
    if a.plot:
        O.make_plot(evs, [cfgs[0]["name"], cfgs[1]["name"]], a.plot)


def cmd_optimize(a):
    cfg = load(a.config, warn=False)
    T.optimize(cfg, a.vary, a.goal, a.bound, a.reg, a.min_clearance, a.max_nfev,
               a.out or a.config.replace(".json", "_opt.json"), a.keep_clear)


def cmd_history(a):
    T.show_history(a.file, a.metrics, a.plot)


def cmd_import(a):
    cfg = T.import_csv(a.csv, a.axle, a.map, a.scale, a.offset, a.name)
    txt = json.dumps(cfg, indent=2)
    if a.out:
        with open(a.out, "w") as f:
            f.write(txt)
        print(f"wrote {a.out}")
        O.print_warnings(C.load_config(a.out))
    else:
        print(txt)
    print("check: contact patch must be at Z=0 and Y = half the track; X forward, Y outboard, Z up.", file=sys.stderr)


def cmd_ui(a):
    """Open the browser UI (ui/index.html). It runs the same solver, ported to JavaScript, with no server."""
    import pathlib
    import webbrowser
    import subprocess
    ui = pathlib.Path(__file__).resolve().parent / "ui"
    page = ui / "index.html"
    # the built page is not kept in the repo: build it from the sources (a second or so)
    subprocess.run([sys.executable, str(ui / "build.py")], check=True, stdout=subprocess.DEVNULL)
    print(f"opening {page}")
    webbrowser.open(page.as_uri())


def cmd_selftest(a):
    from susp import selftest
    return selftest.run()


def main():
    ap = argparse.ArgumentParser(description="FSAE double-wishbone design tool (see the header of this file).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("template", help="print a starter config")
    p.add_argument("axle", choices=["front", "rear"])
    p.set_defaults(fn=cmd_template)
    p = sub.add_parser("run", help="full kinematic + ride report")
    p.add_argument("config")
    p.add_argument("--plot", help="PNG with heave/roll/steer curves and front/side geometry views")
    p.add_argument("--rocker-plot", help="PNG of the rocker/pushrod/damper at droop, ride and bump")
    p.add_argument("--csv", help="file prefix for heave/roll/steer CSVs")
    p.add_argument("--no-steer", action="store_true")
    p.add_argument("--no-pack", action="store_true")
    p.add_argument("--log", help="append this run to a history CSV and show what changed")
    p.add_argument("--note", default="", help="what you changed (stored in the log)")
    p.add_argument("--advise", action="store_true", help="suggest single-coordinate fixes for failing targets")
    p.set_defaults(fn=cmd_run)
    p = sub.add_parser("loads", help="member forces and safety factors for standard load cases (a design or a car file)")
    p.add_argument("config")
    p.add_argument("--fea", metavar="FILE.csv", help="also write every force on the upright, wishbones and rocker, per case, for FEA in CAD")
    p.set_defaults(fn=cmd_loads)
    p = sub.add_parser("rules", help="the car against a rulebook (default: Formula SAE 2027, IC)")
    p.add_argument("car")
    p.add_argument("--rules", default="fsae_2027_ic", help="rules file in schema/rules/ (without .json)")
    p.set_defaults(fn=cmd_rules)
    p = sub.add_parser("layout", help="mass, CG and inertia from a car file's layout, and its drivetrain's straight-line run")
    p.add_argument("car")
    p.set_defaults(fn=cmd_layout)
    p = sub.add_parser("car", help="whole-car roll balance from a car file, or a front and a rear config")
    p.add_argument("front", help="car file, or the front config")
    p.add_argument("rear", nargs="?", help="rear config")
    p.add_argument("--arb-front", type=float, help="front anti-roll bar at the wheels, Nm/deg (overrides the car file)")
    p.add_argument("--arb-rear", type=float, help="rear anti-roll bar at the wheels, Nm/deg")
    p.add_argument("--grad", type=float, help="target roll gradient, deg/g (default 1.0)")
    p.add_argument("--lltd", type=float, help="target front LLTD, %% (default front weight + 5)")
    p.set_defaults(fn=cmd_car)
    p = sub.add_parser("report", help="shareable HTML report with plots, fixes, loads and sensitivity")
    p.add_argument("config")
    p.add_argument("-o", "--out", default="report.html")
    p.add_argument("--baseline", help="config to compare against (adds change columns)")
    p.add_argument("--delta", type=float, default=5.0)
    p.set_defaults(fn=cmd_report)
    p = sub.add_parser("sens", help="effect of +delta mm on every hardpoint coordinate")
    p.add_argument("config")
    p.add_argument("--delta", type=float, default=5.0)
    p.add_argument("--points", help="comma list of substrings, e.g. lower,trackrod")
    p.add_argument("--metric", help="sort by this metric")
    p.add_argument("--top", type=int)
    p.add_argument("--spring", action="store_true", help="vary the pushrod/rocker/damper points instead")
    p.set_defaults(fn=cmd_sens)
    p = sub.add_parser("compare", help="side-by-side metrics for two configs")
    p.add_argument("a")
    p.add_argument("b")
    p.add_argument("--plot")
    p.set_defaults(fn=cmd_compare)
    p = sub.add_parser("optimize", help="tune coordinates to hit goals")
    p.add_argument("config")
    p.add_argument("--vary", required=True, help="e.g. lower_inboard_front.z,trackrod_inboard or spring.rocker_damper.y; a+b.z moves points a and b together")
    p.add_argument("--goal", action="append", required=True,
                   help="metric=target[:tol], metric>=limit[:tol] or metric<=limit[:tol]; repeatable")
    p.add_argument("--bound", type=float, default=40.0, help="max move per coordinate, mm")
    p.add_argument("--reg", type=float, default=0.005, help="penalty on move size (keeps moves small)")
    p.add_argument("--min-clearance", type=float, help="min link center-line distance, mm")
    p.add_argument("--keep-clear", action="store_true", help="keep every clearance pair above its required gap")
    p.add_argument("--max-nfev", type=int, default=60)
    p.add_argument("--out")
    p.set_defaults(fn=cmd_optimize)
    p = sub.add_parser("history", help="show the run log written by 'run --log'")
    p.add_argument("file")
    p.add_argument("--metrics", help="comma list")
    p.add_argument("--plot")
    p.set_defaults(fn=cmd_history)
    p = sub.add_parser("import", help="build a config from a name,x,y,z CSV (e.g. SolidWorks points)")
    p.add_argument("csv")
    p.add_argument("--axle", choices=["front", "rear"], required=True)
    p.add_argument("--map", default="x,y,z", help="output x,y,z from input columns, e.g. 'z,-x,y'")
    p.add_argument("--scale", type=float, default=1.0, help="e.g. 1000 for meters -> mm")
    p.add_argument("--offset", default="0,0,0", help="added after mapping, mm")
    p.add_argument("--name")
    p.add_argument("-o", "--out")
    p.set_defaults(fn=cmd_import)
    p = sub.add_parser("ui", help="open the browser UI (3D view, live results)")
    p.set_defaults(fn=cmd_ui)
    p = sub.add_parser("selftest", help="validate the solver")
    p.set_defaults(fn=cmd_selftest)
    a = ap.parse_args()
    try:
        rc = a.fn(a)
    except SuspError as e:                      # bad input or an unreachable position: one clear line, no traceback
        sys.exit(f"\nERROR: {e}")
    except BrokenPipeError:                     # output piped into head, less, ...: stop quietly
        os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        sys.exit(0)
    sys.exit(rc or 0)


if __name__ == "__main__":
    main()
