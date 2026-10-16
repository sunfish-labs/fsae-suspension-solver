"""Whole-car roll balance: roll gradient, lateral load transfer distribution (LLTD), ride frequency split and the
anti-roll bars needed to hit the car targets."""
from __future__ import annotations

import math

from .schema import TARGETS_FILE

G = 9.81
CAR_TARGETS = TARGETS_FILE["car"]


def _series(a, b):
    return 1 / (1 / a + 1 / b) if a > 0 and b > 0 else 0.0


def car_balance(fcfg, fev, rcfg, rev, target_grad=None, target_lltd=None, arb_f=0.0, arb_r=0.0, targets=None):
    """Roll gradient, LLTD and the anti-roll stiffness needed. Steady-state, rigid chassis, small angles.

    Each axle's roll stiffness is its springs (wheel rate) plus any anti-roll bar, in series with its tires:
    K = 1 / (1 / (K_springs + K_arb) + 1 / K_tires), with K_springs = wheel_rate * t^2 / 2. ARB rates are given
    at the wheels, in Nm per degree of body roll."""
    veh = fcfg["vehicle"]
    m, wf, h, WB = veh["mass"], veh["weight_front"], veh["cg_height"] / 1000, veh["wheelbase"] / 1000
    fr, rr = fev["ride"], rev["ride"]
    muf, mur = 2 * fcfg["spring"]["unsprung_mass"], 2 * rcfg["spring"]["unsprung_mass"]
    Rf, Rr = fev["susp"].R / 1000, rev["susp"].R / 1000
    tf, tr = fev["susp"].track / 1000, rev["susp"].track / 1000
    ms = m - muf - mur
    msf, msr = m * wf - muf, m * (1 - wf) - mur
    hs = (m * h - muf * Rf - mur * Rr) / ms
    zrf, zrr = fev["metrics"]["roll_center"] / 1000, rev["metrics"]["roll_center"] / 1000
    a_s = WB * msr / ms                         # front axle to sprung CG
    z_ra = zrf + (zrr - zrf) * a_s / WB
    d = hs - z_ra                               # roll moment arm
    deg = math.pi / 180
    def roll_k(k_nmm, t):
        return k_nmm * 1000 * t ** 2 / 2 * deg       # N/mm per wheel -> Nm/deg for the axle
    Ksf, Ksr = roll_k(fr["wheel_rate"], tf), roll_k(rr["wheel_rate"], tr)
    Ktf, Ktr = roll_k(fcfg["spring"]["tire_rate"], tf), roll_k(rcfg["spring"]["tire_rate"], tr)
    Kf, Kr = _series(Ksf + arb_f, Ktf), _series(Ksr + arb_r, Ktr)
    grad = ms * G * d / (Kf + Kr)               # deg per g

    def transfer(lam):
        dF = (ms * G * d * lam + msf * G * zrf + muf * G * Rf) / tf
        dR = (ms * G * d * (1 - lam) + msr * G * zrr + mur * G * Rr) / tr
        return dF, dR
    dF, dR = transfer(Kf / (Kf + Kr))
    lltd = dF * tf / (dF * tf + dR * tr)    # share of the total lateral load transfer moment at the front
    out = dict(ms=ms, hs=hs * 1000, z_ra=z_ra * 1000, arm=d * 1000, Kf=Kf, Kr=Kr, Ksf=Ksf, Ksr=Ksr, Ktf=Ktf, Ktr=Ktr,
               arb_in_f=arb_f, arb_in_r=arb_r, grad=grad, lltd=lltd,
               freq_f=fr["ride_freq"], freq_r=rr["ride_freq"], wf=wf, dFz_f=dF, dFz_r=dR, rc_f=zrf * 1000, rc_r=zrr * 1000,
               geo_f=(msf * G * zrf + muf * G * Rf) / tf, geo_r=(msr * G * zrr + mur * G * Rr) / tr)
    tg = target_grad if target_grad else 1.0
    tl = target_lltd if target_lltd else wf + 0.05
    K_need = ms * G * d / tg
    # LLTD (front share of total moment) is linear in the elastic split lam
    a_ = ms * G * d
    b_, e_ = msf * G * zrf + muf * G * Rf, msr * G * zrr + mur * G * Rr
    # front moment = a lam + b ; rear moment = a (1 - lam) + e ; share = (a lam + b) / (a + b + e)
    lam = (tl * (a_ + b_ + e_) - b_) / a_ if abs(a_) > 1e-9 else float("nan")
    lam_c = min(1.0, max(0.0, lam))

    def bar_for(K_axle, Ks, Kt):              # total bar (at the wheels) that gives this axle stiffness
        if K_axle >= Kt:
            return float("inf")              # the tires alone are softer than that
        return 1 / (1 / K_axle - 1 / Kt) - Ks
    out.update(target_grad=tg, target_lltd=tl, K_need=K_need, lam=lam, lam_c=lam_c,
               arb_f=bar_for(lam_c * K_need, Ksf, Ktf), arb_r=bar_for((1 - lam_c) * K_need, Ksr, Ktr))
    # balance-only fix: keep the rear as is and change the front bar (or the reverse) until LLTD hits its target
    lam0 = Kf / (Kf + Kr)
    if lam_c > lam0 + 1e-9 and lam_c < 1:
        out["lltd_fix"] = ("front", bar_for(lam_c / (1 - lam_c) * Kr, Ksf, Ktf) - arb_f)
    elif lam_c < lam0 - 1e-9 and lam_c > 0:
        out["lltd_fix"] = ("rear", bar_for((1 - lam_c) / lam_c * Kf, Ksr, Ktr) - arb_r)
    # car-level targets
    t = dict(CAR_TARGETS, **(targets or {}))
    vals = {"roll_gradient": grad, "lltd_vs_weight": (lltd - wf) * 100, "freq_ratio": rr["ride_freq"] / fr["ride_freq"]}
    out["checks"] = [dict(key=k, value=vals[k], lo=t[k][0], hi=t[k][1],
                          status="PASS" if (t[k][0] is None or vals[k] >= t[k][0]) and (t[k][1] is None or vals[k] <= t[k][1]) else "FAIL")
                     for k in ("roll_gradient", "lltd_vs_weight", "freq_ratio")]
    return out
