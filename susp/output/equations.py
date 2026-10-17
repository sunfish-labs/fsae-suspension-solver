"""SolidWorks global variables: a text file to link from Tools > Equations ("Link to external file").

One line per value, `"NAME"= value`, in the team frame (ISO 8855, origin on the ground under the front axle, mm; each
corner as the left-hand one, so Y is positive). Names are fixed so sketches can be dimensioned to them once:
  F_ / R_ + the file's point key + _X / _Y / _Z        e.g. "F_upper_inboard_front_X"
  F_ / R_ + rocker_axis_X/Y/Z                           (a unit direction, no units)
  F_ / R_ + pushrod_length, tie_rod_length, damper_length (center to center / eye to eye at ride height)
  wheelbase, F_track, R_track
Values carry no units: set the part or assembly's units to mm. Lines starting with ' are comments."""
from __future__ import annotations

import math

from ..config import HP_ORDER
from ..frame import corner_out
from ..setup import setup_values

SPRING_PTS = ("rod_outboard", "rocker_pivot", "rocker_rod", "rocker_damper", "damper_chassis")


def _num(v, d=3):
    v = round(float(v), d) + 0.0
    return f"{v:.{d}f}"


def corner_lines(cfg, ev):
    pre = "F_" if cfg["axle"] == "front" else "R_"
    team = corner_out(cfg)
    out = []
    for k in HP_ORDER:
        for i, a in enumerate("XYZ"):
            out.append((f"{pre}{k}_{a}", _num(team["hardpoints"][k][i])))
    sp = team.get("spring") or {}
    for k in SPRING_PTS:
        if isinstance(sp.get(k), list):
            for i, a in enumerate("XYZ"):
                out.append((f"{pre}{k}_{a}", _num(sp[k][i])))
    if isinstance(sp.get("rocker_axis"), list):
        ax = sp["rocker_axis"]
        n = math.sqrt(sum(float(c) ** 2 for c in ax)) or 1.0
        for i, a in enumerate("XYZ"):
            out.append((f"{pre}rocker_axis_{a}", _num(float(ax[i]) / n, 6)))
    v = setup_values(cfg, ev)
    out.append((f"{pre}tie_rod_length", _num(v["tie_rod_len"])))
    if "pushrod_len" in v:
        out += [(f"{pre}pushrod_length", _num(v["pushrod_len"])), (f"{pre}damper_length", _num(v["damper_len"]))]
    out.append((f"{pre}track", _num(ev["susp"].track)))
    return out


def equations_text(name, corners, wheelbase):
    """corners: [(cfg, ev)] for the front and/or rear corner."""
    lines = [f"' {name}: suspension points for SolidWorks (Tools > Equations > Link to external file)",
             "' ISO 8855 team frame: X forward, Y left, Z up, mm; origin on the ground under the front axle, on the centerline",
             "' each corner as the left-hand one (Y positive); set the model's units to mm",
             f'"wheelbase"= {_num(wheelbase)}']
    for cfg, ev in corners:
        lines += [f'"{n}"= {v}' for n, v in corner_lines(cfg, ev)]
    return "\n".join(lines) + "\n"
