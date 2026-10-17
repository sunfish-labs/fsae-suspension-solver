"""Whole-car roll balance: roll gradient, lateral load transfer distribution (LLTD), ride frequency split and the
anti-roll bars needed to hit the car targets."""
from __future__ import annotations

import math

from .schema import TARGETS_FILE

G = 9.81
CAR_TARGETS = TARGETS_FILE["car"]


def _series(a, b):
    return 1 / (1 / a + 1 / b) if a > 0 and b > 0 else 0.0


def axle_limit(mu, k, c, F0):
    """Lateral acceleration (g) where an axle saturates: its grip mu (2 F0 - 2 k dFz^2 / F0) with dFz = c ay (c: load
    transfer per wheel per g) equals the axle weight 2 F0 times ay. Once the inner wheel lifts (dFz = F0) the axle
    keeps mu (1 - k) of its weight."""
    q = mu * k * (c / F0) ** 2
    ay = mu if q < 1e-15 else (-1 + math.sqrt(1 + 4 * mu * q)) / (2 * q)
    if c * ay > F0:
        ay = mu * (1 - k)
    return ay


def flex_roll(A, a_front, Kf, Kr, gf, gr, Kc):
    """Roll with a frame of torsional stiffness Kc between the axles: the front of the body carries a_front of the
    sprung roll moment A, the rear the rest. Returns (roll gradient, frame twist phi_f - phi_r, E_f, E_r), the roll
    weighted by the moment split; with Kc -> infinity it is the rigid result."""
    import numpy as np
    Af, Ar = A * a_front, A * (1 - a_front)
    M = np.array([[Kf + Kc, -Kc], [-Kc, Kr + Kc]])
    pf, pr = np.linalg.solve(M, [Af + Kf * gf, Ar + Kr * gr])
    return float(a_front * pf + (1 - a_front) * pr), float(pf - pr), float(Kf * (pf - gf)), float(Kr * (pr - gr))


