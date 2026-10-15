"""Config schema, defaults, targets, templates and input sanity checks."""
from __future__ import annotations

import copy
import json
import math
import os

import numpy as np

from .errors import ConfigError

HP = {  # json key -> short name used internally
    "upper_inboard_front": "uif", "upper_inboard_rear": "uir",
    "lower_inboard_front": "lif", "lower_inboard_rear": "lir",
    "upper_outboard": "ubj", "lower_outboard": "lbj",
    "trackrod_inboard": "tri", "trackrod_outboard": "tro",
    "contact_patch": "cp",
}
SHORT2LONG = {v: k for k, v in HP.items()}
HP_ORDER = list(HP)

DEFAULTS = {
    "name": "untitled",
    "axle": "front",  # "front" or "rear"
    "wheel": {"camber_deg": -1.0, "toe_deg": 0.0, "tire_radius": 254.0,
              "tire_width": 190.5, "rim_diameter_in": 13.0},
    "vehicle": {"wheelbase": 1700.0, "track": None,  # track None -> 2 x contact patch Y
                "cg_height": 300.0, "front_brake_share": 0.5,
                "brakes": "outboard",   # "outboard" (at the upright) or "inboard" (on the chassis)
                "drive": "inboard",     # rear only: "inboard" (chassis-mounted diff) or "outboard"
                "mass": 280.0,          # whole car incl. driver, kg
                "weight_front": 0.46,   # fraction of the weight on the front axle
                "rack_c_factor": None}, # rack mm per steering-wheel revolution (optional)
    "sweep": {"travel": 30.0, "steps": 41, "rack_travel": 35.0, "rack_steps": 14,
              "ackermann_at_outer_deg": 15.0, "roll_deg": 2.0, "roll_steps": 9},
    "clearance": {"wishbone_tube_od": 25.4, "tie_rod_od": 16.0, "pushrod_od": 15.9, "damper_od": 55.0,
                  "margin": 5.0},
    "rack_direction": [0.0, 1.0, 0.0],
    "targets": {},
    "targets_file": None,   # optional shared team targets JSON, path relative to this design file
    # optional blocks (None = not used):
    "spring": None,
    "loads": {"bump_g": 3.0, "corner_g": 1.6, "brake_g": 1.6, "combined_g": 1.2, "accel_g": 1.0,
              "lltd_front": None,
              "pothole_g": 4.0,     # impact: vertical load as a multiple of the static wheel load
              "kerb_g": 2.0,        # impact: sideways load on the wheel (pushing it inboard), multiple of static load
              "brake_split": "bias"},  # "bias": braking force shared by vehicle.front_brake_share; "grip": Fx = g x Fz
    "members": {"material": "4130 chromoly steel, normalized (yield is lower next to welds)",
                "wishbone": [15.875, 0.889], "tie_rod": [15.875, 0.889], "pushrod": [15.875, 0.889],
                "E": 205000.0, "yield": 435.0, "sf_target": 2.0,
                "rod_end_rating": None,      # N, the rod end's catalog radial static (ultimate) rating; None = not checked
                "bolt_dia": 7.94,            # mm, bolt through each rod end / spherical bearing (7.94 = 5/16 in)
                "bolt_grade": "SAE 8",       # 8.8, 10.9, 12.9, SAE 5 or SAE 8
                "bolt_shear_planes": 2,      # 2 = double shear (clevis), 1 = single shear
                # compliance (estimates - measure your own parts if you can):
                "rod_end_k": 40000.0,        # N/mm, axial stiffness of one rod end or spherical bearing (each link has two)
                "mount_k": 20000.0,          # N/mm, chassis tab or bracket at the inboard end of each link
                "toe_comp_limit": 0.15,      # deg, largest acceptable toe change from compliance (cornering, braking, accel)
                "camber_comp_limit": 0.25},  # deg, largest acceptable camber change from compliance (same cases)
}

