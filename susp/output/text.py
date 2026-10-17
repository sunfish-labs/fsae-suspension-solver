"""Text output: tables, the run / ride / loads / car printouts, and CSV export."""
from __future__ import annotations

import csv
import math


from ..config import METRICS, validate
from ..schema import METRICS_FILE
from ..kinematics import check_targets, rack_for_angle, travel_range
from ..loads import MEMBERS, member_label


def f_num(v, dec):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "-"
    if isinstance(v, float) and math.isinf(v):
        return "inf"
    return f"{v:.{dec}f}"


def table(headers, rows, left=1):
    cols = list(zip(*([headers] + rows)))
    w = [max(len(str(c)) for c in col) for col in cols]

    def line(r):
        return "  ".join(str(c).ljust(w[i]) if i < left else str(c).rjust(w[i]) for i, c in enumerate(r))
    print(line(headers))
    print("  ".join("-" * x for x in w))
    for r in rows:
        print(line(r))


def mrow(m, k):
    return [METRICS[k][0], f_num(m.get(k), METRICS[k][2]), METRICS[k][1]]


def print_warnings(cfg):
    issues = validate(cfg)
    if issues:
        print("\nInput checks")
        for lvl, msg in issues:
            print(f"  {'ERROR' if lvl == 'error' else 'warning'}: {msg}")
    return issues


def all_checks(cfg, ev):
    """Target checks plus packaging checks: [(label, value_str, range_str, status)]."""
    m = ev["metrics"]
    out = []
    for k, v, lo, hi, st in check_targets(cfg, m):
        if st == "not computed":
            continue
        rng = f"{'' if lo is None else f_num(float(lo), 2)} .. {'' if hi is None else f_num(float(hi), 2)}"
        out.append((k, METRICS[k][0] if k in METRICS else k, f_num(v, METRICS.get(k, ("", "", 2))[2]),
                    rng.strip(), st))
    pk = ev.get("pack")
    if pk:
        nm, (d, hz, rk, need) = pk["min_pair"]
        out.append(("link_clearance", f"Link clearance ({nm})", f_num(d, 1), f">= {need:.1f}",
                    "PASS" if pk["ok"] else "FAIL"))
        out.append(("rim_margin", "Rim radial margin", f_num(pk["rim_margin"], 1), ">= 5.0",
                    "PASS" if pk["rim_margin"] >= 5 else "FAIL"))
    return out


