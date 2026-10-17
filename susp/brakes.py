"""Brake sizing: can the driver lock all four wheels (T.3.1.2 c, the Brake Test IN.14), and is the balance bar able to
reach the bias that locks both axles together.

Straight-line braking on the point of locking all four wheels at the tire's grip mu decelerates the car at mu g, and
moves load forward: front axle load Fz_f = m g wf + m (mu g) h / L, the rear the rest. Each axle then needs a brake
force mu Fz (no aero: the Brake Test runs at low speed). One wheel's brake torque per unit line pressure is
    k = 2 x pad_mu x (piston area on one side of the rotor) x (effective rotor radius)
(both pads clamp with the pistons' force; a floating caliper's single-sided pistons count once, the same as one
side of an opposed caliper). The balance bar splits the pedal's pushrod force (pedal force x pedal ratio) between
the front and rear master cylinders: front share = bias. So the pedal force that locks an axle is
    F = p_lock x A_mc / (share x pedal ratio),   p_lock = mu Fz R_tire / (n_calipers k)
and the car locks all four at the larger of the two. The bias that locks both together makes them equal.

Car file block `brake_system` (mm, N, bar):
  pedal_ratio, mc_front, mc_rear (master cylinder bores), bias (front share of the pushrod force, default 0.5),
  bias_range ([lo, hi] the balance bar can reach, default [0.35, 0.65]), caliper_front / caliper_rear (piston
  diameters on one side of the rotor, a list), rotor_front / rotor_rear (effective radius, pad center to axle),
  rear_calipers (2, or 1 for a single brake on the differential, T.3.1.5), pad_mu (default 0.40), tire_mu
  (default vehicle.tire_mu or 1.5), driver_force (the pedal force you design the lock-up for, default 450 N),
  max_pressure (bar, the lowest pressure any master cylinder, caliper or line takes without failing: its proof
  or burst rating, not the working pressure; optional)."""
from __future__ import annotations

import math

from .errors import ConfigError

G = 9.81
BRAKE_DEFAULTS = {"bias": 0.5, "bias_range": [0.35, 0.65], "rear_calipers": 2, "pad_mu": 0.40, "driver_force": 450.0}
PEDAL_RULE_FORCE = 2000.0          # T.3.2.2: the pedal and the system must take 2000 N


def check_brakes(b, where="brake_system"):
    if not isinstance(b, dict):
        raise ConfigError(f"{where}: brake_system must be an object (see the README)")
    for k in ("pedal_ratio", "mc_front", "mc_rear", "rotor_front", "rotor_rear"):
        v = b.get(k)
        if not (isinstance(v, (int, float)) and v > 0):
            raise ConfigError(f"{where}: brake_system.{k} must be a positive number")
    for k in ("caliper_front", "caliper_rear"):
        v = b.get(k)
        if not (isinstance(v, list) and v and all(isinstance(d, (int, float)) and d > 0 for d in v)):
            raise ConfigError(f"{where}: brake_system.{k} must list the piston diameters on one side of the rotor (mm)")
    for k in ("pad_mu", "tire_mu", "driver_force", "max_pressure"):
        v = b.get(k)
        if v is not None and not (isinstance(v, (int, float)) and v > 0):
            raise ConfigError(f"{where}: brake_system.{k} must be a positive number")
    bias = b.get("bias")
    if bias is not None and not (isinstance(bias, (int, float)) and 0 < bias < 1):
        raise ConfigError(f"{where}: brake_system.bias is the front share of the pedal force, between 0 and 1")
    rg = b.get("bias_range")
    if rg is not None and not (isinstance(rg, list) and len(rg) == 2 and all(isinstance(x, (int, float)) for x in rg)
                               and 0 < rg[0] < rg[1] < 1):
        raise ConfigError(f"{where}: brake_system.bias_range must be [lo, hi] with 0 < lo < hi < 1")
    if b.get("rear_calipers") not in (None, 1, 2):
        raise ConfigError(f"{where}: brake_system.rear_calipers must be 2 (one per wheel) or 1 (on the differential)")


def _area(d):
    return math.pi / 4 * d * d


