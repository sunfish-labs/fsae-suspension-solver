"""Brackets and fatigue: the pickup tabs (static), and a fatigue screen at stated cycle counts of the tubes, the welds
at their ends, the tab welds and the leg that carries the pushrod mount.

Tabs (one pair per link end, double shear, all the size in members.tab): against the worst |force| of any case,
    bearing      F / (n t d)                  vs yield
    tear-out     F / (n 2 t (e - d / 2))      vs 0.577 yield   (the bolt shearing out to the tab's edge, two planes)
    net section  F / (n t (W - d))            vs yield
    weld throat  F / (n L_w 0.707 leg)        vs 0.577 yield   (the fillet weld that holds the tab to the frame)
n tabs of thickness t, width W, hole d (members.bolt_dia), edge distance e from the hole's center. A simplified
lug check: it leaves out the hole's stress concentration (fine for ductile steel under static load).

Fatigue (a screen at a stated number of cycles, not a life prediction): each driving case is taken as a load that
repeats, from the car at rest (static corner weight, ride height) to that case and back, loads.fatigue_cycles times
(default 100,000: a season has roughly 10,000 hard corners and stops; this covers about three seasons with margin).
The bump case uses its deflected geometry when there is one and repeats loads.fatigue_bump_cycles times (default
10,000); the impact cases (pothole, curb strike) are one-offs and are left out. The swings between opposite cases are
counted too, loads.fatigue_cycles times each: a wheel is the outer one in a left turn and the inner one in a right turn
(corner outer ↔ inner, brake+corner outer ↔ inner), and the rear goes from braking to accelerating.
  - tube (base metal away from welds): modified Goodman, 1 / n = s_a / S_f + s_m / S_ut (s_m < 0: n = S_f / s_a).
    S_f is the strength at N cycles on the Shigley S-N line from 0.9 S_ut at 1000 cycles to the endurance limit
    S_e = k_a k_b k_c 0.5 S_ut at a million (surface k_a = a S_ut^b; axial k_b = 1, k_c = 0.85; bending
    k_b = 1.24 d^-0.107, k_c = 1); S_f = S_e from a million cycles on.
  - welds (tube ends, tab throats): the stress range against the weld's fatigue class (IIW: FAT = the stress range
    a weld survives 2 million times; slope 3 below that, flat from 10 million cycles at 0.585 FAT). Weld fatigue
    ignores the mean stress (residual stresses near the weld are near yield anyway).
n = allowed stress / applied stress at that cycle count; n >= members.fatigue_sf passes. Each row also gives the
cycles to a crack that its stress range alone would allow ("life", infinite under the endurance or weld limit). The
loads are the design g levels, so this is conservative; logged loads from the car make it exact."""
from __future__ import annotations

import math

import numpy as np

from ..errors import ConfigError
from .statics import MEMBERS, _geometry, solve_case
from .strength import gusset_of, leg_stress, rod_leg, tube_props

SURFACE = {"ground": (1.58, -0.085), "machined": (4.51, -0.265), "cold-drawn": (4.51, -0.265),
           "hot-rolled": (57.7, -0.718), "as-forged": (272.0, -0.995)}
TAB_DEFAULT = {"thickness": 3.175, "width": 25.4, "edge": 12.7, "weld_leg": 3.0, "weld_length": 50.0, "count": 2}
IMPACT = ("pothole", "curb strike")
CAFL = (2e6 / 1e7) ** (1 / 3)          # IIW: constant-amplitude fatigue limit at 1e7 cycles, as a fraction of FAT
SIZE = {"upper_front": "wishbone", "upper_rear": "wishbone", "lower_front": "wishbone", "lower_rear": "wishbone",
        "tie_rod": "tie_rod", "pushrod": "pushrod"}


def gusset_fat(g):
    """IIW fatigue class of the weld where a gusset welded along a member ends (longitudinal attachment), by the
    gusset's length along the member: 80 up to 50 mm, 71 to 150, 63 to 300, 50 beyond; members.gusset.fat overrides."""
    if g.get("fat"):
        return float(g["fat"])
    L = g["length_in"] + g["length_out"]
    return 80.0 if L <= 50 else 71.0 if L <= 150 else 63.0 if L <= 300 else 50.0


