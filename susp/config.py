"""Config schema, defaults, targets, templates and input sanity checks."""
from __future__ import annotations

import copy
import json
import math
import os

import numpy as np

from .errors import ConfigError
from .schema import DEFAULTS_FILE, METRICS_FILE, POINTS_FILE, TARGETS_FILE

HP = {p["key"]: p["short"] for p in POINTS_FILE["hardpoints"]}   # json key -> short name used internally
SHORT2LONG = {v: k for k, v in HP.items()}
HP_ORDER = list(HP)
SPRING_POINTS = tuple(p["key"] for p in POINTS_FILE["spring_points"])
DEFAULTS = copy.deepcopy(DEFAULTS_FILE["defaults"])
SPRING_DEFAULTS = copy.deepcopy(DEFAULTS_FILE["spring_defaults"])
DAMPER_KEYS = tuple(DEFAULTS_FILE["damper_keys"])
METRICS = {k: (d["label"], d["unit"], d["decimals"]) for k, d in METRICS_FILE["corner"].items()}   # key: (label, unit, decimals)
METRIC_HELP = {k: d["help"] for k, d in METRICS_FILE["corner"].items() if d.get("help")}


def deep_merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def finish_config(cfg, where="config"):
    """Normalize a merged config (shared by load_config, selftests and tools)."""
    hp = cfg.get("hardpoints", {})
    missing = [k for k in HP if k not in hp]
    if missing:
        raise ConfigError(f"{where}: missing hardpoints: {', '.join(missing)}")
    cfg["hardpoints"] = {k: [float(c) for c in hp[k]] for k in HP}
    for k, v in cfg["hardpoints"].items():
        if len(v) != 3:
            raise ConfigError(f"{where}: hardpoint {k} needs [x, y, z]")
    if cfg["axle"] not in ("front", "rear"):
        raise ConfigError(f"{where}: axle must be 'front' or 'rear'")
    if cfg.get("spring"):
        sp = deep_merge(SPRING_DEFAULTS, cfg["spring"])
        if sp["rod_on"] not in ("lower", "upper", "upright"):
            raise ConfigError(f"{where}: spring.rod_on must be 'lower', 'upper' or 'upright'")
        need = ["rod_outboard", "damper_chassis"]
        rocker = [k for k in ("rocker_pivot", "rocker_axis", "rocker_rod", "rocker_damper") if sp.get(k) is not None]
        if rocker and len(rocker) < 4:
            raise ConfigError(f"{where}: spring needs all of rocker_pivot, rocker_axis, rocker_rod, rocker_damper "
                     "(or none of them for a direct-acting damper)")
        miss = [k for k in need if sp.get(k) is None]
        if miss:
            raise ConfigError(f"{where}: spring block is missing {', '.join(miss)}")
        cfg["spring"] = sp
    return cfg


def load_config(path):
    try:
        with open(path) as f:
            raw = json.load(f)
    except json.JSONDecodeError as e:
        raise ConfigError(f"{path}: not valid JSON ({e})")
    cfg = finish_config(deep_merge(DEFAULTS, raw), path)
    tf = raw.get("targets_file")
    if tf:
        tp = tf if os.path.isabs(tf) else os.path.join(os.path.dirname(os.path.abspath(path)), tf)
        if not os.path.exists(tp):
            raise ConfigError(f"{path}: targets_file '{tf}' not found (looked for {tp})")
        cfg["_team_targets"] = load_targets_file(tp, cfg["axle"])
    return cfg


def load_car(path):
    """A car file: {"type": "car", "name", "vehicle", "front": {...}, "rear": {...}, "arb": {"front", "rear"},
    "car_targets": {...}}. Each corner gets the shared vehicle block. Returns (front_cfg, rear_cfg, car_info)."""
    try:
        with open(path) as f:
            raw = json.load(f)
    except json.JSONDecodeError as e:
        raise ConfigError(f"{path}: not valid JSON ({e})")
    if not (isinstance(raw.get("front"), dict) and isinstance(raw.get("rear"), dict) and "hardpoints" in raw["front"] and "hardpoints" in raw["rear"]):
        raise ConfigError(f"{path}: a car file needs a 'front' and a 'rear' corner")
    out = []
    for axle in ("front", "rear"):
        c = dict(raw[axle])
        c["axle"] = axle
        if raw.get("vehicle"):
            c["vehicle"] = deep_merge(c.get("vehicle") or {}, raw["vehicle"])
        cfg = finish_config(deep_merge(DEFAULTS, c), f"{path} ({axle})")
        tf = c.get("targets_file") or raw.get("targets_file")
        if tf:
            tp = tf if os.path.isabs(tf) else os.path.join(os.path.dirname(os.path.abspath(path)), tf)
            if not os.path.exists(tp):
                raise ConfigError(f"{path}: targets_file '{tf}' not found (looked for {tp})")
            cfg["_team_targets"] = load_targets_file(tp, axle)
        out.append(cfg)
    arb = raw.get("arb") or {}
    info = {"name": raw.get("name") or "car", "arb_f": float(arb.get("front") or 0), "arb_r": float(arb.get("rear") or 0),
            "car_targets": raw.get("car_targets") or {}}
    return out[0], out[1], info


