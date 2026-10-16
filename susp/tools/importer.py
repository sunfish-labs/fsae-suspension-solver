"""CSV import: build a design from a name,x,y,z point table (e.g. SolidWorks sketch points)."""
from __future__ import annotations

import copy
import csv
import sys

from ..config import HP, SHORT2LONG, SPRING_POINTS, TEMPLATE_FRONT, TEMPLATE_REAR
from ..errors import ConfigError
from ..schema import POINTS_FILE

# --------------------------------------------------------------------------- #
#  CSV import (e.g. SolidWorks sketch points)
# --------------------------------------------------------------------------- #
_ALIASES = POINTS_FILE["aliases"]


_SPRING_ALIASES = POINTS_FILE["spring_aliases"]


def import_csv(path, axle, mapping="x,y,z", scale=1.0, offset="0,0,0", name=None):
    def term(spec):
        sign = -1.0 if spec.startswith("-") else 1.0
        idx = "xyz".find(spec.lstrip("+-").lower())
        if idx < 0:
            raise ConfigError(f"bad --map term '{spec}' (use x, y, z with optional minus, e.g. 'z,-x,y')")
        return sign, idx
    mp = [term(t.strip()) for t in mapping.split(",")]
    if len(mp) != 3:
        raise ConfigError("--map needs three terms, e.g. 'x,y,z'")
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
        raise ConfigError("missing points: " + ", ".join(miss) + "\nnames accepted: " + ", ".join(HP) + " (or short names "
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