def tab_of(mem):
    tab = dict(TAB_DEFAULT, **(mem.get("tab") or {}))
    d = float(mem.get("bolt_dia") or 8.0)
    if tab["edge"] <= d / 2:
        raise ConfigError(f"members.tab.edge ({tab['edge']:g} mm) must be more than half the bolt ({d / 2:g} mm)")
    if tab["width"] <= d:
        raise ConfigError(f"members.tab.width ({tab['width']:g} mm) must be more than the bolt ({d:g} mm)")
    return tab, d


def endurance(mem, bending_od=None):
    """Endurance limit S_e (MPa) and its factors, axial (default) or bending of a tube of that OD."""
    sut = float(mem.get("uts") or 670.0)
    se0 = 0.5 * sut if sut <= 1400 else 700.0
    a, b = SURFACE.get(str(mem.get("surface") or "machined"), SURFACE["machined"])
    ka = a * sut ** b
    if bending_od:
        kb = 1.24 * bending_od ** -0.107 if bending_od <= 51 else 1.51 * bending_od ** -0.157
        kc = 1.0
    else:
        kb, kc = 1.0, 0.85
    return ka * kb * kc * se0, dict(sut=sut, se0=se0, ka=ka, kb=kb, kc=kc)


def sn_strength(se, sut, N, f=0.9):
    """Fully reversed strength at N cycles: the S-N line from f S_ut at 1e3 to S_e at 1e6 (Shigley), S_e beyond."""
    if N >= 1e6:
        return se
    N = max(N, 1e3)
    b = -math.log10(f * sut / se) / 3
    return (f * sut) ** 2 / se * N ** b


def sn_life(se, sut, sa, sm, f=0.9):
    """Cycles to a crack for amplitude sa and mean sm (Goodman-equivalent reversed stress on the same S-N line)."""
    sar = sa / (1 - sm / sut) if sm > 0 else sa
    if sm >= sut or sar >= f * sut:
        return 1e3
    if sar <= se:
        return float("inf")
    b = -math.log10(f * sut / se) / 3
    return (sar / ((f * sut) ** 2 / se)) ** (1 / b)


def weld_allow(fat, N):
    """IIW: the stress range a weld of class FAT survives N times (slope 3, flat from 1e7 cycles)."""
    return fat * (2e6 / max(N, 1e4)) ** (1 / 3) if N < 1e7 else CAFL * fat


def weld_life(fat, rng):
    if rng <= CAFL * fat:
        return float("inf")
    return 2e6 * (fat / rng) ** 3


def goodman(sa, sm, se, sut):
    if sa <= 1e-9:
        return float("inf")
    return se / sa if sm < 0 else 1.0 / (sa / se + sm / sut)


def ends(sp):
    """Link ends that sit on a pair of tabs: [(key in the member results, label key)]."""
    out = [(k, k) for k in MEMBERS] + [("damper", "damper")]
    if not sp.direct:
        out.append(("rocker_pivot", "rocker_pivot"))
    return out


REST = "at rest"
SWINGS = (("corner outer", "corner inner"), ("brake+corner outer", "brake+corner inner"), ("braking", "acceleration"))


def cycle_cases(results):
    names = [n for n in results if not any(n.startswith(i) for i in IMPACT)]
    if "bump (deflected)" in names:
        names = [n for n in names if n != "bump"]
    return names


def swings(results):
    """The load cycles screened: [(case, the case it swings back to)], each driving case from rest and back, then
    the swings between opposite cases (left and right turns, braking and accelerating)."""
    cyc = cycle_cases(results)
    return [(c, REST) for c in cyc] + [(a, b) for a, b in SWINGS if a in results and b in results]


