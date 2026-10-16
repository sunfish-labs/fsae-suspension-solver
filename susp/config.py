"""Config schema, defaults, targets, templates and input sanity checks."""
from __future__ import annotations

import copy
import json
import os


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


def _read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise ConfigError(f"{path}: not valid JSON ({e})") from None


def normalize(raw, axle=None, where="config", base_dir=None, vehicle=None, targets_file=None):
    """The one way every loader turns raw JSON into a config: defaults merged in, the axle set, the shared car vehicle
    block applied, the hardpoints and spring checked, and the team targets file (path relative to base_dir) read."""
    c = dict(raw)
    if axle:
        c["axle"] = axle
    if vehicle:
        c["vehicle"] = deep_merge(c.get("vehicle") or {}, vehicle)
    cfg = finish_config(deep_merge(DEFAULTS, c), where)
    tf = c.get("targets_file") or targets_file
    if tf:
        tp = tf if os.path.isabs(tf) or base_dir is None else os.path.join(base_dir, tf)
        if not os.path.exists(tp):
            raise ConfigError(f"{where}: targets_file '{tf}' not found (looked for {tp})")
        cfg["_team_targets"] = load_targets_file(tp, cfg["axle"])
    return cfg


def load_config(path):
    return normalize(_read_json(path), where=path, base_dir=os.path.dirname(os.path.abspath(path)))


def load_car(path):
    """A car file: {"type": "car", "name", "vehicle", "front": {...}, "rear": {...}, "arb": {"front", "rear"},
    "car_targets": {...}}. Each corner gets the shared vehicle block. Returns (front_cfg, rear_cfg, car_info)."""
    raw = _read_json(path)
    if not (isinstance(raw.get("front"), dict) and isinstance(raw.get("rear"), dict) and "hardpoints" in raw["front"] and "hardpoints" in raw["rear"]):
        raise ConfigError(f"{path}: a car file needs a 'front' and a 'rear' corner")
    base = os.path.dirname(os.path.abspath(path))
    f, r = (normalize(raw[ax], ax, f"{path} ({ax})", base, raw.get("vehicle"), raw.get("targets_file")) for ax in ("front", "rear"))
    arb = raw.get("arb") or {}
    info = {"name": raw.get("name") or "car", "arb_f": float(arb.get("front") or 0), "arb_r": float(arb.get("rear") or 0),
            "car_targets": raw.get("car_targets") or {}}
    return f, r, info


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
    return normalize(over, where="inline config")


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


# Templates: invented example geometry (designs/templates/). Not any real team's car - replace with your own.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _template(axle):
    with open(os.path.join(_ROOT, "designs", "templates", f"{axle}.json")) as f:
        return json.load(f)


TEMPLATE_FRONT = _template("front")
TEMPLATE_REAR = _template("rear")


from .validate import unknown_car_target_keys, unknown_target_keys, validate  # noqa: E402,F401 - re-exported
