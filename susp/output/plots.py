"""Plots (matplotlib, optional): the kinematic curves with front, side and top views of the geometry, and the
rocker / pushrod / damper at droop, ride height and bump."""
from __future__ import annotations

import math

import numpy as np


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
