"""Text tables, plots (incl. geometry views), CSV and the shareable HTML report."""
from __future__ import annotations

import csv
import math

import numpy as np

from .config import HP_ORDER, METRIC_HELP, METRICS, validate
from .kinematics import check_targets, rack_for_angle
from .loads import MEMBERS, member_label


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
    T = cfg["sweep"]["travel"]
    print(f"\nOver +/-{T:.0f} mm of heave")
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
        print(f"\nPackaging (heave +/-{T:.0f}"
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
              f"({nm} at heave {hz:+.0f}); rim radius {p['rim_radius']:.1f} mm -> margin {p['rim_margin']:.1f} mm "
              "(radial check only)")

    print("\nTarget checks")
    table(["target", "value", "range", "status"], [list(c[1:]) for c in all_checks(cfg, ev)])


def print_ride(cfg, ev):
    m, rd = ev["metrics"], ev["ride"]
    sc = cfg["spring"]
    kind = "direct-acting damper" if ev["spring"].direct else "rocker"
    print(f"\nSpring and damper ({sc['rod_on']}-arm rod, {kind}; spring {sc['spring_rate']:g} N/mm, "
          f"tire {sc['tire_rate']:g} N/mm, sprung corner {rd['_m_sprung']:.1f} kg)")
    keys = ["motion_ratio", "mr_progression", "wheel_rate", "ride_rate", "ride_freq", "static_spring_force",
            "spring_for_target", "damper_used", "damper_margin", "damper_static_pos", "damper_topout",
            "damper_bottomout", "rod_angle", "rocker_rot", "trans_min"]
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
#  Plots
# --------------------------------------------------------------------------- #
def _mpl():
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        return plt
    except ImportError:
        print("matplotlib not installed - skipping plot (pip install matplotlib)")
        return None


def draw_front(ax, ev, color="C0", full=True):
    """Front view (Y-Z) of the right corner, with the roll-center construction."""
    s, h = ev["susp"], ev["susp"].h
    o = ev["rows"][len(ev["rows"]) // 2]
    p = o["_pts"]
    def L(a, b, **k):
        return ax.plot([a[1], b[1]], [a[2], b[2]], **k)
    for piv, bj in (("uif", "ub"), ("uir", "ub"), ("lif", "lb"), ("lir", "lb")):
        L(h[piv], p[bj], color=color, lw=2)
    L(p["ub"], p["lb"], color=color, lw=3)
    L(h["tri"], p["tro"], color=color, lw=1.5, ls="--")
    # tire outline
    a = p["a"]
    up = np.array([0, 0, 1.0]) - a[2] * a
    up /= np.linalg.norm(up)
    w = s.cfg["wheel"]["tire_width"] / 2
    c = p["c"]
    corners = [c + sa * w * a + sb * s.R * up for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1), (-1, -1))]
    ax.plot([q[1] for q in corners], [q[2] for q in corners], color=color, lw=1, alpha=0.6)
    sp = ev.get("spring")
    if sp is not None:
        st = sp.state(o["_x"])
        L(st["rod_out"], st["rod_in"], color="C3" if full else color, lw=1.5)
        if not sp.direct:
            ax.plot([st["rod_in"][1], sp.c[1], st["damper_out"][1]], [st["rod_in"][2], sp.c[2], st["damper_out"][2]],
                    color="C3" if full else color, lw=2.5)
        L(st["damper_out"], sp.dch, color="C2" if full else color, lw=4, alpha=0.7)
    # roll-center construction (mirror for the left side)
    cpy, cpz, dy, dz = o["fv_line"]
    rc = o["roll_center"]
    if not math.isnan(rc):
        ax.plot([cpy, 0, -cpy], [cpz, rc + cpz, cpz], color=color, lw=0.8, ls=":")
        ax.plot([0], [rc + cpz], "o", color=color, ms=5)
    # line from the contact patch toward the front-view instant center
    ax.plot([cpy, cpy + 3 * dy], [cpz, cpz + 3 * dz], color=color, lw=0.6, ls="--", alpha=0.6)
    if full:
        ax.axhline(0, color="k", lw=0.8)
        ax.axvline(0, color="k", lw=0.5, ls="--")
        zmax = max(q[2] for q in corners) + 60
        ax.set_xlim(-80, max(q[1] for q in corners) + 60)
        ax.set_ylim(-40, zmax)
    ax.set_aspect("equal", adjustable="box")
    ax.set_title("Front view (Y-Z): red pushrod/rocker, green damper,\ndotted = roll-center construction", fontsize=10)