def car_balance(fcfg, fev, rcfg, rev, target_grad=None, target_lltd=None, arb_f=0.0, arb_r=0.0, targets=None):
    """Roll gradient, LLTD and the anti-roll stiffness needed. Steady-state, small angles; a rigid chassis unless
    vehicle.frame_k (Nm/deg, the frame's torsional stiffness between the axles) is given (see flex_roll).

    Each axle's roll stiffness is its springs (wheel rate) plus any anti-roll bar, in series with its tires:
    K = 1 / (1 / (K_springs + K_arb) + 1 / K_tires), with K_springs = wheel_rate * t^2 / 2. ARB rates are given
    at the wheels, in Nm per degree of body roll. A corner with an "arb" linkage block uses the bar stiffness worked out
    from its geometry instead of arb_f / arb_r.

    The body roll (relative to the ground) is the springs' share of the roll moment plus the tires squashing under
    the whole load transfer, including the part that reaches them through the roll centers and the unsprung mass:
    phi = (A + K_f g_f + K_r g_r) / (K_f + K_r), with A the sprung roll moment and g the tire roll from the geometric
    transfer alone. With rigid tires this is the textbook A / (K_f + K_r). Checked against a full-car stiffness model
    (validation/tools/full_car_model.py). roll_susp_f / _r is the roll across the springs only (damper pots).

    With vehicle.tire_load_sens (k) set, each tire's friction falls with load, mu = tire_mu (1 - k (Fz / Fz0 - 1)), so
    an axle's lateral grip is mu (2 Fz0 - 2 k dFz^2 / Fz0) for a load transfer dFz: the axle that transfers more load
    (relative to its static load) saturates first. Reports each axle's limit (g) and the front LLTD that makes them
    equal (with the same k front and rear)."""
    veh = fcfg["vehicle"]
    m, wf, h, WB = veh["mass"], veh["weight_front"], veh["cg_height"] / 1000, veh["wheelbase"] / 1000
    fr, rr = fev["ride"], rev["ride"]
    src_f, src_r = "input", "input"
    if fr.get("arb_roll") is not None:
        arb_f, src_f = fr["arb_roll"], "geometry"
    if rr.get("arb_roll") is not None:
        arb_r, src_r = rr["arb_roll"], "geometry"
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
    A = ms * G * d                              # sprung roll moment about the roll axis, per g
    Gf = msf * G * zrf + muf * G * Rf           # moment that reaches the front tires through the links (geometric)
    Gr = msr * G * zrr + mur * G * Rr
    gf, gr = Gf / Ktf, Gr / Ktr                 # tire roll that the geometric part alone causes, deg per g
    # body roll phi: each axle's springs and bars carry E = Ks (phi - tire roll), tire roll = (E + Geo) / Kt, so
    # E = K (phi - g) with K the springs and tires in series; E_f + E_r = A
    grad = (A + Kf * gf + Kr * gr) / (Kf + Kr)  # deg per g, body relative to the ground
    Ef, Er = Kf * (grad - gf), Kr * (grad - gr)
    dF, dR = (Ef + Gf) / tf, (Er + Gr) / tr
    lltd = dF * tf / (dF * tf + dR * tr)    # share of the total lateral load transfer moment at the front
    lltd_rigid, twist = lltd, 0.0
    Kc = veh.get("frame_k")
    if Kc:
        # a frame that twists: the front and rear of the body roll by phi_f and phi_r, the sprung roll moment split by
        # the sprung mass at each end, the frame (Kc, Nm/deg) carrying Kc (phi_f - phi_r) from one end to the other
        Kc = float(Kc)
        lltd_rigid = lltd
        grad, twist, Ef, Er = flex_roll(A, msf / ms, Kf, Kr, gf, gr, Kc)
        dF, dR = (Ef + Gf) / tf, (Er + Gr) / tr
        lltd = dF * tf / (dF * tf + dR * tr)
    out = dict(ms=ms, hs=hs * 1000, z_ra=z_ra * 1000, arm=d * 1000, Kf=Kf, Kr=Kr, Ksf=Ksf, Ksr=Ksr, Ktf=Ktf, Ktr=Ktr,
               arb_in_f=arb_f, arb_in_r=arb_r, arb_src_f=src_f, arb_src_r=src_r, grad=grad, lltd=lltd,
               K_warp=Kf * Kr / (Kf + Kr) if Kf + Kr > 0 else 0.0,  # twist test on corner scales (see validation/)
               roll_susp_f=Ef / (Ksf + arb_f) if Ksf + arb_f > 0 else float("nan"),
               roll_susp_r=Er / (Ksr + arb_r) if Ksr + arb_r > 0 else float("nan"),
               freq_f=fr["ride_freq"], freq_r=rr["ride_freq"], wf=wf, dFz_f=dF, dFz_r=dR, rc_f=zrf * 1000, rc_r=zrr * 1000,
               geo_f=Gf / tf, geo_r=Gr / tr, frame_k=float(Kc) if Kc else None, lltd_rigid=lltd_rigid, frame_twist=twist)
    if Kc:
        # how stiff the frame is next to the suspension, and how much of a bar change still reaches the balance
        out["frame_ratio"] = Kc / (Kf + Kr)
        def lltd_with(dk, kc):
            Kf2 = _series(Ksf + arb_f + dk, Ktf)
            if kc is None:
                g2 = (A + Kf2 * gf + Kr * gr) / (Kf2 + Kr)
                e_f, e_r = Kf2 * (g2 - gf), Kr * (g2 - gr)
            else:
                _, _, e_f, e_r = flex_roll(A, msf / ms, Kf2, Kr, gf, gr, kc)
            a_, b_ = (e_f + Gf) / tf, (e_r + Gr) / tr
            return a_ * tf / (a_ * tf + b_ * tr)
        d_r = lltd_with(10.0, None) - lltd_with(0.0, None)
        d_f = lltd_with(10.0, Kc) - lltd_with(0.0, Kc)
        out["frame_bar_effect"] = d_f / d_r if abs(d_r) > 1e-12 else 1.0
    # tire load sensitivity: each axle's lateral limit, and the LLTD that saturates both axles together
    ks = veh.get("tire_load_sens")
    if ks is not None:
        mu = float(veh.get("tire_mu") or 1.5)
        F0f, F0r = m * wf * G / 2, m * (1 - wf) * G / 2
        out.update(tire_mu=mu, tire_load_sens=float(ks), ay_lim_f=axle_limit(mu, float(ks), dF, F0f),
                   ay_lim_r=axle_limit(mu, float(ks), dR, F0r))
        out["limit_balance"] = out["ay_lim_r"] - out["ay_lim_f"]       # + : the front lets go first (understeer)
        out["grip_loss_f"] = (1 - out["ay_lim_f"] / mu) * 100
        out["grip_loss_r"] = (1 - out["ay_lim_r"] / mu) * 100
        # dF / F0f = dR / F0r with dF tf + dR tr = m g h (always): LLTD = tf F0f / (tf F0f + tr F0r)
        out["lltd_neutral"] = tf * F0f / (tf * F0f + tr * F0r)
    tg = target_grad if target_grad else 1.0
    tl = target_lltd if target_lltd else wf + 0.05
    # bars for a target gradient and LLTD: the front must carry M_f = tl (A + Gf + Gr), so its springs and bars carry
    # Ef* = M_f - Gf and the rear Er* = A - Ef*; then K = E* / (tg - g) for each axle
    lam = (tl * (A + Gf + Gr) - Gf) / A if abs(A) > 1e-9 else float("nan")    # front share of the elastic moment
    lam_c = min(1.0, max(0.0, lam))
    Efn, Ern = lam_c * A, (1 - lam_c) * A

    def need(E, g):
        return E / (tg - g) if tg > g else float("inf")           # the tires alone already roll more than that
    Kfn, Krn = need(Efn, gf), need(Ern, gr)
    K_need = Kfn + Krn

    def bar_for(K_axle, Ks, Kt):              # total bar (at the wheels) that gives this axle stiffness
        if K_axle >= Kt:
            return float("inf")              # the tires alone are softer than that
        return 1 / (1 / K_axle - 1 / Kt) - Ks
    out.update(target_grad=tg, target_lltd=tl, K_need=K_need, lam=lam, lam_c=lam_c,
               arb_f=bar_for(Kfn, Ksf, Ktf), arb_r=bar_for(Krn, Ksr, Ktr))
    # balance-only fix: keep the rear as is and change the front bar (or the reverse) until LLTD hits its target.
    # With the other axle's K fixed, E = K (A + K_o (g_o - g)) / (K + K_o); solve E = E* for K.
    lam0 = Ef / A if abs(A) > 1e-9 else 0.5
    if lam_c > lam0 + 1e-9 and lam_c < 1:
        den = A + Kr * (gr - gf) - Efn
        if den > 0:
            out["lltd_fix"] = ("front", bar_for(Efn * Kr / den, Ksf, Ktf) - arb_f)
    elif lam_c < lam0 - 1e-9 and lam_c > 0:
        den = A + Kf * (gf - gr) - Ern
        if den > 0:
            out["lltd_fix"] = ("rear", bar_for(Ern * Kf / den, Ksr, Ktr) - arb_r)
    # car-level targets
    t = dict(CAR_TARGETS, **(targets or {}))
    vals = {"roll_gradient": grad, "lltd_vs_weight": (lltd - wf) * 100, "freq_ratio": rr["ride_freq"] / fr["ride_freq"]}
    out["checks"] = [dict(key=k, value=vals[k], lo=t[k][0], hi=t[k][1],
                          status="PASS" if (t[k][0] is None or vals[k] >= t[k][0]) and (t[k][1] is None or vals[k] <= t[k][1]) else "FAIL")
                     for k in ("roll_gradient", "lltd_vs_weight", "freq_ratio")]
    return out