SPRING_DEFAULTS = {
    "rod_on": "lower",          # pushrod/pullrod mounted on "lower" arm, "upper" arm or "upright"
    "rod_outboard": None,       # [x, y, z] where the rod attaches to the arm/upright
    "rocker_pivot": None,       # omit the rocker_* keys for a direct-acting damper
    "rocker_axis": None,        # direction of the rocker pivot bolt
    "rocker_rod": None,         # rod end on the rocker
    "rocker_damper": None,      # damper end on the rocker
    "damper_chassis": None,     # damper end on the chassis
    "spring_rate": 35.0,        # N/mm
    "damper_stroke": None,      # mm, optional - checks stroke used over the heave sweep
    "damper_eye_to_eye": None,  # mm, fully extended length, optional - checks top-out / bottom-out and sag
    "unsprung_mass": 11.0,      # kg per corner
    "tire_rate": 110.0,         # N/mm vertical tire stiffness - check your tire data
    "target_freq_hz": None,     # optional: report the spring rate that gives this ride frequency
    # damping (optional): damper coefficients at the damper shaft, N per m/s, from the damper dyno chart
    "damper_bump_low": None,    # bump (compression), low-speed slope (shaft speed below the knee)
    "damper_bump_high": None,   # bump, high-speed slope (above the knee)
    "damper_rebound_low": None,
    "damper_rebound_high": None,
    "damper_knee": 50.0,        # mm/s shaft speed where low-speed turns into high-speed
    "target_zeta_low": 0.7,     # damping-ratio targets used for the suggested damper rates
    "target_zeta_high": 0.35,
}
DAMPER_KEYS = ("damper_bump_low", "damper_bump_high", "damper_rebound_low", "damper_rebound_high")

SPRING_POINTS = ("rod_outboard", "rocker_pivot", "rocker_axis", "rocker_rod", "rocker_damper", "damper_chassis")

METRICS = {  # key: (label, unit, decimals)
    "camber": ("Static camber", "deg", 2), "toe": ("Static toe (+ = in)", "deg", 3),
    "caster": ("Caster", "deg", 2), "kpi": ("KPI", "deg", 2),
    "scrub": ("Scrub radius", "mm", 1), "trail": ("Mechanical trail", "mm", 1),
    "roll_center": ("Roll center (ride ht)", "mm", 1), "fvsa": ("Front-view swing arm", "mm", 0),
    "camber_gain": ("Camber gain", "deg/in", 3), "bump_steer": ("Bump steer (+ = in)", "deg/in", 3),
    "bump_steer_max": ("Max |toe change|", "deg", 3),
    "bump_steer_curve": ("Toe curvature (avg of ends, + = in)", "deg", 3), "track_change": ("Track change", "mm", 2),
    "antidive": ("Anti-dive", "%", 1), "antisquat": ("Anti-squat", "%", 1),
    "antilift": ("Anti-lift", "%", 1), "ackermann": ("Ackermann", "%", 0),
    "clearance_min": ("Min link clearance", "mm", 1), "clearance_margin": ("Clearance margin (worst pair)", "mm", 1), "rim_margin": ("Rim radial margin", "mm", 1),
    "roll_camber": ("Roll camber (outer, to ground)", "deg/deg", 3),
    "roll_camber_max": ("Outer camber to ground at max roll", "deg", 2),
    "rc_lat": ("Roll center lateral shift", "mm/deg", 1),
    "rc_height_roll": ("Roll center height at max roll", "mm", 1),
    "roll_steer": ("Roll steer (outer, + = in)", "deg/deg", 3),
    "turn_radius": ("Turning radius (outer front wheel)", "m", 2),
    "steer_arm": ("Steering arm length", "mm", 1),
    "motion_ratio": ("Motion ratio (damper/wheel)", "", 3),
    "mr_progression": ("Motion ratio change over travel", "%", 1),
    "wheel_rate": ("Wheel rate", "N/mm", 1), "ride_rate": ("Ride rate (with tire)", "N/mm", 1),
    "ride_freq": ("Ride frequency", "Hz", 2), "spring_for_target": ("Spring rate for target freq", "N/mm", 1),
    "c_crit": ("Critical damping at the wheel (body)", "N s/m", 0), "c_crit_hop": ("Critical damping at the wheel (wheel hop)", "N s/m", 0),
    "zeta_bump_low": ("Damping ratio, bump low-speed", "", 2), "zeta_rebound_low": ("Damping ratio, rebound low-speed", "", 2),
    "zeta_bump_high": ("Damping ratio, bump high-speed", "", 2), "zeta_rebound_high": ("Damping ratio, rebound high-speed", "", 2),
    "zeta_hop": ("Wheel-hop damping ratio (bump high-speed)", "", 2),
    "damper_c_low_target": ("Damper rate for the low-speed target", "N s/m", 0), "damper_c_high_target": ("Damper rate for the high-speed target", "N s/m", 0),
    "damper_used": ("Damper stroke used", "mm", 1), "damper_margin": ("Damper stroke left", "mm", 1),
    "rocker_rot": ("Rocker rotation over travel", "deg", 1),
    "static_spring_force": ("Spring force at ride height", "N", 0),
    "damper_topout": ("Damper room to full extension (droop)", "mm", 1),
    "damper_bottomout": ("Damper room to full compression (bump)", "mm", 1),
    "damper_static_pos": ("Damper compressed at ride height", "% stroke", 0),
    "trans_min": ("Worst rocker transmission angle", "deg", 0),
    "rod_angle": ("Pushrod angle from horizontal", "deg", 0),
}