def is_car_file(path):
    try:
        with open(path) as f:
            raw = json.load(f)
        return (isinstance(raw, dict) and isinstance(raw.get("front"), dict) and isinstance(raw.get("rear"), dict)
                and "hardpoints" in raw["front"] and "hardpoints" in raw["rear"])
    except (OSError, json.JSONDecodeError):
        return False


def make_config(over):
    """Build a config from a dict of overrides (used by tests)."""
    return finish_config(deep_merge(DEFAULTS, over), "inline config")


# Broad, general starting ranges that suit most FSAE cars. They catch clear mistakes rather than define a good
# design: narrow them to your own team's goals with "targets" in a design file, or a shared "targets_file".
GENERAL_TARGETS = TARGETS_FILE["general"]


def load_targets_file(path, axle):
    """A team targets file: {"front": {...}, "rear": {...}} or one flat {metric: [lo, hi]} table."""
    with open(path) as f:
        data = json.load(f)
    if "front" in data or "rear" in data:
        return dict(data.get(axle) or {})
    return dict(data.get("targets", data))


def default_targets(cfg):
    """General ranges, then the team targets file (if any), then this design's own "targets" (null drops one)."""
    t = dict(GENERAL_TARGETS[cfg["axle"]])
    sp_, cond = cfg.get("spring"), TARGETS_FILE["conditional"]
    if sp_:
        t.update(cond["spring"])
        if sp_.get("damper_stroke"):
            t.update(cond["damper_stroke"])
            if sp_.get("damper_eye_to_eye"):
                t.update(cond["damper_eye_to_eye"])
        if sp_.get("rocker_pivot") is not None:
            t.update(cond["rocker"])
        if sp_.get("damper_bump_low") and sp_.get("damper_rebound_low"):     # body control (low-speed)
            t.update(cond["damping"])
    t.update(cfg.get("_team_targets") or {})
    t.update({k: v for k, v in (cfg.get("targets") or {}).items()})
    return {k: v for k, v in t.items() if v is not None}


def cfg_to_json(cfg):
    keys = ("name", "axle", "wheel", "vehicle", "sweep", "clearance", "rack_direction", "targets_file", "targets",
            "spring", "loads", "members")
    out = {k: cfg[k] for k in keys if cfg.get(k) is not None}
    out["hardpoints"] = {k: cfg["hardpoints"][k] for k in HP}
    return out


