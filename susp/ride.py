"""Pushrod/pullrod + rocker + damper geometry, motion ratio, ride rates, and whole-car roll balance."""
from __future__ import annotations

import math

import numpy as np

from .kinematics import SolveError, rodrigues, unit

G = 9.81


class Spring:
    """Spring/damper actuation for one corner.

    The rod (pushrod or pullrod - geometry decides) attaches to the lower arm, upper arm or upright at
    rod_outboard. With a rocker it drives the rocker about rocker_axis through rocker_pivot, and the damper runs
    from rocker_damper to damper_chassis. Without rocker_* keys the damper runs straight from rod_outboard to
    damper_chassis (direct acting)."""

    def __init__(self, susp, sc):
        self.s = susp
        self.sc = sc
        h = susp.h
        def A(k):
            return np.array(sc[k], float)
        self.on = sc["rod_on"]
        self.p0 = A("rod_outboard")
        self.dch = A("damper_chassis")
        self.direct = sc.get("rocker_pivot") is None
        if self.on == "lower":
            self.piv, self.bj_i = (h["lif"], h["lir"]), 1
        elif self.on == "upper":
            self.piv, self.bj_i = (h["uif"], h["uir"]), 0
        if not self.direct:
            self.c = A("rocker_pivot")
            self.k = unit(A("rocker_axis"))
            self.rr0 = A("rocker_rod")
            self.rd0 = A("rocker_damper")
            self.Lrod = float(np.linalg.norm(self.rr0 - self.p0))
        self.bj0 = susp.P0[self.bj_i] if self.on != "upright" else None

    def arm_rotation(self, x):
        """Rotation matrix and axis point of the arm carrying the rod, for upright state x."""
        P, _ = self.s._unpack(x)
        a, b = self.piv
        u = unit(b - a)
        v0, v1 = self.bj0 - a, P[self.bj_i] - a
        v0, v1 = v0 - (v0 @ u) * u, v1 - (v1 @ u) * u
        ang = math.atan2(u @ np.cross(v0, v1), v0 @ v1)
        return rodrigues(u * ang), a

    def rod_out(self, x):
        if self.on == "upright":
            return self.s.move(x, self.p0)
        Rm, a = self.arm_rotation(x)
        return a + Rm @ (self.p0 - a)

    def rocker_at(self, th):
        Rm = rodrigues(self.k * th)
        return self.c + Rm @ (self.rr0 - self.c), self.c + Rm @ (self.rd0 - self.c)

    def state(self, x, th0=0.0):
        p = self.rod_out(x)
        if self.direct:
            return dict(rod_out=p, rod_in=self.dch, damper_out=p, damper_len=float(np.linalg.norm(p - self.dch)),
                        rocker_deg=0.0)
        def f(th):
            return float(np.linalg.norm(self.rocker_at(th)[0] - p)) - self.Lrod
        th = th0
        for _ in range(50):
            r = f(th)
            if abs(r) < 1e-10:
                break
            d = (f(th + 1e-7) - r) / 1e-7
            if abs(d) < 1e-12:
                raise SolveError("Rocker is at a toggle point (the rod points through the pivot). Move rocker_rod.")
            th -= max(-0.2, min(0.2, r / d))
        else:
            raise SolveError("Rocker position could not be solved - the rod cannot reach the rocker in this position.")
        rr, rd = self.rocker_at(th)
        return dict(rod_out=p, rod_in=rr, damper_out=rd, damper_len=float(np.linalg.norm(rd - self.dch)),
                    rocker_deg=math.degrees(th))

    def static(self):
        """Static member geometry: rod ends and damper ends at ride height."""
        st = self.state(np.zeros(6))
        return st


def _perp(v, k):
    return v - (v @ k) * k


def _angle_to_arm(arm, force, k):
    """Angle between a link and the rocker arm it drives, in the rocker plane (90 deg = best leverage)."""
    a, f = _perp(arm, k), _perp(force, k)
    na, nf = np.linalg.norm(a), np.linalg.norm(f)
    if na < 1e-9 or nf < 1e-9:
        return 0.0
    return math.degrees(math.acos(min(1.0, abs(a @ f) / (na * nf))))