METRIC_HELP = {
    "camber": "Wheel lean at ride height. Negative = top leans in. Sets static grip; tune with static camber shims.",
    "camber_gain": "How much camber changes per inch of bump. Controlled by front-view swing arm (FVSA): longer FVSA = less gain.",
    "caster": "Kingpin tilt seen from the side. More caster = more self-centring and camber gain while steering, heavier steering.",
    "kpi": "Kingpin inclination seen from the front. Drives scrub radius and steering-induced camber/jacking.",
    "scrub": "Distance from the steering axis ground point to the contact patch (+ = axis meets ground inboard). Large = kickback and heavy steering.",
    "trail": "Distance from the steering axis ground point to the contact patch along X. Gives self-centring torque.",
    "toe": "Static toe. + = toe-in. Front usually slight toe-out, rear slight toe-in.",
    "roll_center": "Height of the roll center above ground. Higher = more load transfer through links, less body roll; big swings hurt consistency.",
    "fvsa": "Front-view swing arm length. Sets camber gain and where the roll center moves in heave.",
    "bump_steer": "Toe change per inch of bump (+ = toe-in). Should be near 0. Fixed with tie-rod inboard/outboard heights.",
    "bump_steer_max": "Largest toe change anywhere in the sweep. Catches curved toe traces that a slope hides.",
    "bump_steer_curve": "Curved (U-shaped) part of the toe trace: toe at full bump and full droop averaged. Comes from tie-rod "
                        "LENGTH/angle (move trackrod_inboard.y); the slope part comes from tie-rod HEIGHT.",
    "track_change": "Sideways contact-patch movement over the sweep. Big = tire scrub and unpredictable grip.",
    "antidive": "Share of braking weight transfer taken through the links at the front. 0 = all through springs.",
    "antisquat": "Share of acceleration weight transfer taken through the links at the rear.",
    "antilift": "Rear equivalent of anti-dive: link share of braking transfer at the rear.",
    "ackermann": "How closely the steering matches the true-turning-geometry angle split. 0 = parallel steer, 100 = full Ackermann.",
    "clearance_min": "Smallest center-line distance between moving links (tie rod, pushrod, wishbone legs) over heave and steer.",
    "rim_margin": "Gap between the farthest hardpoint and the rim radius (radial only).",
    "roll_camber": "Camber change of the outer wheel relative to the GROUND per degree of body roll. 1.0 = wheel leans with the body "
                   "(no compensation, e.g. equal parallel arms); 0 = wheel stays at static camber. More camber gain lowers it.",
    "rc_lat": "How far the roll center moves sideways per degree of roll. Large values make the car's balance change through a corner.",
    "roll_steer": "Toe change of the outer wheel per degree of roll (+ = toe-in). Mostly bump steer seen through roll.",
    "motion_ratio": "Damper travel per unit wheel travel at ride height. Wheel rate = spring rate x MR^2.",
    "ride_freq": "Natural frequency of the sprung corner on its springs and tire. Sets how stiff the car feels; FSAE cars often run 2.5-4.5 Hz.",
    "turn_radius": "Path radius of the outer front wheel at full rack travel (kinematic, no slip). Must fit the tightest hairpin.",
    "trans_min": "Angle between the rod (or damper) and the rocker arm it acts on, worst case over travel. 90 deg = best "
                 "leverage; below ~45 deg the rocker approaches a toggle and the motion ratio changes quickly.",
    "damper_static_pos": "How far into its stroke the damper sits at ride height. With symmetric bump/droop travel you want "
                         "roughly 40-60 %.",
    "steer_arm": "Distance from the tie-rod outer joint to the steering axis. Short arm = high rack force and sensitive steering.",
}


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
GENERAL_TARGETS = {
    "front": {"camber": [-3.0, -0.5], "camber_gain": [0.2, 1.0], "caster": [3, 8], "kpi": [0, 9],
              "scrub": [0, 30], "trail": [5, 30], "toe": [-0.5, 0.25], "roll_center": [0, 75],
              "antidive": [0, 40], "ackermann": [0, 100], "bump_steer": [-0.05, 0.05], "bump_steer_max": [None, 0.10]},
    "rear": {"camber": [-3.0, -0.5], "camber_gain": [0.2, 1.0], "toe": [0.0, 0.5], "roll_center": [0, 100],
             "antisquat": [0, 60], "bump_steer": [-0.05, 0.05], "bump_steer_max": [None, 0.10]},
}


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
    if cfg.get("spring"):
        t["ride_freq"] = [2.5, 4.5]
        if cfg["spring"].get("damper_stroke"):
            t["damper_margin"] = [0.0, None]
            if cfg["spring"].get("damper_eye_to_eye"):
                t["damper_topout"] = [2.0, None]
                t["damper_bottomout"] = [2.0, None]
        if cfg["spring"].get("rocker_pivot") is not None:
            t["trans_min"] = [45.0, None]
        sp_ = cfg["spring"]
        if sp_.get("damper_bump_low") and sp_.get("damper_rebound_low"):     # body control (low-speed)
            t["zeta_bump_low"] = [0.4, 0.9]
            t["zeta_rebound_low"] = [0.5, 1.2]
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