def draw_side(ax, ev, color="C0", full=True):
    s, h = ev["susp"], ev["susp"].h
    o = ev["rows"][len(ev["rows"]) // 2]
    p = o["_pts"]
    def L(a, b, **k):
        return ax.plot([a[0], b[0]], [a[2], b[2]], **k)
    for piv, bj in (("uif", "ub"), ("uir", "ub"), ("lif", "lb"), ("lir", "lb")):
        L(h[piv], p[bj], color=color, lw=2)
    L(p["ub"], p["lb"], color=color, lw=3)
    L(h["tri"], p["tro"], color=color, lw=1.5, ls="--")
    th = np.linspace(0, 2 * np.pi, 80)
    ax.plot(p["c"][0] + s.R * np.cos(th), p["c"][2] + s.R * np.sin(th), color=color, lw=1, alpha=0.5)
    if o.get("sv_ic"):
        icx, icz = o["sv_ic"]
        ax.plot([p["cp"][0], icx], [p["cp"][2], icz], color=color, lw=0.8, ls=":")
        ax.plot([icx], [icz], "x", color=color)
    if full:
        ax.axhline(0, color="k", lw=0.8)
        xs = [h[k][0] for k in ("uif", "uir", "lif", "lir", "tri")] + [p["c"][0] - s.R, p["c"][0] + s.R]
        ax.set_xlim(min(xs) - 80, max(xs) + 80)
        ax.set_ylim(-40, p["c"][2] + s.R + 60)
    ax.set_aspect("equal", adjustable="box")
    ax.set_title("Side view (X-Z, X forward), dotted = line to side-view IC", fontsize=10)


def draw_top(ax, ev, color="C0"):
    h = ev["susp"].h
    p = ev["rows"][len(ev["rows"]) // 2]["_pts"]
    def L(a, b, **k):
        return ax.plot([a[0], b[0]], [a[1], b[1]], **k)
    for piv, bj in (("uif", "ub"), ("uir", "ub")):
        L(h[piv], p[bj], color=color, lw=2, alpha=0.5)
    for piv, bj in (("lif", "lb"), ("lir", "lb")):
        L(h[piv], p[bj], color=color, lw=2)
    L(h["tri"], p["tro"], color=color, lw=1.5, ls="--")
    ax.plot([h["cp"][0]], [h["cp"][1]], "s", color=color)
    ax.set_aspect("equal", adjustable="datalim")
    ax.set_xlabel("X (mm, forward)")
    ax.set_title("Top view (X-Y), faded = upper arm", fontsize=10)


def make_plot(evs, labels, path, quiet=False):
    plt = _mpl()
    if plt is None:
        return False
    axle = evs[0]["susp"].axle
    panels = [("camber", "Camber (deg)"), ("toe_rel", "Toe change (deg, + = in)"), ("caster", "Caster (deg)"),
              ("kpi", "KPI (deg)"), ("scrub", "Scrub radius (mm)"), ("trail", "Mechanical trail (mm)"),
              ("roll_center", "Roll center above ground (mm)"),
              ("anti", "Anti-dive (%)" if axle == "front" else "Anti-squat / anti-lift (%)"),
              ("track", "Contact-patch lateral shift (mm)")]
    fig, axs = plt.subplots(4, 4, figsize=(19, 17))
    axs = axs.ravel()
    for j, (key, title) in enumerate(panels):
        ax = axs[j]
        for ev, lab in zip(evs, labels):
            z = [r["dz"] for r in ev["rows"]]
            r0 = min(ev["rows"], key=lambda r: abs(r["dz"]))
            if key == "toe_rel":
                ax.plot(z, [r["toe"] - r0["toe"] for r in ev["rows"]], label=lab)
            elif key == "anti":
                for k2, ls in (("antidive", "-"), ("antisquat", "-"), ("antilift", "--")):
                    if k2 in ev["rows"][0]:
                        ax.plot(z, [r[k2] for r in ev["rows"]], ls, label=f"{lab} {k2}")
            elif key == "track":
                ax.plot(z, [r["cp_y"] - r0["cp_y"] for r in ev["rows"]], label=lab)
            else:
                ax.plot(z, [r[key] for r in ev["rows"]], label=lab)
        ax.set_title(title, fontsize=10)
        ax.set_xlabel("wheel travel (mm, + = bump)")
        ax.grid(alpha=0.3)
        ax.axvline(0, color="k", lw=0.6)
        if j == 0:
            ax.legend(fontsize=8)
    # roll
    ax = axs[9]
    for ev, lab in zip(evs, labels):
        R = ev["roll"]
        ax.plot([r["roll"] for r in R], [r["camber_outer"] for r in R], label=f"{lab} outer")
        ax.plot([r["roll"] for r in R], [r["camber_inner"] for r in R], "--", label=f"{lab} inner")
    ax.set_title("Camber to ground vs body roll (deg)", fontsize=10)
    ax.set_xlabel("roll (deg, + = right wheel outer/in bump)")
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    ax = axs[10]
    for ev, lab in zip(evs, labels):
        R = ev["roll"]
        ax.plot([r["roll"] for r in R], [r["rc_height"] for r in R], label=f"{lab} height")
        ax.plot([r["roll"] for r in R], [r["rc_lateral"] for r in R], "--", label=f"{lab} lateral")
    ax.set_title("Kinematic roll center in roll (mm)", fontsize=10)
    ax.set_xlabel("roll (deg)")
    ax.grid(alpha=0.3)
    ax.legend(fontsize=8)
    ax = axs[11]
    if any(ev.get("ride") for ev in evs):
        for ev, lab in zip(evs, labels):
            if ev.get("ride"):
                ax.plot([r["dz"] for r in ev["rows"]], [r["motion_ratio"] for r in ev["rows"]], label=lab)
        ax.set_title("Motion ratio (damper/wheel)", fontsize=10)
        ax.set_xlabel("wheel travel (mm)")
        ax.grid(alpha=0.3)
    else:
        ax.text(0.5, 0.5, "add a 'spring' block for\nmotion ratio and ride rates", ha="center", va="center")
        ax.axis("off")
    # steering or top view
    if evs[0].get("steer"):
        ax = axs[12]
        for ev, lab in zip(evs, labels):
            st = ev["steer"]
            ax.plot([r["rack"] for r in st], [r["inner"] for r in st], label=f"{lab} inner")
            ax.plot([r["rack"] for r in st], [r["outer"] for r in st], "--", label=f"{lab} outer")
        ax.set_title("Steer angle vs rack (deg)", fontsize=10)
        ax.set_xlabel("rack (mm)")
        ax.grid(alpha=0.3)
        ax.legend(fontsize=8)
        ax = axs[13]
        for ev, lab in zip(evs, labels):
            st = [r for r in ev["steer"] if not math.isnan(r["ackermann"])]
            ax.plot([r["outer"] for r in st], [r["ackermann"] for r in st], label=lab)
        ax.axhspan(0, 30, color="g", alpha=0.1)
        ax.set_title("Ackermann % vs outer wheel angle", fontsize=10)
        ax.set_xlabel("outer wheel angle (deg)")
        ax.grid(alpha=0.3)
    else:
        for i, ev in enumerate(evs):
            draw_top(axs[12], ev, f"C{i}")
        axs[13].axis("off")
    for i, ev in enumerate(evs):
        draw_front(axs[14], ev, f"C{i}", full=(i == 0))
        draw_side(axs[15], ev, f"C{i}", full=(i == 0))
    fig.suptitle(" vs ".join(labels), fontsize=12)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)
    if not quiet:
        print(f"wrote {path}")
    return True


def make_rocker_plot(ev, path, quiet=False):
    """Rocker plane view at full droop / ride height / full bump, plus motion ratio and transmission angles."""
    plt = _mpl()
    sp = ev.get("spring")
    if plt is None or sp is None:
        if sp is None and not quiet:
            print("no 'spring' block - skipping rocker plot")
        return False
    rows = ev["rows"]
    zs = [r["dz"] for r in rows]
    i0 = len(rows) // 2
    picks = [(0, "full droop", ":"), (i0, "ride height", "-"), (len(rows) - 1, "full bump", "--")]
    fig, axs = plt.subplots(1, 3, figsize=(17, 5.6))
    ax = axs[0]
    if sp.direct:
        k = np.array([1.0, 0, 0])
        c = sp.dch
    else:
        k, c = sp.k, sp.c
    v = np.array([0, 0, 1.0]) - k[2] * k               # "up" in the rocker plane
    if np.linalg.norm(v) < 1e-6:
        v = np.array([0, 1.0, 0]) - k[1] * k
    v = v / np.linalg.norm(v)
    u = np.cross(v, k)                                   # "outboard" for a fore-aft pivot axis
    if u[1] < 0:
        u, k = -u, -k
    def P(q):
        return ((q - c) @ u, (q - c) @ v)
    for i, lab, ls in picks:
        st = sp.state(rows[i]["_x"], math.radians(rows[i].get("rocker_deg", 0.0)))
        ro, ri, dout = P(st["rod_out"]), P(st["rod_in"]), P(st["damper_out"])
        dch = P(sp.dch)
        ax.plot([ri[0], ro[0]], [ri[1], ro[1]], color="C3", ls=ls, lw=1.5)
        ax.plot([dout[0], dch[0]], [dout[1], dch[1]], color="C2", ls=ls, lw=4, alpha=0.6)
        if not sp.direct:
            ax.fill([0, ri[0], dout[0]], [0, ri[1], dout[1]], color="C1", alpha=0.15 if ls != "-" else 0.35)
            ax.plot([0, ri[0], dout[0], 0], [0, ri[1], dout[1], 0], color="C1", ls=ls, lw=2, label=lab)
        else:
            ax.plot([], [], color="C2", ls=ls, label=lab)
    if not sp.direct:
        ax.plot([0], [0], "ko")
    st0 = sp.state(rows[i0]["_x"])
    pts2 = [P(q) for q in (st0["rod_in"], st0["damper_out"], sp.dch)] + [(0.0, 0.0)]
    xs_, ys_ = [q[0] for q in pts2], [q[1] for q in pts2]
    pad = 50
    ax.set_xlim(min(xs_) - pad, max(xs_) + pad)
    ax.set_ylim(min(ys_) - pad, max(ys_) + pad)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("outboard (mm from pivot)")
    rd = ev["ride"]
    lo_, mid, hi_ = rd["_damper_len_range"]
    ax.set_title(f"Rocker plane (looking along the pivot axis)\nred = pushrod, green = damper, black dot = pivot\n"
                 f"damper {hi_:.0f} / {mid:.0f} / {lo_:.0f} mm at droop / ride / bump", fontsize=10)
    ax.legend(fontsize=8)
    ax.grid(alpha=0.3)
    ax = axs[1]
    ax.plot(zs, [r["motion_ratio"] for r in rows], label="motion ratio")
    ax.set_xlabel("wheel travel (mm, + = bump)")
    ax.set_ylabel("motion ratio (damper / wheel)")
    ax2 = ax.twinx()
    ax2.plot(zs, [r["damper_len"] for r in rows], color="C2", ls="--", label="damper length")
    sc = ev["susp"].cfg["spring"]
    if sc.get("damper_eye_to_eye") and sc.get("damper_stroke"):
        ax2.axhline(sc["damper_eye_to_eye"], color="C3", lw=0.8)
        ax2.axhline(sc["damper_eye_to_eye"] - sc["damper_stroke"], color="C3", lw=0.8)
        ax2.text(zs[0], sc["damper_eye_to_eye"], " fully extended", va="bottom", fontsize=8, color="C3")
        ax2.text(zs[0], sc["damper_eye_to_eye"] - sc["damper_stroke"], " fully closed", va="bottom", fontsize=8,
                 color="C3")
    ax2.set_ylabel("damper length (mm)")
    ax.set_title(f"Motion ratio {rd['motion_ratio']:.3f} at ride height, {rd['mr_progression']:+.1f} % over travel",
                 fontsize=10)
    ax.grid(alpha=0.3)
    ax = axs[2]
    if "trans_rod" in rows[0]:
        ax.plot(zs, [r["trans_rod"] for r in rows], label="pushrod to rocker arm")
        ax.plot(zs, [r["trans_damper"] for r in rows], label="damper to rocker arm")
        ax.axhspan(0, 45, color="r", alpha=0.08)
        ax.set_ylim(0, 95)
        ax.legend(fontsize=8)
    ax.set_title(f"Transmission angles (deg; 90 = best, red zone < 45)\nrocker turns {rd['rocker_rot']:.0f} deg "
                 "over the travel", fontsize=10)
    ax.set_xlabel("wheel travel (mm)")
    ax.grid(alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=110)
    plt.close(fig)
    if not quiet:
        print(f"wrote {path}")
    return True


# --------------------------------------------------------------------------- #
#  Loads and whole-car output
# --------------------------------------------------------------------------- #
def print_loads(cfg, ev, L):
    s = ev["susp"]
    veh, info, mem = cfg["vehicle"], L["info"], cfg["members"]
    print(f"\n=== Loads: {cfg['name']} ({cfg['axle']} axle) ===")
    print("One config = both corners of this axle (the car is symmetric). The solved corner is the outer wheel in a\n"
          "left turn and the inner wheel in a right turn, so both are checked.")
    print("\nHow the wheel loads are built (quasi-static, rigid car, same friction use at every tire):")
    print(f"  car weight W = {veh['mass']:g} kg x 9.81 = {info['W']:.0f} N; this axle carries "
          f"{info['share'] * 100:.0f} % -> static wheel load {info['Fz0']:.0f} N")
    print(f"  longitudinal transfer per wheel per g = W x CG height / wheelbase / 2 = {info['W']:.0f} x "
          f"{info['h']:g} / {info['WB']:g} / 2 = {info['long_per_g']:.0f} N")
    print(f"  lateral transfer per wheel per g = W x CG height / track x axle share ({info['lat_share'] * 100:.0f} %) = "
          f"{info['lat_per_g']:.0f} N")
    print("  tire side/brake force = g level x that wheel's vertical load; forces act at the contact patch"
          + (" (brake force at the wheel center: inboard brakes)" if veh["brakes"] == "inboard" else ""))
    names = list(L["results"])
    print("\nTire force on the wheel (N)")
    table(["case", "Fx", "Fy", "Fz", "Fz built from", "description"],
          [[n, f"{L['tire'][n][0]:.0f}", f"{L['tire'][n][1]:.0f}", f"{L['tire'][n][2]:.0f}", L["fz_parts"][n],
            L["desc"][n]] for n in names], left=1)
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
        print(f"  worst case {b['case']}: {b['P_perp']:.0f} N across the leg, {b['moment'] / 1000:.1f} N m, stress {b['stress']:.0f} MPa "
              f"(bending + axial) -> FOS {b['sf']:.2f} {'OK' if ok else 'BELOW FOS'}")
        if not ok:
            print("  A bare tube is overloaded here: mount the pushrod on a gusset or bracket at the ball-joint node, move it closer to\n"
                  "  the ball joint, or use a stiffer leg. This beam check is conservative if a gusset carries the load.")
        if b["offset"] > 5:
            print(f"  The mount is {b['offset']:.0f} mm off the leg's centerline: the bracket also twists the leg (not modeled).")
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
    print("\nNot checked here: tabs, welds, inserts, rod-end threads and fatigue. Change g levels under 'loads' (pothole_g and\n"
          "kerb_g are the impact cases), tubes, material, bolts and rod-end rating under 'members'.")


CAR_LABELS = {"roll_gradient": ("Roll gradient", "deg/g", 2), "lltd_vs_weight": ("Front LLTD minus front weight", "% points", 1),
              "freq_ratio": ("Ride frequency ratio, rear / front", "", 2)}


def print_car(cfg_f, cfg_r, out):
    print(f"\n=== Car balance: {cfg_f['name']} + {cfg_r['name']} ===")
    print(f"sprung mass {out['ms']:.0f} kg, sprung CG {out['hs']:.0f} mm, roll axis at the CG {out['z_ra']:.0f} mm, "
          f"roll moment arm {out['arm']:.0f} mm")
    rows = [["Ride frequency", f"{out['freq_f']:.2f}", f"{out['freq_r']:.2f}", "Hz"],
            ["Roll center height", f"{out['rc_f']:.0f}", f"{out['rc_r']:.0f}", "mm"],
            ["Roll stiffness: springs", f"{out['Ksf']:.0f}", f"{out['Ksr']:.0f}", "Nm/deg"],
            ["  anti-roll bar (input)", f"{out['arb_in_f']:.0f}", f"{out['arb_in_r']:.0f}", "Nm/deg"],
            ["  axle total, with tires", f"{out['Kf']:.0f}", f"{out['Kr']:.0f}", "Nm/deg"],
            ["Load transfer per wheel per g", f"{out['dFz_f']:.0f}", f"{out['dFz_r']:.0f}", "N/g"],
            ["  of which geometric (through links)", f"{out['geo_f']:.0f}", f"{out['geo_r']:.0f}", "N/g"]]
    table(["", "front", "rear", "unit"], rows)
    print(f"\nrear/front frequency ratio {out['freq_r'] / out['freq_f']:.2f} (many teams run the rear 5-20 % higher)")
    print(f"roll gradient: {out['grad']:.2f} deg/g")
    print(f"LLTD front: {out['lltd'] * 100:.1f} %  (front weight {out['wf'] * 100:.0f} %; front LLTD a few % above "
          "front weight is a common starting point for mild understeer)")
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


# --------------------------------------------------------------------------- #
#  HTML report
# --------------------------------------------------------------------------- #
def build_report(cfg, ev, path, baseline=None, delta=5.0, sens=None, adv=None, loads=None):
    import base64
    import datetime
    import html
    import os
    import tempfile
    E = html.escape
    m = ev["metrics"]
    pk = ev.get("pack")
    chk = all_checks(cfg, ev)
    npass = sum(1 for c in chk if c[4] == "PASS")
    ntot = len(chk)
    bm = None
    if baseline:
        from .kinematics import evaluate
        bm = evaluate(baseline)["metrics"]
    img = ""
    fd, tmp = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    try:
        if make_plot([ev], [cfg["name"]], tmp, quiet=True):
            img = base64.b64encode(open(tmp, "rb").read()).decode()
    finally:
        os.remove(tmp)
    issues = validate(cfg)

    out = []
    A = out.append
    A("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>")
    A(f"<title>{E(cfg['name'])} - suspension report</title><style>")
    A(""":root{--bg:#fff;--fg:#1c2128;--mut:#667;--line:#d8dde3;--card:#f6f8fa;--ok:#1a7f37;--bad:#cf222e;--okbg:#dafbe1;--badbg:#ffebe9;--warnbg:#fff8c5;--warn:#7d4e00;--acc:#0969da}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#8b949e;--line:#30363d;--card:#161b22;--ok:#3fb950;--bad:#f85149;--okbg:#12261a;--badbg:#2d1214;--warnbg:#2b2111;--warn:#d29922;--acc:#58a6ff}}
body{font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg);max-width:1100px;margin:0 auto;padding:16px}
h1{margin:.2em 0}h2{margin:1.6em 0 .4em;border-bottom:1px solid var(--line);padding-bottom:4px}
.sub{color:var(--mut)}table{border-collapse:collapse;width:100%;font-size:14px;margin:.4em 0}
th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:right}th:first-child,td:first-child{text-align:left}
th{color:var(--mut);font-weight:600}.pass{color:var(--ok);font-weight:700}.fail{color:var(--bad);font-weight:700}
.banner{padding:10px 14px;border-radius:8px;font-weight:600;margin:10px 0}.banner.ok{background:var(--okbg);color:var(--ok)}.banner.bad{background:var(--badbg);color:var(--bad)}
.warnbox{background:var(--warnbg);color:var(--warn);border-radius:8px;padding:8px 14px;margin:8px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin:8px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.tile{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.tile b{display:block;font-size:20px}.tile span{color:var(--mut);font-size:12px}img{max-width:100%;border:1px solid var(--line);border-radius:6px;background:#fff}
.scroll{overflow-x:auto}.small{font-size:12.5px;color:var(--mut)}code{background:var(--card);padding:1px 4px;border-radius:4px}
@media print{body{max-width:none}}</style>""")
    s = ev["susp"]
    A(f"<h1>{E(cfg['name'])}</h1><div class=sub>{cfg['axle']} axle · wheelbase {s.WB:.0f} mm · track "
      f"{s.track:.0f} mm · CG {s.CG:.0f} mm · mass {cfg['vehicle']['mass']:g} kg · tire R {s.R:.0f} mm · "
      f"generated {datetime.datetime.now():%Y-%m-%d %H:%M} · rigid-link kinematics</div>")
    if issues:
        A("<div class=warnbox><b>Input checks</b><ul>" + "".join(
            f"<li>{'ERROR: ' if lv == 'error' else ''}{E(msg)}</li>" for lv, msg in issues) + "</ul></div>")
    A(f"<div class='banner {'ok' if npass == ntot else 'bad'}'>{npass} of {ntot} checks pass"
      f"{'' if npass == ntot else ' - see the fixes below'}</div>")
    show = ["camber", "camber_gain", "roll_camber", "caster", "kpi", "scrub", "trail", "roll_center", "rc_lat",
            "bump_steer", "track_change"]
    show += ["antidive"] if cfg["axle"] == "front" else ["antisquat", "antilift"]
    show += [k for k in ("ackermann", "turn_radius", "motion_ratio", "ride_freq") if k in m]
    A("<div class=grid>" + "".join(
        f"<div class=tile><span>{E(METRICS[k][0])}</span><b>{f_num(m[k], METRICS[k][2])}"
        f" <small>{METRICS[k][1]}</small></b></div>" for k in show if k in m) + "</div>")

    A("<h2>Checks</h2><div class=scroll><table><tr><th>Check<th>Value<th>Allowed range"
      + ("<th>Baseline<th>Change" if bm else "") + "<th>Status</tr>")
    for key, label, v, rng, st in chk:
        cls = "pass" if st == "PASS" else "fail"
        extra = ""
        if bm is not None:
            b = bm.get(key) if key in METRICS else None
            if b is not None and key in m and isinstance(m[key], float):
                extra = f"<td>{f_num(b, METRICS[key][2])}<td>{m[key] - b:+.{METRICS[key][2]}f}"
            else:
                extra = "<td><td>"
        unit_ = METRICS[key][1] if key in METRICS else "mm"
        A(f"<tr><td>{E(label)}<td>{v} {unit_}<td>{E(rng)}{extra}<td class={cls}>{st}</tr>")
    A("</table></div><p class=small>Ranges come from the team table (edit <code>targets</code> in the config). "
      "Bump-steer, ride-frequency and clearance limits are suggestions.</p>")

    if adv is not None:
        A("<h2>What to change</h2>")
        if not adv and (pk is None or pk["ok"]):
            A("<div class='card'>Nothing is failing. Use the sensitivity table below before moving anything, "
              "and change one coordinate at a time.</div>")
        for k, v, lo, hi, cands in adv:
            rng_ = f"{'' if lo is None else f'{lo:.4g}'} … {'' if hi is None else f'{hi:.4g}'}"
            A(f"<div class=card><b>{E(METRICS[k][0])}</b> is {f_num(v, METRICS[k][2])} (allowed {rng_})<br>")
            if not cands:
                A("No single move within 40 mm fixes this. Change two coordinates, or run <code>optimize</code>.")
            else:
                A("<table><tr><th>Move<th>By<th>Result<th>Side effects</tr>")
                for c in cands:
                    side = ("breaks " + ", ".join(c["broken"])) if c["broken"] else "none"
                    A(f"<tr><td><code>{c['coord']}</code><td>{c['move']:+.1f} mm<td>{f_num(c['new'], METRICS[k][2])}"
                      f"<td>{E(side)}</tr>")
                A("</table>")
            A("</div>")
        if pk and not pk["ok"]:
            nm, (d, hz, rk, need) = pk["min_pair"]
            A(f"<div class=card><b>Clearance</b>: {E(nm)} is {d:.1f} mm apart, needs {need:.1f} mm. Move the "
              "closer link away, then restore bump steer with the optimizer on the tie-rod heights.</div>")

    if img:
        A(f"<h2>Plots and geometry</h2><img alt='kinematic plots' src='data:image/png;base64,{img}'>")
    if ev.get("spring") is not None:
        fd, tmp = tempfile.mkstemp(suffix=".png")
        os.close(fd)
        try:
            if make_rocker_plot(ev, tmp, quiet=True):
                rimg = base64.b64encode(open(tmp, "rb").read()).decode()
                A(f"<h2>Rocker and damper</h2><img alt='rocker plots' src='data:image/png;base64,{rimg}'>")
        finally:
            os.remove(tmp)

    R = ev.get("roll")
    if R:
        A(f"<h2>Roll</h2><p class=small>Body roll with equal and opposite wheel travel. Camber relative to the ground. "
          f"Roll camber {f_num(m['roll_camber'], 3)} deg/deg (1.0 = wheel leans with the body). "
          f"Roll center moves {f_num(m['rc_lat'], 1)} mm sideways per degree.</p>")
        A("<div class=scroll><table><tr><th>Roll (°)<th>Outer camber<th>Inner camber<th>Outer toe<th>RC height"
          "<th>RC lateral</tr>")
        for r in R[len(R) // 2:]:
            A(f"<tr><td>{r['roll']:.1f}<td>{r['camber_outer']:.2f}<td>{r['camber_inner']:.2f}<td>{r['toe_outer']:.3f}"
              f"<td>{f_num(r['rc_height'], 1)}<td>{f_num(r['rc_lateral'], 1)}</tr>")
        A("</table></div>")

    if ev.get("steer"):
        st = ev["steer"]
        sel = [st[i] for i in range(0, len(st), max(1, len(st) // 7))]
        if st[-1] not in sel:
            sel.append(st[-1])
        A("<h2>Steering</h2><div class=scroll><table><tr><th>Rack (mm)<th>Inner (°)<th>Outer (°)<th>Ackermann (%)"
          "<th>Inner camber<th>Outer camber</tr>")
        for r in sel:
            A(f"<tr><td>{r['rack']:.1f}<td>{r['inner']:.2f}<td>{r['outer']:.2f}<td>{f_num(r['ackermann'], 0)}"
              f"<td>{r['camber_inner']:.2f}<td>{r['camber_outer']:.2f}</tr>")
        A("</table></div>")
        ri = rack_for_angle(st, "inner", 25.0)
        A(f"<p class=small>Rack travel for 25° on the inner wheel: "
          f"{'%.1f mm' % ri if ri is not None else 'more than the range tested'}. "
          f"Ackermann measured at {cfg['sweep']['ackermann_at_outer_deg']:g}° outer. "
          + (f"Turning radius (outer front wheel, full rack): {m['turn_radius']:.2f} m. " if "turn_radius" in m else "")
          + f"Steering arm: {m['steer_arm']:.0f} mm.</p>")

    if ev.get("ride"):
        rd, sc = ev["ride"], cfg["spring"]
        A(f"<h2>Spring and damper</h2><p class=small>{sc['rod_on']}-arm rod, "
          f"{'direct-acting damper' if ev['spring'].direct else 'rocker'}; spring {sc['spring_rate']:g} N/mm, "
          f"tire {sc['tire_rate']:g} N/mm, sprung corner mass {rd['_m_sprung']:.1f} kg.</p><table>")
        for k in ("motion_ratio", "mr_progression", "wheel_rate", "ride_rate", "ride_freq", "static_spring_force",
                  "spring_for_target", "damper_used", "damper_margin", "damper_static_pos", "damper_topout",
                  "damper_bottomout", "rod_angle", "rocker_rot", "trans_min"):
            if k in m:
                A(f"<tr><td>{E(METRICS[k][0])}<td>{f_num(m[k], METRICS[k][2])} {METRICS[k][1]}</tr>")
        A("</table>")
        if sc.get("target_freq_hz") and "spring_for_target" in m:
            A(f"<p class=small>For {sc['target_freq_hz']:g} Hz use about {m['spring_for_target']:.0f} N/mm "
              f"({m['spring_for_target'] * 5.71:.0f} lbf/in) at this motion ratio.</p>")

    if loads:
        names = list(loads["results"])
        A("<h2>Member loads</h2><p class=small>Outer wheel, quasi-static, + = tension. Change the g levels under "
          "<code>loads</code> and tube sizes under <code>members</code>.</p><div class=scroll><table><tr><th>Member"
          + "".join(f"<th>{E(n)}" for n in names) + "</tr>")
        for k in MEMBERS:
            A(f"<tr><td>{E(member_label(k, s))}" + "".join(f"<td>{loads['results'][n][k]:+.0f}" for n in names) + "</tr>")
        A("<tr><td>Damper/spring" + "".join(f"<td>{loads['results'][n]['damper']:+.0f}" for n in names) + "</tr>")
        mem = cfg["members"]
        A(f"</table></div><p class=small>Material: {E(str(mem.get('material', 'steel')))}, E {mem['E']:g} MPa, yield "
          f"{mem['yield']:g} MPa, required FOS {mem['sf_target']:g}. Buckling FOS = Euler load π²EI/L² ÷ worst "
          "compression. Yield FOS = (yield stress × tube area) ÷ worst axial force.</p>")
        A("<div class=scroll><table><tr><th>Member<th>Tube (mm)<th>Worst compression<th>Buckling load<th>FOS buckling"
          "<th>Worst |force|<th>Yield force<th>FOS yield<th></tr>")
        sf_t = mem["sf_target"]
        for r in loads["checks"]:
            ok = min(r["sf_buckle"], r["sf_yield"]) >= sf_t
            A(f"<tr><td>{E(member_label(r['member'], s))}<td>{r['od']:g}×{r['wall']:g}<td>{r['compression']:.0f} N"
              f"<td>{r['Pcr']:.0f} N<td>{f_num(r['sf_buckle'], 1)}<td>{r['peak']:.0f} N<td>{r['Py']:.0f} N"
              f"<td>{f_num(r['sf_yield'], 1)}<td class={'pass' if ok else 'fail'}>{'OK' if ok else 'BELOW FOS'}</tr>")
        A("</table></div>")

    if pk:
        A("<h2>Packaging</h2><div class=scroll><table><tr><th>Link pair<th>Min distance (mm)<th>Needs<th>at heave"
          "<th>at rack</tr>")
        for n, (d, hz, rk, need) in sorted(pk["pairs"].items(), key=lambda kv: kv[1][0] - kv[1][3]):
            A(f"<tr><td>{E(n)}<td class={'pass' if d >= need else 'fail'}>{d:.1f}<td>{need:.1f}<td>{hz:+.0f}"
              f"<td>{rk:+.0f}</tr>")
        A(f"</table></div><p class=small>Rim radial margin: {pk['rim_margin']:.1f} mm.</p>")

    A("<h2>Hardpoints</h2><div class=scroll><table><tr><th>Point<th>X<th>Y<th>Z"
      + ("<th>Δ vs baseline" if baseline else "") + "</tr>")
    for k in HP_ORDER:
        v = cfg["hardpoints"][k]
        d = ""
        if baseline:
            dv = [a - b for a, b in zip(v, baseline["hardpoints"][k])]
            d = "<td>" + (", ".join(f"{n}{x:+.1f}" for n, x in zip("XYZ", dv) if abs(x) > 1e-9) or "-")
        A(f"<tr><td>{k}<td>{v[0]:.2f}<td>{v[1]:.2f}<td>{v[2]:.2f}{d}</tr>")
    A("</table></div>")

    if sens:
        cols, srows = sens
        A(f"<h2>Sensitivity: +{delta:g} mm on one coordinate</h2><p class=small>Change in each metric. Darker = bigger "
          "effect relative to that column's largest. Pick the hardpoint that moves what you want, then move only "
          "that one.</p>")
        A("<div class=scroll><table><tr><th>Coordinate" + "".join(f"<th>Δ {E(METRICS[k][0])}" for k in cols) + "</tr>")
        mx = [max(abs(r[1][j]) for r in srows) or 1.0 for j in range(len(cols))]
        for name, vals in srows:
            cells = ""
            for j, (v, k) in enumerate(zip(vals, cols)):
                a = min(0.55, 0.55 * abs(v) / mx[j]) if abs(v) > 1e-9 else 0
                col = "207,34,46" if v < 0 else "9,105,218"
                dec = METRICS[k][2] if METRICS[k][2] > 1 else 2
                cells += f"<td style='background:rgba({col},{a:.2f})'>{v:+.{dec}f}"
            A(f"<tr><td><code>{name}</code>{cells}</tr>")
        A("</table></div><p class=small>Red = metric decreases, blue = increases.</p>")

    A("<h2>What each number means</h2><div class=scroll><table><tr><th>Metric<th style='text-align:left'>"
      "Meaning / how to move it</tr>")
    for k in show + ["toe", "fvsa", "roll_steer", "steer_arm", "clearance_min"]:
        if k in METRIC_HELP:
            A(f"<tr><td>{E(METRICS[k][0])}<td style='text-align:left'>{E(METRIC_HELP[k])}</tr>")
    A("</table></div>")
    A("<h2>Limits of this model</h2><ul class=small><li>Rigid links, no compliance or tire model; one corner "
      "(the other side is its mirror).</li><li>Roll is modeled as equal and opposite wheel travel; the force-based "
      "roll center will differ once the tires are loaded unevenly.</li>"
      "<li>Loads are quasi-static at ride-height geometry; no fatigue, impact factors or tab/weld checks.</li>"
      "<li>Clearance is center-line to center-line plus tube radii; rim check is radial only.</li>"
      "<li>Always confirm the final design in CAD.</li></ul>")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print(f"wrote {path}")