def transmission_angles(sp, st):
    """(rod-to-rocker-arm, damper-to-rocker-arm) angles in degrees for one state."""
    c = sp.c
    return (_angle_to_arm(st["rod_in"] - c, st["rod_in"] - st["rod_out"], sp.k),
            _angle_to_arm(st["damper_out"] - c, sp.dch - st["damper_out"], sp.k))


def ride_metrics(cfg, susp, sp, rows):
    """Motion ratio over the heave sweep, wheel/ride rate, ride frequency, damper use, spring sizing."""
    sc = cfg["spring"]
    veh = cfg["vehicle"]
    zs = np.array([r["dz"] for r in rows])
    th = 0.0
    i0 = int(np.argmin(np.abs(zs)))
    # walk out from ride height so the rocker stays on the same branch
    order = list(range(i0, len(rows))) + list(range(i0 - 1, -1, -1))
    res = [None] * len(rows)
    for i in order:
        if i == i0 - 1:
            th = res[i0]["rocker_deg"] * math.pi / 180
        st = sp.state(rows[i]["_x"], th)
        th = math.radians(st["rocker_deg"])
        res[i] = st
    sts = res
    L = np.array([s["damper_len"] for s in sts])
    mr = -np.gradient(L, zs, edge_order=2)                   # damper compression per mm of bump
    for r, s, m_ in zip(rows, sts, mr):
        r["damper_len"], r["motion_ratio"], r["rocker_deg"] = s["damper_len"], float(m_), s["rocker_deg"]
    MR = float(mr[i0])
    k_s = float(sc["spring_rate"])
    k_t = float(sc["tire_rate"])
    share = veh["weight_front"] if cfg["axle"] == "front" else 1 - veh["weight_front"]
    m_corner = veh["mass"] * share / 2
    m_s = m_corner - sc["unsprung_mass"]
    k_w = k_s * MR ** 2
    k_r = k_w * k_t / (k_w + k_t)
    f = math.sqrt(k_r * 1000 / m_s) / (2 * math.pi)
    out = dict(motion_ratio=MR, mr_progression=float((mr[-1] - mr[0]) / MR * 100),
               wheel_rate=k_w, ride_rate=k_r, ride_freq=f,
               hop_freq=math.sqrt((k_w + k_t) * 1000 / sc["unsprung_mass"]) / (2 * math.pi),
               damper_used=float(L.max() - L.min()), rocker_rot=float(max(s["rocker_deg"] for s in sts)
                                                                     - min(s["rocker_deg"] for s in sts)),
               static_spring_force=m_s * G / MR if MR > 1e-6 else float("nan"),
               _m_sprung=m_s, _m_corner=m_corner, _damper_len0=float(L[i0]),
               _wheel_travel_per_stroke=(sc["damper_stroke"] / MR) if sc.get("damper_stroke") and MR > 1e-6 else None)
    if sc.get("damper_stroke"):
        out["damper_margin"] = float(sc["damper_stroke"]) - out["damper_used"]
        e2e = sc.get("damper_eye_to_eye")
        if e2e:
            closed = float(e2e) - float(sc["damper_stroke"])
            out["damper_topout"] = float(e2e) - float(L.max())       # room before full extension (droop)
            out["damper_bottomout"] = float(L.min()) - closed          # room before full compression (bump)
            out["damper_static_pos"] = (float(e2e) - float(L[i0])) / float(sc["damper_stroke"]) * 100
    # geometry quality over the travel
    [s["rod_out"] for s in sts]
    e = sts[i0]["rod_in"] - sts[i0]["rod_out"]
    out["rod_angle"] = math.degrees(math.atan2(abs(e[2]), math.hypot(e[0], e[1])))
    if not sp.direct:
        ta = [transmission_angles(sp, st) for st in sts]
        for r, (a1, a2) in zip(rows, ta):
            r["trans_rod"], r["trans_damper"] = a1, a2
        out["trans_min"] = float(min(min(a) for a in ta))
        out["_trans_rod"] = (min(a[0] for a in ta), max(a[0] for a in ta))
        out["_trans_damper"] = (min(a[1] for a in ta), max(a[1] for a in ta))
        out["_arm_rod"] = float(np.linalg.norm(_perp(sp.rr0 - sp.c, sp.k)))
        out["_arm_damper"] = float(np.linalg.norm(_perp(sp.rd0 - sp.c, sp.k)))
    out["_damper_len_range"] = (float(L.min()), float(L[i0]), float(L.max()))
    tf = sc.get("target_freq_hz")
    if tf:
        k_r_t = m_s * (2 * math.pi * tf) ** 2 / 1000
        if k_r_t < k_t:
            k_w_t = k_r_t * k_t / (k_t - k_r_t)
            out["spring_for_target"] = k_w_t / MR ** 2
        else:
            out["spring_for_target"] = float("nan")      # tire alone is softer than the target
    if MR < 1e-6:
        raise SolveError("Motion ratio is zero - the damper does not move with the wheel. Check the spring geometry.")
    out.update(damping(sc, MR, k_w, k_r, k_t, m_s))
    aero = veh.get("aero_front" if cfg["axle"] == "front" else "aero_rear")
    if aero:
        out.update(aero_sag(float(aero) / 2, zs, mr, k_s, k_t, m_s, i0))
    return out