# --------------------------------------------------------------------------- #
#  Input sanity checks - catch CAD-import and typing mistakes before solving
# --------------------------------------------------------------------------- #
def validate(cfg):
    """Return a list of (level, message). level is 'error' or 'warn'."""
    h = {HP[k]: np.array(v, float) for k, v in cfg["hardpoints"].items()}
    out = []
    def W(m):
        return out.append(("warn", m))
    def E(m):
        return out.append(("error", m))
    R = cfg["wheel"]["tire_radius"]
    if abs(h["cp"][2]) > 1.0:
        W(f"contact_patch Z is {h['cp'][2]:.1f} mm. The ground should be Z = 0 (Z up). "
          "Check the axis mapping or the offset you used when importing from CAD.")
    if h["cp"][1] <= 0:
        E("contact_patch Y must be positive (right-hand wheel, Y outboard). Your Y axis may be flipped.")
    if h["ubj"][2] <= h["lbj"][2]:
        E("upper_outboard is not above lower_outboard - upper and lower ball joints may be swapped, or Z is not up.")
    for arm, pts in (("upper", ("uif", "uir", "ubj")), ("lower", ("lif", "lir", "lbj"))):
        a, b, bj = (h[p] for p in pts)
        if max(a[1], b[1]) >= bj[1]:
            W(f"{arm} wishbone: an inboard pivot is not inboard of the ball joint (Y). Check for swapped axes.")
        u = (b - a) / max(np.linalg.norm(b - a), 1e-9)
        v = bj - a
        if np.linalg.norm(v - (v @ u) * u) < 50:
            E(f"{arm} wishbone: the ball joint is almost on the pivot axis - the arm cannot control the wheel.")
        if abs(u[0]) < 0.5:
            W(f"{arm} wishbone pivot axis is far from fore-aft ({math.degrees(math.acos(min(1, abs(u[0])))):.0f} deg off X). "
              "Unusual - check the pivot coordinates.")
    for nm, p in (("upper_outboard", "ubj"), ("lower_outboard", "lbj"), ("trackrod_outboard", "tro")):
        if h[p][1] > h["cp"][1] + 5:
            W(f"{nm} is outboard of the tire center plane (Y {h[p][1]:.0f} > {h['cp'][1]:.0f}). "
              "Possible with lots of wheel offset, but check it fits inside the rim.")
        if h[p][2] > 2 * R:
            W(f"{nm} is above the top of the tire - check units (mm) and Z.")
    if abs(h["tro"][1] - h["tri"][1]) < 100:
        W("tie rod is very short (< 100 mm laterally). Bump steer will be hard to control.")
    # steering arm: distance from TRO to the kingpin axis
    k = h["ubj"] - h["lbj"]
    k = k / np.linalg.norm(k)
    v = h["tro"] - h["lbj"]
    arm = float(np.linalg.norm(v - (v @ k) * k))
    if cfg["axle"] == "front" and arm < 50:
        W(f"steering arm is only {arm:.0f} mm. Rack forces will be high and steering very quick.")
    veh = cfg["vehicle"]
    if veh["wheelbase"] < 1525:
        W(f"wheelbase {veh['wheelbase']:.0f} mm is below the FSAE minimum (1525 mm in recent rules - check the current rulebook).")
    if not 0.3 <= veh["weight_front"] <= 0.7:
        W("vehicle.weight_front should be a fraction (e.g. 0.46), not a percentage.")
    sp = cfg.get("spring")
    if sp:
        p = np.array(sp["rod_outboard"], float)
        if sp["rod_on"] in ("lower", "upper"):
            a, b, bj = (h[q] for q in (("lif", "lir", "lbj") if sp["rod_on"] == "lower" else ("uif", "uir", "ubj")))
            u = (b - a) / np.linalg.norm(b - a)
            d_bj = np.linalg.norm((bj - a) - ((bj - a) @ u) * u)
            d_p = np.linalg.norm((p - a) - ((p - a) @ u) * u)
            if d_p < 0.6 * d_bj:
                W(f"pushrod mounts {d_p:.0f} mm from the {sp['rod_on']} arm axis vs {d_bj:.0f} mm for the ball joint - "
                  "far inboard of the ball joint puts big bending loads in the arm.")
        inner = np.array(sp["rocker_rod"] if sp.get("rocker_pivot") is not None else sp["damper_chassis"], float)
        e = inner - p
        L = np.linalg.norm(e)
        ang = math.degrees(math.asin(min(1.0, abs(e[2]) / L)))
        if ang < 20:
            W(f"pushrod/pullrod is only {ang:.0f} deg from horizontal in the front view - low motion ratio and "
              "high rod forces. 30-60 deg is typical.")
        if sp.get("rocker_axis") is not None:
            ax = np.array(sp["rocker_axis"], float)
            if np.linalg.norm(ax) < 1e-9:
                E("spring.rocker_axis is zero - give the direction of the rocker pivot bolt, e.g. [1, 0, 0].")
            else:
                ax = ax / np.linalg.norm(ax)
                c = np.array(sp["rocker_pivot"], float)
                r = np.array(sp["rocker_rod"], float) - c
                tq = np.cross(r, e / L) @ ax
                if abs(tq) < 0.2 * np.linalg.norm(r - (r @ ax) * ax):
                    W("the pushrod points almost through the rocker pivot - tiny lever arm, rocker will be "
                      "near a toggle position.")
    out += [("warn", m) for m in unknown_target_keys(cfg)]
    return sorted(out, key=lambda t: t[0] != "error")


def unknown_target_keys(cfg):
    """Messages for target keys that aren't metrics the solver reports (usually a misspelling), from the design's
    own targets and its team targets file. Those targets would otherwise be ignored without a word."""
    import difflib
    msgs = []
    for src, tab in (("targets", cfg.get("targets")), ("the team targets file", cfg.get("_team_targets"))):
        for k in sorted((tab or {}).keys()):
            if k.startswith("_") or k in METRICS:
                continue
            near = difflib.get_close_matches(k, list(METRICS), n=1, cutoff=0.6)
            msgs.append(f"target '{k}' in {src} is not a metric the solver reports, so it is ignored"
                        + (f" - did you mean '{near[0]}'?" if near else ". Check the spelling against the Targets list."))
    return msgs


def unknown_car_target_keys(car_targets, known):
    msgs = []
    import difflib
    for k in sorted((car_targets or {}).keys()):
        if k not in known and not k.startswith("_"):
            near = difflib.get_close_matches(k, list(known), n=1, cutoff=0.6)
            msgs.append(f"car target '{k}' is not a car metric, so it is ignored" + (f" - did you mean '{near[0]}'?" if near else
                        f" (car targets: {', '.join(known)})."))
    return msgs


# Templates: invented example geometry (designs/templates/). Not any real team's car - replace with your own.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _template(axle):
    with open(os.path.join(_ROOT, "designs", "templates", f"{axle}.json")) as f:
        return json.load(f)


TEMPLATE_FRONT = _template("front")
TEMPLATE_REAR = _template("rear")