# Templates: invented example geometry (also in designs/). Not any real team's car - replace with your own.
TEMPLATE_FRONT = {
    "name": "Example front (invented demo geometry)",
    "axle": "front",
    "wheel": {
        "camber_deg": -1.5,
        "toe_deg": 0.0,
        "tire_radius": 254.0,
        "tire_width": 190.5,
        "rim_diameter_in": 13.0
    },
    "vehicle": {
        "wheelbase": 1550.0,
        "track": None,
        "cg_height": 280.0,
        "front_brake_share": 0.6,
        "brakes": "outboard",
        "drive": "inboard",
        "mass": 275.0,
        "weight_front": 0.47,
        "rack_c_factor": None
    },
    "sweep": {
        "travel": 30.0,
        "steps": 41,
        "rack_travel": 35.0,
        "rack_steps": 14,
        "ackermann_at_outer_deg": 15.0,
        "roll_deg": 2.0,
        "roll_steps": 9
    },
    "clearance": {
        "wishbone_tube_od": 25.4,
        "tie_rod_od": 16.0,
        "pushrod_od": 15.9,
        "damper_od": 55.0,
        "margin": 5.0
    },
    "rack_direction": [
        0.0,
        1.0,
        0.0
    ],
    "targets": {},
    "spring": {
        "rod_on": "lower",
        "rod_outboard": [
            -5.0,
            545.0,
            150.0
        ],
        "rocker_pivot": [
            -5.0,
            205.0,
            380.0
        ],
        "rocker_axis": [
            1.0,
            0.0,
            0.0
        ],
        "rocker_rod": [
            -5.0,
            246.0,
            427.0
        ],
        "rocker_damper": [
            -5.0,
            201.9,
            459.6
        ],
        "damper_chassis": [
            -5.0,
            31.0,
            445.0
        ],
        "spring_rate": 45.0,
        "damper_stroke": 57.0,
        "damper_eye_to_eye": 200.0,
        "unsprung_mass": 11.0,
        "tire_rate": 110.0,
        "target_freq_hz": 3.5
    },
    "loads": {
        "bump_g": 3.0,
        "corner_g": 1.6,
        "brake_g": 1.6,
        "combined_g": 1.2,
        "accel_g": 1.0,
        "lltd_front": None
    },
    "members": {
        "material": "4130 chromoly steel, normalized (yield is lower next to welds)",
        "wishbone": [
            15.88,
            0.89
        ],
        "tie_rod": [
            15.88,
            0.89
        ],
        "pushrod": [
            15.88,
            0.89
        ],
        "E": 205000.0,
        "yield": 435.0,
        "sf_target": 2.0
    },
    "hardpoints": {
        "upper_inboard_front": [
            -230.0,
            258.3,
            324.9
        ],
        "upper_inboard_rear": [
            210.0,
            258.3,
            336.3
        ],
        "lower_inboard_front": [
            -230.0,
            200.0,
            142.4
        ],
        "lower_inboard_rear": [
            230.0,
            200.0,
            140.3
        ],
        "upper_outboard": [
            -15.0,
            562.0,
            345.0
        ],
        "lower_outboard": [
            5.0,
            580.0,
            135.0
        ],
        "trackrod_inboard": [
            -64.6,
            212.7,
            175.5
        ],
        "trackrod_outboard": [
            -60.0,
            568.6,
            173.7
        ],
        "contact_patch": [
            0.0,
            610.0,
            0.0
        ]
    }
}
TEMPLATE_REAR = {
    "name": "Example rear (invented demo geometry)",
    "axle": "rear",
    "wheel": {
        "camber_deg": -1.0,
        "toe_deg": 0.0,
        "tire_radius": 254.0,
        "tire_width": 190.5,
        "rim_diameter_in": 13.0
    },
    "vehicle": {
        "wheelbase": 1550.0,
        "track": None,
        "cg_height": 280.0,
        "front_brake_share": 0.6,
        "brakes": "outboard",
        "drive": "inboard",
        "mass": 275.0,
        "weight_front": 0.47,
        "rack_c_factor": None
    },
    "sweep": {
        "travel": 30.0,
        "steps": 41,
        "rack_travel": 35.0,
        "rack_steps": 14,
        "ackermann_at_outer_deg": 15.0,
        "roll_deg": 2.0,
        "roll_steps": 9
    },
    "clearance": {
        "wishbone_tube_od": 25.4,
        "tie_rod_od": 16.0,
        "pushrod_od": 15.9,
        "damper_od": 55.0,
        "margin": 5.0
    },
    "rack_direction": [
        0.0,
        1.0,
        0.0
    ],
    "targets": {},
    "spring": {
        "rod_on": "lower",
        "rod_outboard": [
            -5.0,
            545.0,
            150.0
        ],
        "rocker_pivot": [
            -5.0,
            205.0,
            380.0
        ],
        "rocker_axis": [
            1.0,
            0.0,
            0.0
        ],
        "rocker_rod": [
            -5.0,
            246.0,
            427.0
        ],
        "rocker_damper": [
            -5.0,
            201.9,
            459.6
        ],
        "damper_chassis": [
            -5.0,
            31.0,
            445.0
        ],
        "spring_rate": 55.0,
        "damper_stroke": 57.0,
        "damper_eye_to_eye": 200.0,
        "unsprung_mass": 11.0,
        "tire_rate": 110.0,
        "target_freq_hz": 3.7
    },
    "loads": {
        "bump_g": 3.0,
        "corner_g": 1.6,
        "brake_g": 1.6,
        "combined_g": 1.2,
        "accel_g": 1.0,
        "lltd_front": None
    },
    "members": {
        "material": "4130 chromoly steel, normalized (yield is lower next to welds)",
        "wishbone": [
            15.88,
            0.89
        ],
        "tie_rod": [
            15.88,
            0.89
        ],
        "pushrod": [
            15.88,
            0.89
        ],
        "E": 205000.0,
        "yield": 435.0,
        "sf_target": 2.0
    },
    "hardpoints": {
        "upper_inboard_front": [
            -230.0,
            258.3,
            323.3
        ],
        "upper_inboard_rear": [
            210.0,
            258.3,
            355.3
        ],
        "lower_inboard_front": [
            -230.0,
            200.0,
            149.9
        ],
        "lower_inboard_rear": [
            230.0,
            200.0,
            163.8
        ],
        "upper_outboard": [
            -15.0,
            562.0,
            345.0
        ],
        "lower_outboard": [
            5.0,
            580.0,
            135.0
        ],
        "trackrod_inboard": [
            -64.6,
            214.1,
            189.3
        ],
        "trackrod_outboard": [
            -60.0,
            567.5,
            173.7
        ],
        "contact_patch": [
            0.0,
            610.0,
            0.0
        ]
    }
}