def print_report(cfg, ev):
    m = ev["metrics"]
    s = ev["susp"]
    print(f"\n=== {cfg['name']}  ({cfg['axle']} axle) ===")
    print(f"wheelbase {s.WB:.0f}  track {s.track:.0f}  CG {s.CG:.0f}  mass {cfg['vehicle']['mass']:.0f} kg  "
          f"tire R {s.R:.0f}  rim {cfg['wheel']['rim_diameter_in']:.0f} in")
    keys = ["camber", "toe", "caster", "kpi", "scrub", "trail", "roll_center", "fvsa",
            "antidive", "antisquat", "antilift"]
    print("\nAt ride height")
    table(["metric", "value", "unit"], [mrow(m, k) for k in keys if k in m])
    D, B = travel_range(cfg)
    trav = f"+/-{B:.0f}" if D == B else f"{D:.0f} droop / {B:.0f} bump"
    print(f"\nOver {trav} mm of heave")
    rowsx = [mrow(m, k) for k in ("camber_gain", "bump_steer", "bump_steer_curve", "bump_steer_max", "track_change")]
    rowsx.append(["Roll center range (ground-relative)", f"{m['rc_min']:.1f} .. {m['rc_max']:.1f}", "mm"])
    table(["metric", "value", "unit"], rowsx)

    if ev.get("roll"):
        R = ev["roll"]
        print(f"\nRoll (+/-{m['roll_max_deg']:.1f} deg body roll, equal and opposite wheel travel; "
              "camber relative to the ground)")
        table(["metric", "value", "unit"],
              [mrow(m, k) for k in ("roll_camber", "roll_camber_max", "roll_steer", "rc_lat", "rc_height_roll")])
        sel = [R[i] for i in range(len(R) // 2, len(R))]
        table(["roll deg", "outer camber", "inner camber", "RC height", "RC lateral"],
              [[f"{r['roll']:.1f}", f"{r['camber_outer']:.2f}", f"{r['camber_inner']:.2f}",
                f_num(r["rc_height"], 1), f_num(r["rc_lateral"], 1)] for r in sel], left=0)
        print("  roll camber 1.0 = the wheel leans with the body; lower = more camber recovery.")

    if ev.get("steer"):
        st = ev["steer"]
        print(f"\nSteering (rack +/-{cfg['sweep']['rack_travel']:.0f} mm, track {s.track:.0f}, wheelbase {s.WB:.0f})")
        sel = [st[i] for i in range(0, len(st), max(1, len(st) // 7))]
        if st[-1] not in sel:
            sel.append(st[-1])
        table(["rack mm", "inner deg", "outer deg", "Ackermann %", "inner camber", "outer camber"],
              [[f"{r['rack']:.1f}", f"{r['inner']:.2f}", f"{r['outer']:.2f}", f_num(r["ackermann"], 0),
                f"{r['camber_inner']:.2f}", f"{r['camber_outer']:.2f}"] for r in sel], left=0)
        lock = cfg["sweep"]["ackermann_at_outer_deg"]
        note = "" if ev.get("ack_reached", True) else "  (outer wheel never reached that angle - last row used)"
        print(f"Ackermann at {lock:.0f} deg outer wheel: {f_num(m['ackermann'], 0)} %{note}")
        for key in ("inner", "outer"):
            r25 = rack_for_angle(st, key, 25.0)
            print(f"rack needed for 25 deg on the {key} wheel: "
                  f"{f'{r25:.1f} mm' if r25 is not None else 'more than the range tested'}")
        if "turn_radius" in m:
            print(f"turning radius of the outer front wheel at full rack: {m['turn_radius']:.2f} m "
                  f"(diameter {2 * m['turn_radius']:.2f} m - compare with the tightest hairpin in the current rules)")
        print(f"steering arm (tie-rod joint to kingpin axis): {m['steer_arm']:.1f} mm")
        cf = cfg["vehicle"].get("rack_c_factor")
        if cf:
            print(f"steering wheel lock-to-center: {cfg['sweep']['rack_travel'] / cf * 360:.0f} deg "
                  f"(c-factor {cf:g} mm/rev)")

    if ev.get("ride"):
        print_ride(cfg, ev)

    if ev.get("pack"):
        p = ev["pack"]
        print(f"\nPackaging (heave {trav}"
              + (f", rack +/-{cfg['sweep']['rack_travel']:.0f}" if s.axle == "front" else "")
              + "; center-line distances)")
        fr = s.axle == "front"
        table(["link pair", "min mm", "needs", "at heave"] + (["at rack"] if fr else []) + [""],
              [[n, f"{d:.1f}", f"{need:.1f}", f"{hz:+.0f}"] + ([f"{rk:+.0f}"] if fr else [])
               + ["OK" if d >= need else "TOO CLOSE"]
               for n, (d, hz, rk, need) in sorted(p["pairs"].items(), key=lambda kv: kv[1][0] - kv[1][3])])
        cl = cfg["clearance"]
        print(f"needs = (OD a + OD b)/2 + margin {cl['margin']:g} mm; ODs: wishbone {cl['wishbone_tube_od']:g}, "
              f"tie rod {cl['tie_rod_od']:g}, pushrod {cl.get('pushrod_od', 15.9):g}")
        nm, hz, rk = p["rim_where"]
        print(f"rim: farthest of UBJ/LBJ/TRO from the wheel axis is {p['rim_max']:.1f} mm "
              f"({nm} at heave {hz:+.0f}); rim barrel inner radius {p['rim_radius']:.1f} mm -> margin {p['rim_margin']:.1f} mm "
              "(radial check only" + ("" if cfg["wheel"].get("rim_inner_radius") else "; barrel radius estimated as rim radius - 15 mm: set wheel.rim_inner_radius") + ")")
        if "caliper_rim_margin" in p:
            print(f"caliper: outer edge {p['rim_radius'] - p['caliper_rim_margin']:.1f} mm from the axle -> {p['caliper_rim_margin']:.1f} mm to the rim barrel")
    if "hs_plunge" in m:
        print(f"\nHalfshaft (diff output to outboard CV): plunge {m['hs_plunge']:.1f} mm over the travel; worst CV angles "
              f"{m['hs_cv_in_max']:.1f} deg inboard, {m['hs_cv_out_max']:.1f} deg outboard"
              + (f"; tightest gap to a link {m['hs_clearance_margin']:+.1f} mm beyond what the tubes need" if "hs_clearance_margin" in m else ""))

    if ev.get("joints"):
        from ..joints import best_text
        J = ev["joints"]
        front = cfg["axle"] == "front"
        print(f"\nRod ends and bearings: misalignment over {J['n_poses']} positions (travel" + (" x rack)" if front else ")"))
        table(["joint", "type", "at ride", "worst", "at travel" + (" / rack" if front else ""), "limit", "margin", "", "better bolt"],
              [[r["label"], "bearing" if r["kind"] == "bearing" else "rod end", f"{r['ride']:.1f}", f"{r['worst']:.1f}",
                f"{r['at'][0]:+.0f}" + (f" / {r['at'][1]:+.0f}" if front else ""), f"{r['allow']:.1f}", f"{r['margin']:+.1f}",
                "OK" if r["margin"] >= 0 else "BINDS", best_text(r)] for r in J["rows"]])

    print("\nTarget checks")
    table(["target", "value", "range", "status"], [list(c[1:]) for c in all_checks(cfg, ev)])


def print_ride(cfg, ev):
    m, rd = ev["metrics"], ev["ride"]
    sc = cfg["spring"]
    kind = "direct-acting damper" if ev["spring"].direct else "rocker"
    print(f"\nSpring and damper ({sc['rod_on']}-arm rod, {kind}; spring {sc['spring_rate']:g} N/mm, "
          f"tire {sc['tire_rate']:g} N/mm, sprung corner {rd['_m_sprung']:.1f} kg)")
    keys = ["motion_ratio", "mr_progression", "wheel_rate", "wheel_rate_preload", "wheel_rate_bump", "bumpstop_travel", "ride_rate", "ride_freq",
            "static_spring_force", "spring_for_target", "damper_used", "damper_margin", "damper_static_pos", "damper_topout",
            "damper_bottomout", "rod_angle", "rocker_rot", "trans_min",
            "arb_twist", "arb_wheel_rate", "arb_roll", "arb_progression", "arb_tau", "arb_fos"]
    table(["metric", "value", "unit"], [mrow(m, k) for k in keys if k in m])
    lo, mid, hi = rd["_damper_len_range"]
    e2e = sc.get("damper_eye_to_eye")
    print(f"  damper length: {hi:.1f} (full droop) / {mid:.1f} (ride height) / {lo:.1f} mm (full bump)"
          + (f"; damper is {e2e:g} extended, {e2e - sc['damper_stroke']:g} closed" if e2e and sc.get("damper_stroke")
             else " - add damper_eye_to_eye to check top-out/bottom-out"))
    if "_arm_rod" in rd:
        print(f"  rocker arms: rod side {rd['_arm_rod']:.1f} mm, damper side {rd['_arm_damper']:.1f} mm "
              f"(ratio {rd['_arm_damper'] / rd['_arm_rod']:.2f}); transmission angles over travel: rod "
              f"{rd['_trans_rod'][0]:.0f}-{rd['_trans_rod'][1]:.0f} deg, damper "
              f"{rd['_trans_damper'][0]:.0f}-{rd['_trans_damper'][1]:.0f} deg (90 = best)")
    if sc.get("target_freq_hz") and "spring_for_target" in m:
        print(f"  -> for {sc['target_freq_hz']:g} Hz use about {m['spring_for_target']:.0f} N/mm "
              f"({m['spring_for_target'] * 5.71:.0f} lbf/in) at this motion ratio.")
    if rd.get("_wheel_travel_per_stroke"):
        print(f"  damper stroke {sc['damper_stroke']:g} mm allows about {rd['_wheel_travel_per_stroke']:.0f} mm "
              "of total wheel travel at this motion ratio.")
    print(f"  wheel-hop frequency ~{rd['hop_freq']:.1f} Hz (unsprung mass on spring + tire).")
    if "aero_sag" in rd:
        aero = cfg["vehicle"].get("aero_front" if cfg["axle"] == "front" else "aero_rear")
        print(f"  under {aero:g} N of downforce on this axle: the corner sinks {rd['aero_sag']:.1f} mm "
              f"({rd['_aero_travel']:.1f} mm of wheel travel + tire), ride frequency there {rd['ride_freq_aero']:.2f} Hz.")
    print(f"\nDamping (critical damping at the wheel: body {rd['c_crit']:.0f} N s/m, wheel hop {rd['c_crit_hop']:.0f} N s/m)")
    zrows = [[lab, f"{rd[k]:.2f}"] for k, lab in (("zeta_bump_low", "bump, low-speed"), ("zeta_rebound_low", "rebound, low-speed"),
             ("zeta_bump_high", "bump, high-speed"), ("zeta_rebound_high", "rebound, high-speed"), ("zeta_hop", "wheel hop (bump high-speed)")) if k in rd]
    if zrows:
        table(["damping ratio", "value"], zrows)
    else:
        print("  add damper_bump_low / _high and damper_rebound_low / _high (N per m/s at the shaft) to get damping ratios.")
    zl, zh = sc.get("target_zeta_low") or 0.7, sc.get("target_zeta_high") or 0.35
    print(f"  -> damper rates for damping ratio {zl:g} (low-speed, body control) and {zh:g} (high-speed, bumps): "
          f"about {rd['damper_c_low_target']:.0f} and {rd['damper_c_high_target']:.0f} N s/m at the shaft.")


def write_csv(prefix, ev):
    keys = ["dz", "camber", "toe", "caster", "kpi", "scrub", "trail", "roll_center",
            "roll_center_chassis", "fvsa", "cp_x", "cp_y", "cp_z", "antidive", "antisquat", "antilift",
            "motion_ratio", "damper_len", "rocker_deg"]
    keys = [k for k in keys if k in ev["rows"][0]]
    files = []
    with open(f"{prefix}_heave.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(keys)
        for r in ev["rows"]:
            w.writerow([r[k] for k in keys])
    files.append(f"{prefix}_heave.csv")
    for name, rows in (("roll", ev.get("roll")), ("steer", ev.get("steer"))):
        if rows:
            with open(f"{prefix}_{name}.csv", "w", newline="") as f:
                w = csv.writer(f)
                k2 = list(rows[0].keys())
                w.writerow(k2)
                for r in rows:
                    w.writerow([r[k] for k in k2])
            files.append(f"{prefix}_{name}.csv")
    print("wrote " + ", ".join(files))


# --------------------------------------------------------------------------- #
#  Loads and whole-car output
# --------------------------------------------------------------------------- #
def grip_asked(L):
    """The driving case asking the most grip, |(Fx, Fy)| / Fz (impacts left out): (case, ratio) or None."""
    best = None
    for n, f in (L.get("tire") or {}).items():
        if any(w in n for w in ("pothole", "kerb", "bump")) or not f[2] > 1e-9:
            continue
        r = math.hypot(f[0], f[1]) / f[2]
        if best is None or r > best[1]:
            best = (n, r)
    return best


def print_loads(cfg, ev, L):
    s = ev["susp"]
    veh, info, mem = cfg["vehicle"], L["info"], cfg["members"]
    print(f"\n=== Loads: {cfg['name']} ({cfg['axle']} axle) ===")
    print("One config = both corners of this axle (the car is symmetric). The solved corner is the outer wheel in a\n"
          "left turn and the inner wheel in a right turn, so both are checked.")
    print("\nHow the wheel loads are built (quasi-static, rigid car):")
    print(f"  car weight W = {veh['mass']:g} kg x 9.81 = {info['W']:.0f} N; this axle carries "
          f"{info['share'] * 100:.0f} % -> static wheel load {info['Fz0']:.0f} N")
    print(f"  longitudinal transfer per wheel per g = W x CG height / wheelbase / 2 = {info['W']:.0f} x "
          f"{info['h']:g} / {info['WB']:g} / 2 = {info['long_per_g']:.0f} N")
    src = "loads.lltd_front" if cfg["loads"].get("lltd_front") else ("the car's roll balance" if info.get("lltd_from_car") else "front weight share")
    print(f"  lateral transfer per wheel per g = W x CG height / track x this axle's share of it ({info['lat_share'] * 100:.0f} %, "
          f"front LLTD {info['lltd'] * 100:.0f} % from {src}) = {info['lat_per_g']:.0f} N")
    print("  tire side force = g level x that wheel's vertical load; "
          + (f"brake force = g x W x brake share ({info['brake_share'] * 100:.0f} % on this axle) / 2"
             if info["brake_split"] == "bias" else "brake force = g level x that wheel's vertical load (loads.brake_split = grip)")
          + ("; brake force at the wheel center (inboard brakes)" if veh["brakes"] == "inboard" else ""))
    if L.get("deflect"):
        print(f"  bump and pothole are also solved where the wheel actually is under that load: raised by (load - static) / "
              f"wheel rate ({info['wheel_rate']:.1f} N/mm), capped at full bump")
    names = list(L["results"])
    print("\nTire force on the wheel (N)")
    table(["case", "Fx", "Fy", "Fz", "Fz built from", "description"],
          [[n, f"{L['tire'][n][0]:.0f}", f"{L['tire'][n][1]:.0f}", f"{L['tire'][n][2]:.0f}", L["fz_parts"][n],
            L["desc"][n]] for n in names], left=1)
    for n, z in info.get("skipped") or []:
        print(f"  NOT SOLVED where the wheel would be: {n} at +{z:.1f} mm. The suspension can't reach that travel (it locks up\n"
              "  or a link runs out first), so only the ride-height case is checked. Look at the bump end of the sweep.")
    g = grip_asked(L)
    mu = float(veh.get("tire_mu") or 1.5)
    if g and g[1] > mu + 0.05:
        print(f"  The {g[0]} case asks the tire for {g[1]:.2f} x its load sideways and fore-aft combined, more than its grip\n"
              f"  (mu {mu:.2f}). On purpose: design loads with margin, not a corner the car can take.")
    print("\nMember axial forces (N, + = tension, - = compression)")
    rows = []
    for k in MEMBERS:
        rows.append([member_label(k, s)] + [f"{L['results'][n][k]:+.0f}" for n in names])
    rows.append(["Damper/spring"] + [f"{L['results'][n]['damper']:+.0f}" for n in names])
    if not ev["spring"].direct:
        rows.append(["Rocker pivot (resultant)"] + [f"{L['results'][n]['rocker_pivot']:.0f}" for n in names])
    if ev["spring"].on != "upright":
        rows.append([f"{ev['spring'].on.capitalize()}-arm bending load"] +
                    [f"{L['results'][n]['bending']:.0f}" for n in names])
    table(["member"] + names, rows)
    print(f"\nStrength check - material: {mem.get('material', 'steel')}; E = {mem['E']:g} MPa, "
          f"yield = {mem['yield']:g} MPa; required FOS = {mem['sf_target']:g}")
    print("  Buckling (compression only): critical load Pcr = pi^2 E I / L^2 (pin-ended), FOS = Pcr / worst compression")
    print("  Yield (tension or compression): yield force = yield stress x tube area, FOS = yield force / worst |force|")
    trows = []
    for r in L["checks"]:
        fos = min(r["sf_buckle"], r["sf_yield"])
        ok = fos >= mem["sf_target"]
        trows.append([member_label(r["member"], s), f"{r['od']:g} x {r['wall']:g}", f"{r['length']:.0f}",
                      f"{r['compression']:.0f}" + (f" ({r['c_case']})" if r["compression"] else ""),
                      f"{r['Pcr']:.0f}", f_num(r["sf_buckle"], 1),
                      f"{r['peak']:.0f} ({r['p_case']})", f"{r['Py']:.0f}", f_num(r["sf_yield"], 1),
                      "OK" if ok else "BELOW FOS"])
    table(["member", "tube OD x wall", "length", "worst compression N", "buckling load Pcr N", "FOS buckle",
           "worst |force| N", "yield force N", "FOS yield", ""], trows)
    pr = L.get("parts") or []
    if pr:
        cap = pr[0]["bolt_capacity"]
        print(f"\nRod ends and bolts ({mem.get('bolt_dia')} mm grade {mem.get('bolt_grade')} bolt, {mem.get('bolt_shear_planes')} shear plane(s)"
              + (f": shear capacity {cap:.0f} N" if cap else ": set bolt_dia / bolt_grade to check") + ")")
        table(["member", "worst |force| N", "bolt FOS", "rod-end FOS"],
              [[member_label(r["member"], s), f"{r['peak']:.0f} ({r['p_case']})", f_num(r["sf_bolt"], 1) if r["sf_bolt"] is not None else "-",
                f_num(r["sf_rod_end"], 1) if r["sf_rod_end"] is not None else "enter rod_end_rating"] for r in pr])
    b = L.get("bending_check")
    if b:
        ok = b["sf"] >= mem["sf_target"]
        print(f"\nPushrod mount bending: the {member_label(b['leg'], s).lower()} as a beam pinned at both ends ({b['length']:.0f} mm long), "
              f"mount {b['a']:.0f} mm from the pivot and {b['offset']:.0f} mm off the leg's centerline.")
        g = b.get("gusset")
        print("  reinforcement: " + ("bare tube" if not g else "bracket into the ball-joint node (check the bracket itself in CAD/FEA: "
                                     "loads --fea)" if g["type"] == "to_node" else
                                     f"gusset {g['thickness']:g} x {g['height']:g} mm, {g['length_in']:g} + {g['length_out']:g} mm long"))
        print(f"  worst case {b['case']}: {b['P_perp']:.0f} N across the leg, {b['moment'] / 1000:.1f} N m, stress {b['stress']:.0f} MPa "
              f"(bending + axial, {b['where']}, {b['x']:.0f} mm from the pivot) -> FOS {b['sf']:.2f} {'OK' if ok else 'BELOW FOS'}")
        if not ok:
            print("  Overloaded here: describe a gusset (members.gusset) or a bracket into the ball-joint node, move the mount closer\n"
                  "  to the ball joint, or use a stiffer leg. Check a bracket with FEA: loads design.json --fea loads.csv.")
        if b["offset"] > 5:
            print(f"  The mount is {b['offset']:.0f} mm off the leg's centerline: the bracket also twists the leg (not modeled).")
    rc = L.get("rocker_check")
    if rc:
        rk = rc["rocker"]
        print(f"\nRocker: {rk['plates']} plate(s) {rk['thickness']:g} mm thick, yield {rk['yield']:g} MPa; pivot bore {rk['pivot_bore']:g} mm "
              f"with {rk['pivot_edge']:g} mm to the hub's edge, {rk['pin_dia']:g} mm pins {rk['edge']:g} mm from the edge, arms "
              f"{rk['width']:g} mm deep (members.rocker)")
        print("  holes: bearing F/(n t d) vs yield, tear-out F/(2 n t (e - d/2)) vs 0.577 yield; arms: built in at the hub's edge,\n"
              "  6 M/(n t w^2) + axial/(n t w) vs yield. In-plane forces; the worst case for each.")
        hn = {"pushrod": "Pushrod end", "damper": "Damper end", "pivot": "Pivot"}
        rows = [[f"{hn[k]} hole", f"{v['force']:.0f} ({v['case']})", f"bearing {v['stress']['bearing']:.0f}, tear-out {v['stress']['tearout']:.0f}",
                 f_num(v["sf"], 2) + f" ({'bearing' if v['governs'] == 'bearing' else 'tear-out'})", "OK" if v["sf"] >= mem["sf_target"] else "BELOW FOS"]
                for k, v in rc["holes"].items()]
        rows += [[f"{hn[k]} arm, {v['length']:.0f} mm", f"{v['across']:.0f} across ({v['case']})",
                  f"{v['moment'] / 1000:.1f} N m -> {v['stress']:.0f}", f_num(v["sf"], 2), "OK" if v["sf"] >= mem["sf_target"] else "BELOW FOS"]
                 for k, v in rc["arms"].items()]
        table(["where", "force N", "stress MPa", "FOS", ""], rows)
        if rc["out_of_plane"] > 0.1:
            print(f"  {rc['out_of_plane'] * 100:.0f} % of a pin force runs along the rocker's axis ({rc['oop_case']}): that bends the plates "
                  "sideways, which this check leaves out. Check the rocker in FEA (loads --fea).")
        if rc["sf"] < mem["sf_target"]:
            print("  Below the target: thicker plates or a stronger alloy (7075-T6), deeper arms, more material around the holes.")
    elif ev.get("spring") is not None and not ev["spring"].direct:
        print("\nRocker: not checked. Describe its plates (members.rocker: thickness, pivot_bore, pivot_edge, edge, width) to check\n"
              "  the holes and the arms, or check it in FEA with the part loads (loads --fea).")

    c = L.get("compliance")
    if c:
        print(f"\nCompliance: toe and camber change from the links stretching (estimated stiffness: rod ends "
              f"{mem.get('rod_end_k') or 0:.0f} N/mm each, chassis mounts {mem.get('mount_k') or 0:.0f} N/mm, plus the tube).")
        print("  Link stiffness N/mm: " + ", ".join(f"{member_label(k, s).lower()} {v:.0f}" for k, v in c["stiffness"].items()))
        table(["case", "camber change deg", "toe-in change deg", "contact patch moves Y mm", "largest link stretch mm"],
              [[x["case"] + ("" if x["driving"] else " *"), f"{x['camber']:+.3f}", f"{x['toe']:+.3f}", f"{x['cp_y']:+.2f}",
                f"{x['worst_stretch']:.2f}"] for x in c["cases"]])
        for key, lim, ok, w in (("toe", c["toe_limit"], c["toe_ok"], c["worst_toe"]), ("camber", c["camber_limit"], c["camber_ok"], c["worst_camber"])):
            if lim is not None:
                print(f"  Worst {key} change in a driving case: {w[key]:+.3f} deg ({w['case']}), limit {lim:g} -> {'OK' if ok else 'TOO SOFT'}")
        print("  * bump and impact cases: shown, not held to the limits. Toe-in + / camber - = top in. The stiffnesses are\n"
              "    estimates: rod_end_k and mount_k under 'members' (stiffer tabs and rod ends help most).")
    D = L.get("durability")
    if D:
        tb = D["tab"]
        print(f"\nPickup tabs: {tb['count']:g} x {tb['thickness']:g} mm thick, {tb['width']:g} mm wide, hole {D['bolt']:g} mm, "
              f"{tb['edge']:g} mm from the hole to the tab's end; weld {tb['weld_leg']:g} mm leg x {tb['weld_length']:g} mm per tab; "
              f"yield {D['tab_yield']:g} MPa (members.tab)")
        print("  bearing F/(n t d), tear-out F/(2 n t (e - d/2)) vs 0.577 yield, net section F/(n t (W - d)), weld throat F/(n L 0.707 leg) vs 0.577 yield")
        names_ = {"damper": "Damper chassis end", "rocker_pivot": "Rocker pivot"}
        table(["link end", "worst |force| N", "FOS bearing", "FOS tear-out", "FOS net", "FOS weld", ""],
              [[names_.get(r["member"]) or member_label(r["member"], s), f"{r['force']:.0f} ({r['case']})"]
               + [f_num(r["fos"][k], 1) for k in ("bearing", "tearout", "net", "weld")]
               + ["OK" if r["sf"] >= mem["sf_target"] else "BELOW FOS"] for r in D["tabs"]])
        en = D["endurance"]
        print(f"\nFatigue screen: each driving case repeated {D['cycles']:,.0f} times and the bump {D['bump_cycles']:,.0f} times, from the car at rest,"
              f"\n  and the swings between opposite cases (left / right turns, braking / accelerating)"
              f"\n  (loads.fatigue_cycles / fatigue_bump_cycles). Tubes: Goodman, S_ut {en['sut']:g} MPa, endurance limit {en['se_axial']:.0f} MPa axial"
              f"\n  (k_a {en['ka']:.2f}, k_c {en['kc']:g}); welds: IIW, tube ends FAT {D['weld_fat_tube']:g}, tab throats FAT {D['weld_fat_tab']:g} MPa."
              f" Required margin {D['fatigue_sf']:g}.")

        def item(r):
            it = r["item"]
            if it.startswith("tab:"):
                k = it[4:]
                return f"tab weld, {(names_.get(k) or member_label(k, s)).lower()}"
            if it.startswith("leg:"):
                return f"{member_label(it[4:], s)} with the pushrod mount (bending)"
            if it.startswith("gusset:"):
                return f"{member_label(it[7:], s)}, weld where the gusset ends"
            return f"{member_label(it, s)}, {'tube' if r['kind'] == 'tube' else 'end weld'}"
        table(["part", "worst cycle", "applied MPa", "mean MPa", "allowed MPa", "margin", "life, cycles", ""],
              [[item(r), f"{r['case']} x {r['cycles']:,.0f}", f"{r['s_a'] * (2 if r['kind'] == 'weld' else 1):.1f}",
                f"{r['s_m']:.1f}" if r["kind"] == "tube" else "-", f"{r['allow']:.0f}", f_num(r["n"], 2),
                "no limit" if r["life"] == float("inf") else f"{r['life']:.2g}", "OK" if r["ok"] else "LOOK AT THIS"]
               for r in sorted(D["fatigue"], key=lambda q: q["n"])])
        print("  Applied: stress amplitude for tubes (with the mean, Goodman), stress range for welds. A screen at the design g\n"
              "  levels, not a life prediction: logged loads from the car make it exact.")
    print("\nNot checked here: inserts and rod-end threads. Change g levels under 'loads' (pothole_g and kerb_g are the impact\n"
          "cases), tubes, material, bolts, tabs, weld classes and rod-end rating under 'members'.")


CAR_LABELS = {k: (d["label"], d["unit"], d["decimals"]) for k, d in METRICS_FILE["car"].items()}


def print_car(cfg_f, cfg_r, out):
    print(f"\n=== Car balance: {cfg_f['name']} + {cfg_r['name']} ===")
    print(f"sprung mass {out['ms']:.0f} kg, sprung CG {out['hs']:.0f} mm, roll axis at the CG {out['z_ra']:.0f} mm, "
          f"roll moment arm {out['arm']:.0f} mm")
    rows = [["Ride frequency", f"{out['freq_f']:.2f}", f"{out['freq_r']:.2f}", "Hz"],
            ["Roll center height", f"{out['rc_f']:.0f}", f"{out['rc_r']:.0f}", "mm"],
            ["Roll stiffness: springs", f"{out['Ksf']:.0f}", f"{out['Ksr']:.0f}", "Nm/deg"],
            [f"  anti-roll bar ({out['arb_src_f']} / {out['arb_src_r']})", f"{out['arb_in_f']:.0f}", f"{out['arb_in_r']:.0f}", "Nm/deg"],
            ["  axle total, with tires", f"{out['Kf']:.0f}", f"{out['Kr']:.0f}", "Nm/deg"],
            ["Load transfer per wheel per g", f"{out['dFz_f']:.0f}", f"{out['dFz_r']:.0f}", "N/g"],
            ["  of which geometric (through links)", f"{out['geo_f']:.0f}", f"{out['geo_r']:.0f}", "N/g"]]
    table(["", "front", "rear", "unit"], rows)
    print(f"\nrear/front frequency ratio {out['freq_r'] / out['freq_f']:.2f} (many teams run the rear 5-20 % higher)")
    print(f"roll gradient: {out['grad']:.2f} deg/g body to ground; on the springs {out['roll_susp_f']:.2f} front, "
          f"{out['roll_susp_r']:.2f} rear (what damper pots see; the rest is the tires)")
    print(f"LLTD front: {out['lltd'] * 100:.1f} %  (front weight {out['wf'] * 100:.0f} %; front LLTD a few % above "
          "front weight is a common starting point for mild understeer)")
    if "ay_lim_f" in out:
        b = out["limit_balance"]
        print(f"tires at the limit (mu {out['tire_mu']:g}, load sensitivity {out['tire_load_sens']:g}): front axle "
              f"{out['ay_lim_f']:.2f} g, rear {out['ay_lim_r']:.2f} g (load transfer costs {out['grip_loss_f']:.1f} / "
              f"{out['grip_loss_r']:.1f} % of the grip) -> "
              + ("neutral" if abs(b) < 0.005 else ("the front lets go first (understeer)" if b > 0 else "the rear lets go first (oversteer)"))
              + f"; both axles let go together at {out['lltd_neutral'] * 100:.1f} % front LLTD")
    print("\nCar targets:")
    table(["target", "value", "range", "status"], [[CAR_LABELS[c["key"]][0], f"{c['value']:.{CAR_LABELS[c['key']][2]}f} {CAR_LABELS[c['key']][1]}",
          f"{c['lo']} to {c['hi']}", c["status"]] for c in out["checks"]])
    print(f"\nTo reach {out['target_grad']:g} deg/g with LLTD {out['target_lltd'] * 100:.0f} %:")
    print(f"  total roll stiffness needed {out['K_need']:.0f} Nm/deg; front share {out['lam_c'] * 100:.0f} %"
          + ("" if abs(out['lam'] - out['lam_c']) < 1e-9 else " (LLTD target out of reach with roll stiffness alone)"))
    for nm, v in (("front", out["arb_f"]), ("rear", out["arb_r"])):
        if v == float("inf"):
            print(f"  {nm}: not reachable, the tires alone are softer than that")
        elif v > 0:
            print(f"  {nm} anti-roll bar: about {v:.0f} Nm/deg at the wheels")
        else:
            print(f"  {nm} anti-roll bar: none needed (springs already give {-v:.0f} Nm/deg more than required)")
    if out["arb_f"] <= 0 and out["arb_r"] <= 0:
        print(f"  -> the springs alone already make the car stiffer in roll than {out['target_grad']:g} deg/g.")
    if "lltd_fix" in out:
        ax_, k_ = out["lltd_fix"]
        other = "rear" if ax_ == "front" else "front"
        print(f"  balance only: to reach the LLTD target keep the {other} as is and change the {ax_} bar by about "
              f"{k_:+.0f} Nm/deg, or change the {other} springs.")
    print("\nAssumes a rigid chassis, steady state, roll centers at ride height. Set targets with --grad and --lltd.")

