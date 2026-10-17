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
    _check_extras(cfg, where)
    return cfg


def _vec3(v):
    return isinstance(v, (list, tuple)) and len(v) == 3 and all(isinstance(c, (int, float)) and not isinstance(c, bool) for c in v)


def check_ground_points(gp, where="ground_points"):
    """The car's lowest points for the ground clearance rule: [{name, at: [x, y, z]}] in the car frame (mm)."""
    if not isinstance(gp, list):
        raise ConfigError(f"{where}: ground_points must be a list of {{name, at: [x, y, z]}}")
    for i, p in enumerate(gp):
        at = p.get("at") if isinstance(p, dict) else None
        if not (isinstance(at, list) and len(at) == 3 and all(isinstance(v, (int, float)) for v in at)):
            raise ConfigError(f"{where}: ground_points[{i}] needs at: [x, y, z] in mm")


SWEEP_STEPS = {"steps": 5, "roll_steps": 3, "rack_steps": 3, "pack_heave_steps": 2, "pack_rack_steps": 2}


def _check_extras(cfg, where):
    """The optional blocks: asymmetric travel, caliper envelope and rear halfshaft."""
    sw = cfg["sweep"]
    for k in ("travel", "droop_travel", "bump_travel"):
        if sw.get(k) is not None and not float(sw[k]) > 0:
            raise ConfigError(f"{where}: sweep.{k} must be a positive distance in mm")
    for k, lo in SWEEP_STEPS.items():
        v = sw.get(k)
        if v is not None and not (isinstance(v, (int, float)) and float(v).is_integer() and lo <= v <= 1001):
            raise ConfigError(f"{where}: sweep.{k} must be a whole number from {lo} to 1001 (the solver needs at least {lo} "
                              "positions to work out slopes)")
    mem, lo_ = cfg.get("members") or {}, cfg.get("loads") or {}
    surf = mem.get("surface")
    if surf is not None and surf not in ("ground", "machined", "cold-drawn", "hot-rolled", "as-forged"):
        raise ConfigError(f"{where}: members.surface must be ground, machined, cold-drawn, hot-rolled or as-forged")
    for k in ("uts", "fatigue_sf", "weld_fat_tube", "weld_fat_tab", "tab_yield"):
        v = mem.get(k)
        if v is not None and not (isinstance(v, (int, float)) and v > 0):
            raise ConfigError(f"{where}: members.{k} must be a positive number")
    tab = mem.get("tab")
    if tab is not None:
        bad_ = [k for k, v in tab.items() if k in ("thickness", "width", "edge", "weld_leg", "weld_length", "count")
                and not (isinstance(v, (int, float)) and v > 0)] if isinstance(tab, dict) else ["tab"]
        if bad_:
            raise ConfigError(f"{where}: members.tab needs positive numbers for {', '.join(bad_)}")
    gus = mem.get("gusset")
    if gus is not None:
        if not isinstance(gus, dict):
            raise ConfigError(f"{where}: members.gusset must be {{thickness, height, length_in, length_out}} (mm) or null")
        if gus.get("type") not in (None, "along_leg", "to_node"):
            raise ConfigError(f"{where}: members.gusset.type must be along_leg or to_node")
        bad_ = [] if gus.get("type") == "to_node" else [k for k in ("thickness", "height")
                                                         if not (isinstance(gus.get(k), (int, float)) and gus[k] > 0)]
        bad_ += [k for k in ("length_in", "length_out", "fat") if gus.get(k) is not None
                 and not (isinstance(gus[k], (int, float)) and gus[k] >= 0)]
        if not bad_ and gus.get("type") != "to_node" and not (gus.get("length_in") or 0) + (gus.get("length_out") or 0) > 0:
            bad_.append("length_in or length_out")
        if bad_:
            raise ConfigError(f"{where}: members.gusset needs positive numbers for {', '.join(bad_)}")
    rk = mem.get("rocker")
    if rk is not None:
        if not isinstance(rk, dict):
            raise ConfigError(f"{where}: members.rocker must be {{thickness, pivot_bore, pivot_edge, edge, width}} (mm) or null")
        bad_ = [k for k in ("thickness", "pivot_bore", "pivot_edge", "edge", "width")
                if not (isinstance(rk.get(k), (int, float)) and rk[k] > 0)]
        bad_ += [k for k in ("plates", "pin_dia", "yield") if rk.get(k) is not None
                 and not (isinstance(rk[k], (int, float)) and rk[k] > 0)]
        if bad_:
            raise ConfigError(f"{where}: members.rocker needs positive numbers for {', '.join(bad_)}")
        d_pin = rk.get("pin_dia") or mem.get("bolt_dia") or 8.0
        if rk["pivot_edge"] <= rk["pivot_bore"] / 2:
            raise ConfigError(f"{where}: members.rocker.pivot_edge ({rk['pivot_edge']:g} mm) must be more than half the pivot bore")
        if rk["edge"] <= d_pin / 2:
            raise ConfigError(f"{where}: members.rocker.edge ({rk['edge']:g} mm) must be more than half the pin ({d_pin / 2:g} mm)")
    for k in ("fatigue_cycles", "fatigue_bump_cycles"):
        v = lo_.get(k)
        if v is not None and not (isinstance(v, (int, float)) and v >= 1):
            raise ConfigError(f"{where}: loads.{k} must be a number of cycles (1 or more)")
    cal = cfg["wheel"].get("caliper")
    if cal is not None:
        miss = [k for k in ("clock_deg", "radius", "size", "offset") if not isinstance(cal.get(k) if isinstance(cal, dict) else None, (int, float))]
        if miss:
            raise ConfigError(f"{where}: wheel.caliper needs numbers for {', '.join(miss)} "
                              "(clock_deg, radius and size in mm, offset along the spin axis in mm)")
    sp = cfg.get("spring") or {}
    num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)  # noqa: E731
    if (sp.get("spring_rate2") is None) != (sp.get("spring_breakpoint") is None):
        raise ConfigError(f"{where}: a dual-rate spring needs both spring.spring_rate2 (N/mm) and spring.spring_breakpoint (mm)")
    if sp.get("spring_rate2") is not None and not (num(sp["spring_rate2"]) and sp["spring_rate2"] > 0 and num(sp["spring_breakpoint"]) and sp["spring_breakpoint"] >= 0):
        raise ConfigError(f"{where}: spring.spring_rate2 must be > 0 and spring.spring_breakpoint >= 0 mm")
    if sp.get("bumpstop_gap") is not None:
        if not num(sp["bumpstop_gap"]) or not (num(sp.get("bumpstop_k")) and sp["bumpstop_k"] > 0):
            raise ConfigError(f"{where}: a bump stop needs spring.bumpstop_gap (mm) and spring.bumpstop_k (N/mm, > 0)")
        if sp.get("bumpstop_k2") is not None and not (num(sp["bumpstop_k2"]) and sp["bumpstop_k2"] >= 0):
            raise ConfigError(f"{where}: spring.bumpstop_k2 must be a number >= 0 (N/mm^2)")
    veh = cfg["vehicle"]
    if veh.get("tire_load_sens") is not None and not (num(veh["tire_load_sens"]) and 0 <= veh["tire_load_sens"] < 1):
        raise ConfigError(f"{where}: vehicle.tire_load_sens must be between 0 and 1 (typically 0.1-0.3)")
    if veh.get("tire_mu") is not None and not (num(veh["tire_mu"]) and veh["tire_mu"] > 0):
        raise ConfigError(f"{where}: vehicle.tire_mu must be > 0")
    arb = cfg.get("arb")
    if arb is not None:
        if not isinstance(arb, dict):
            raise ConfigError(f"{where}: arb must be an object (see the README: anti-roll bar linkage)")
        if not cfg.get("spring"):
            raise ConfigError(f"{where}: the anti-roll bar linkage needs the spring block (it is part of the ride model)")
        miss = [k for k in ("link_outboard", "arm_tip", "bar_pivot") if not _vec3(arb.get(k))]
        if miss:
            raise ConfigError(f"{where}: arb needs {', '.join(miss)} as [x, y, z]")
        if arb.get("link_on", "lower") not in ("lower", "upper", "upright", "rocker"):
            raise ConfigError(f"{where}: arb.link_on must be lower, upper, upright or rocker")
        if arb.get("link_on") == "rocker" and cfg["spring"].get("rocker_pivot") is None:
            raise ConfigError(f"{where}: arb.link_on = rocker needs a rocker in the spring block")
        if not (num(arb.get("bar_od")) and arb["bar_od"] > 0):
            raise ConfigError(f"{where}: arb.bar_od (mm) is needed")
        w = arb.get("bar_wall")
        if w is not None and not (num(w) and 0 < w < arb["bar_od"] / 2):
            raise ConfigError(f"{where}: arb.bar_wall must be between 0 and half the OD (null = solid bar)")
        for k in ("bar_length", "bar_G", "bar_yield"):
            if arb.get(k) is not None and not (num(arb[k]) and arb[k] > 0):
                raise ConfigError(f"{where}: arb.{k} must be > 0")
        if arb.get("bar_axis") is not None and not (_vec3(arb["bar_axis"]) and any(arb["bar_axis"])):
            raise ConfigError(f"{where}: arb.bar_axis must be a direction [x, y, z]")
    js = cfg.get("joints") or {}
    if not isinstance(js, dict):
        raise ConfigError(f"{where}: joints must be an object keyed by joint, e.g. {{\"trackrod_outboard\": {{\"bolt\": \"x\"}}}}")
    from .joints import DEFAULT_JOINTS
    for k, v in js.items():
        if k not in DEFAULT_JOINTS:
            raise ConfigError(f"{where}: joints.{k} is not a joint; use one of {', '.join(DEFAULT_JOINTS)}")
        if not isinstance(v, dict):
            raise ConfigError(f"{where}: joints.{k} must be an object like {{\"bolt\": \"z\", \"allow\": 13}}")
        b = v.get("bolt")
        if b is not None and not (b in ("x", "y", "z", "pivot", "kingpin", "rocker") or (_vec3(b) and any(b))):
            raise ConfigError(f"{where}: joints.{k}.bolt must be x, y, z, pivot, kingpin, rocker or [x, y, z]")
        if v.get("type") not in (None, "rod_end", "bearing"):
            raise ConfigError(f"{where}: joints.{k}.type must be rod_end or bearing")
        if v.get("type") == "bearing" and k not in ("upper_outboard", "lower_outboard"):
            raise ConfigError(f"{where}: joints.{k}: only the ball joints can be modeled as a bearing")
        if v.get("allow") is not None and not (isinstance(v["allow"], (int, float)) and v["allow"] > 0):
            raise ConfigError(f"{where}: joints.{k}.allow must be a positive angle in degrees")
        if b == "rocker" and not (cfg.get("spring") or {}).get("rocker_axis"):
            raise ConfigError(f"{where}: joints.{k}.bolt = rocker needs a rocker (spring.rocker_axis)")
        if v.get("align") is not None:
            sw = cfg.get("sweep") or {}
            lo = float(sw.get("droop_travel") if sw.get("droop_travel") is not None else sw.get("travel", 30))
            hi = float(sw.get("bump_travel") if sw.get("bump_travel") is not None else sw.get("travel", 30))
            if k not in ("upper_outboard", "lower_outboard"):
                raise ConfigError(f"{where}: joints.{k}.align is for the ball joints (spherical bearings) only")
            if not (isinstance(v["align"], (int, float)) and -lo <= v["align"] <= hi):
                raise ConfigError(f"{where}: joints.{k}.align must be a wheel travel in mm between -{lo:g} and {hi:g}")
    hs = cfg.get("halfshaft")
    if hs is not None:
        if not isinstance(hs, dict) or not (_vec3(hs.get("diff_output")) and _vec3(hs.get("cv_outboard"))):
            raise ConfigError(f"{where}: halfshaft needs diff_output and cv_outboard as [x, y, z]")


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
            "car_targets": raw.get("car_targets") or {}, "layout": raw.get("layout"), "drivetrain": raw.get("drivetrain")}
    lay = raw.get("layout")
    if lay is not None:
        from .layout import apply_layout, check_layout, layout_mass
        check_layout(lay, path)
        res = layout_mass(lay, f, r, f["vehicle"]["wheelbase"])
        info["layout_res"] = res
        if lay.get("apply"):                       # the car's mass and CG come from the layout
            for c in (f, r):
                c["vehicle"] = apply_layout(c["vehicle"], res)
    info["cockpit"] = raw.get("cockpit")
    if raw.get("cockpit") is not None:
        from .cockpit import check_cockpit
        check_cockpit(raw["cockpit"], path)
    info["ground"] = raw.get("ground_points")
    if raw.get("ground_points") is not None:
        check_ground_points(raw["ground_points"], path)
    if raw.get("drivetrain") is not None:
        from .layout import check_drivetrain
        check_drivetrain(raw["drivetrain"], path)
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
    if cfg.get("arb") and cfg.get("spring"):
        t["arb_fos"] = [float(cfg["members"].get("sf_target") or 2.0), None]
    if (cfg.get("wheel") or {}).get("caliper"):
        t["caliper_rim_margin"] = [float((cfg.get("clearance") or {}).get("caliper_margin", 3.0)), None]
    hs = cfg.get("halfshaft") if cfg["axle"] == "rear" else None
    if hs:
        t.update(cond["halfshaft"])
        for key, metric in (("cv_angle_max_in", "hs_cv_in_max"), ("cv_angle_max_out", "hs_cv_out_max"), ("plunge_max", "hs_plunge")):
            if hs.get(key) is not None:
                t[metric] = [None, float(hs[key])]
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
