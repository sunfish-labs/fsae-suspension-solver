"""Run history: log each run to a CSV and show what changed."""
from __future__ import annotations

import csv
import datetime
import os

import numpy as np

from ..config import HP, HP_ORDER, METRICS
from ..errors import ConfigError
from ..output import f_num, table
from .common import _fails

HIST_METRICS = ["camber", "toe", "caster", "kpi", "scrub", "trail", "roll_center", "camber_gain", "bump_steer",
                "bump_steer_curve",
                "roll_camber", "rc_lat", "track_change", "antidive", "antisquat", "antilift", "ackermann",
                "motion_ratio", "ride_freq", "clearance_min"]


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
        raise ConfigError("empty history")
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