def brake_sizing(b, veh, tire_radius, wheelbase):
    """The lock-up numbers for brake_system b with the vehicle block veh (mass, weight_front, cg_height, tire_mu),
    the tire radius and the wheelbase (mm). Pressures in bar (1 bar = 0.1 MPa)."""
    b = dict(BRAKE_DEFAULTS, **{k: v for k, v in b.items() if v is not None})
    m, wf, h, L = float(veh["mass"]), float(veh["weight_front"]), float(veh["cg_height"]), float(wheelbase)
    mu = float(b.get("tire_mu") or veh.get("tire_mu") or 1.5)
    W = m * G
    fz_f = W * wf + m * mu * G * h / L                   # N, at the lock-up deceleration mu g
    fz_r = W - fz_f
    R = float(tire_radius)
    ratio = float(b["pedal_ratio"])
    out = dict(tire_mu=mu, decel_g=mu, fz_front=fz_f, fz_rear=fz_r, ideal_front_share=fz_f / W)
    lock_push = {}                                       # pushrod force on each master cylinder that locks the axle, N
    k_ax = {}
    for ax, n in (("front", 2), ("rear", int(b["rear_calipers"]))):
        a_pist = sum(_area(d) for d in b[f"caliper_{ax}"])
        k = 2 * float(b["pad_mu"]) * a_pist * float(b[f"rotor_{ax}"])          # N mm per MPa, one caliper
        fz = fz_f if ax == "front" else fz_r
        p = mu * fz * R / (n * k)                                               # MPa
        a_mc = _area(float(b[f"mc_{ax}"]))
        lock_push[ax] = p * a_mc
        k_ax[ax] = n * k / a_mc / R            # axle brake force (N) per N of pushrod force on that master cylinder
        out[f"p_lock_{ax}"] = p * 10.0                                          # bar
    bias = float(b["bias"])
    f_f, f_r = lock_push["front"] / (bias * ratio), lock_push["rear"] / ((1 - bias) * ratio)
    out.update(bias=bias, pedal_lock_front=f_f, pedal_lock_rear=f_r, pedal_lock=max(f_f, f_r),
               first_lock="front" if f_f < f_r else "rear" if f_r < f_f else "both")
    bias_ideal = lock_push["front"] / (lock_push["front"] + lock_push["rear"])
    lo, hi = b["bias_range"]
    out.update(bias_ideal=bias_ideal, bias_range=[lo, hi], bias_ok=lo <= bias_ideal <= hi,
               pedal_lock_ideal=lock_push["front"] / (bias_ideal * ratio))
    # the brake force split the hardware gives at this balance-bar setting (before anything locks)
    bf, br = bias * k_ax["front"], (1 - bias) * k_ax["rear"]
    out["installed_front_share"] = bf / (bf + br)
    out["driver_force"] = float(b["driver_force"])
    out["lock_margin"] = out["driver_force"] - out["pedal_lock"]
    # T.3.2.2: line pressure with 2000 N on the pedal (the busier master cylinder)
    p2000 = max(bias / _area(float(b["mc_front"])), (1 - bias) / _area(float(b["mc_rear"]))) * PEDAL_RULE_FORCE * ratio * 10.0
    out["p_2000"] = p2000
    out["max_pressure"] = float(b["max_pressure"]) if b.get("max_pressure") else None
    out["pressure_margin"] = out["max_pressure"] - p2000 if out["max_pressure"] else None
    return out


def brake_rule_values(b, fcfg, rcfg):
    """Values for the rules engine from a car's brake_system block (None without one)."""
    if not b:
        return dict(brake_lock_margin=None, brake_bias_ok=None, brake_circuits=None, brake_pressure_margin=None, _brakes=None)
    veh = fcfg["vehicle"]
    r = brake_sizing(b, veh, float(rcfg["wheel"]["tire_radius"]), float(veh["wheelbase"]))
    lock = {"v": r["lock_margin"], "note": f"{r['pedal_lock']:.0f} N on the pedal locks all four at mu {r['tire_mu']:g} "
            f"({r['first_lock']} first), against {r['driver_force']:.0f} N"}
    bias = {"v": r["bias_ok"], "note": f"locks both axles together at {r['bias_ideal'] * 100:.0f} % front; the bar reaches "
            f"{r['bias_range'][0] * 100:.0f}-{r['bias_range'][1] * 100:.0f} %"}
    press = ({"v": r["pressure_margin"], "note": f"{r['p_2000']:.0f} bar at 2000 N, parts take {r['max_pressure']:.0f} bar"}
             if r["max_pressure"] else {"manual": f"{r['p_2000']:.0f} bar in the lines at 2000 N on the pedal: enter "
                                                    "brake_system.max_pressure, the lowest proof or burst pressure of the master cylinders, calipers and lines"})
    return dict(brake_lock_margin=lock, brake_bias_ok=bias, brake_circuits={"v": True, "note": "a front and a rear master cylinder"},
                brake_pressure_margin=press, _brakes=r)