def durability(cfg, susp, sp, results, info, deflect=None):
    """Tab checks and the fatigue screen. results: member forces per case (run_loads), info: its info dict."""
    deflect = deflect or {}
    mem = cfg["members"]
    tab, d = tab_of(mem)
    n, t, W, e = int(tab["count"]), float(tab["thickness"]), float(tab["width"]), float(tab["edge"])
    leg_, Lw = float(tab["weld_leg"]), float(tab["weld_length"])
    sy = float(mem.get("tab_yield") or mem["yield"])
    geom0 = _geometry(susp, sp)
    static = solve_case(susp, sp, [(np.array([0.0, 0.0, info["Fz0"]]), "cp")], geom0)
    # ---- tabs, static
    tabs = []
    for key, _ in ends(sp):
        F, case = max((abs(float(r[key])), name) for name, r in results.items())
        st = dict(bearing=F / (n * t * d), tearout=F / (n * 2 * t * (e - d / 2)), net=F / (n * t * (W - d)),
                  weld=F / (n * Lw * 0.707 * leg_))
        fos = dict(bearing=sy / st["bearing"], tearout=0.577 * sy / st["tearout"], net=sy / st["net"],
                   weld=0.577 * sy / st["weld"]) if F > 1e-9 else dict.fromkeys(st, float("inf"))
        gov = min(fos, key=fos.get)
        tabs.append(dict(member=key, force=F, case=case, stress=st, fos=fos, governs=gov, sf=fos[gov]))
    # ---- fatigue screen
    cyc = cycle_cases(results)
    Lc = cfg.get("loads") or {}
    n_drive, n_bump = float(Lc.get("fatigue_cycles") or 1e5), float(Lc.get("fatigue_bump_cycles") or 1e4)
    fat_tube, fat_tab = float(mem.get("weld_fat_tube") or 45.0), float(mem.get("weld_fat_tab") or 36.0)
    se_ax, fac_ax = endurance(mem)
    sut = fac_ax["sut"]
    rows = []

    def cycles(c):
        return n_bump if c.startswith("bump") else n_drive

    sw = swings(results)

    def worst(label, kind, base, stress):
        """base: S_e (tube) or FAT (weld); stress(case name or REST) -> stress there. Lowest n governs."""
        best = None
        for c, c2 in sw:
            sc, ss = stress(c), stress(c2)
            sa, sm = abs(sc - ss) / 2, (sc + ss) / 2
            N = cycles(c) if c2 == REST else n_drive
            if c2 != REST:
                c = f"{c} ↔ {c2}"
            if kind == "weld":
                allow, life = weld_allow(base, N), weld_life(base, 2 * sa)
                nn = allow / (2 * sa) if sa > 1e-9 else float("inf")
            else:
                allow, life = sn_strength(base, sut, N), sn_life(base, sut, sa, sm)
                nn = goodman(sa, sm, allow, sut)
            if best is None or nn < best["n"]:
                best = dict(item=label, kind=kind, case=c, cycles=N, s_a=sa, s_m=sm, allow=allow, n=nn, life=life)
        rows.append(best)

    for k in MEMBERS:
        A, _ = tube_props(*mem[SIZE[k]])
        def per(c, k=k, A=A):
            return float((static if c == REST else results[c])[k]) / A
        worst(k, "tube", se_ax, per)
        worst(k, "weld", fat_tube, per)
    for key, _ in ends(sp):
        th = n * Lw * 0.707 * leg_
        def per_tab(c, key=key, th=th):                 # rocker_pivot is a magnitude: a range from rest all the same
            return float((static if c == REST else results[c])[key]) / th
        worst(f"tab:{key}", "weld", fat_tab, per_tab)
    if sp.on in ("lower", "upper"):
        leg = rod_leg(susp, sp)[0]
        od = float(mem["wishbone"][0])
        se_b, _ = endurance(mem, bending_od=od)
        s_rest = leg_stress(cfg, leg, static, geom0)["stress"]
        def per_leg(c):
            if c == REST:
                return s_rest
            g = _geometry(susp, sp, deflect[c]) if deflect.get(c) else geom0
            return leg_stress(cfg, leg, results[c], g)["stress"]
        worst(f"leg:{leg}", "tube", se_b, per_leg)
        g = gusset_of(cfg)
        if g is not None and g["type"] == "along_leg":
            # the weld toe where the gusset stops on the tube: the bare tube's stress there, IIW longitudinal attachment
            def per_end(c):
                if c == REST:
                    return leg_stress(cfg, leg, static, geom0)["end_stress"] or 0.0
                gg = _geometry(susp, sp, deflect[c]) if deflect.get(c) else geom0
                return leg_stress(cfg, leg, results[c], gg)["end_stress"] or 0.0
            if leg_stress(cfg, leg, static, geom0)["end_stress"] is not None:
                worst(f"gusset:{leg}", "weld", gusset_fat(g), per_end)
    sf_fat = float(mem.get("fatigue_sf") or 1.5)
    for r in rows:
        r["ok"] = r["n"] >= sf_fat
    return dict(tabs=tabs, tab=tab, bolt=d, tab_yield=sy, static=static, cycle_cases=cyc, swings=sw, fatigue=rows, cycles=n_drive,
                bump_cycles=n_bump,
                fatigue_sf=sf_fat, endurance=dict(se_axial=se_ax, **fac_ax), weld_fat_tube=fat_tube, weld_fat_tab=fat_tab,
                tab_sf_min=min(r["sf"] for r in tabs), fatigue_n_min=min(r["n"] for r in rows))