def aero_sag(F, zs, mr, k_s, k_t, m_s, i0):
    """Downforce F (N on this wheel): the wheel travel where the spring has taken F (integrating the wheel rate
    k_s MR(z)^2 up the bump side of the sweep), the ride-height loss (that travel plus the tire's F / k_t), and the
    ride frequency there. The mass doesn't change, so the frequency moves only with the motion ratio's progression."""
    z_up = [float(z) for z in zs[i0:]]
    kw = [k_s * float(m) ** 2 for m in mr[i0:]]
    force, z_at, kw_at = 0.0, z_up[-1], kw[-1]
    for j in range(1, len(z_up)):
        df = (kw[j - 1] + kw[j]) / 2 * (z_up[j] - z_up[j - 1])
        if force + df >= F:
            t = (F - force) / df if df > 0 else 0.0
            z_at = z_up[j - 1] + t * (z_up[j] - z_up[j - 1])
            kw_at = kw[j - 1] + t * (kw[j] - kw[j - 1])
            break
        force += df
    k_r = kw_at * k_t / (kw_at + k_t)
    return dict(aero_sag=z_at + F / k_t, ride_freq_aero=math.sqrt(k_r * 1000 / m_s) / (2 * math.pi), _aero_travel=z_at)


def damping(sc, MR, k_w, k_r, k_t, m_s):
    """Critical damping and damping ratios. A damper coefficient c (N per m/s at the shaft) acts at the wheel as
    c * MR^2. Body (sprung-mass) mode: c_crit = 2 sqrt(k_ride m_sprung). Wheel-hop mode: 2 sqrt((k_wheel + k_tire)
    m_unsprung). Low-speed damping controls the body; high-speed damping handles bumps and the wheel."""
    m_u = float(sc["unsprung_mass"])
    c_crit = 2 * math.sqrt(k_r * 1000 * m_s)
    c_hop = 2 * math.sqrt((k_w + k_t) * 1000 * m_u)
    out = dict(c_crit=c_crit, c_crit_hop=c_hop)
    zl, zh = float(sc.get("target_zeta_low") or 0.7), float(sc.get("target_zeta_high") or 0.35)
    out["damper_c_low_target"] = zl * c_crit / MR ** 2
    out["damper_c_high_target"] = zh * c_crit / MR ** 2
    for key, name in (("damper_bump_low", "zeta_bump_low"), ("damper_rebound_low", "zeta_rebound_low"),
                      ("damper_bump_high", "zeta_bump_high"), ("damper_rebound_high", "zeta_rebound_high")):
        if sc.get(key):
            out[name] = float(sc[key]) * MR ** 2 / c_crit
    if sc.get("damper_bump_high"):
        out["zeta_hop"] = float(sc["damper_bump_high"]) * MR ** 2 / c_hop
    return out


# --------------------------------------------------------------------------- #
#  Whole-car roll balance (front + rear configs)
# --------------------------------------------------------------------------- #


from .car import CAR_TARGETS, car_balance  # noqa: E402,F401 - re-exported (older code imports them from here)
