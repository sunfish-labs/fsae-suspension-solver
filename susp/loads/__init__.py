"""Quasi-static load cases -> forces in the wishbone legs, tie rod, pushrod, damper and rocker.

Members are pin-ended (rod ends / spherical bearings). The upright is in equilibrium under the tire force and
the link forces. The wishbone carrying the pushrod is solved as one rigid body: its ball-joint force comes first,
the moment about its pivot axis gives the pushrod force, and the pivot reactions follow the real load path; any
load the legs carry across themselves is reported as the arm's bending load (zero when the pushrod mounts at
the ball-joint node).

    cases.py       the tire forces for each case
    statics.py     member forces (upright and rigid arm), geometry at ride height or deflected
    strength.py    buckling, yield, rod ends, bolts, pushrod-mount bending
    compliance.py  toe and camber change from link stretch"""
from __future__ import annotations

from ..kinematics import SolveError, travel_range
from ..ride import spring_nonlinear, wheel_travel_under
from .cases import G, load_cases
from .compliance import IMPACT_CASES, compliance, link_stiffness
from .statics import MEMBER_LABEL, MEMBERS, _geometry, arm_reactions, member_label, solve_case, solve_FM, wheel_rate_at_ride
from .strength import BOLT_UTS, bending_check, member_checks, part_checks, tube_props

__all__ = ["G", "load_cases", "IMPACT_CASES", "compliance", "link_stiffness", "MEMBER_LABEL", "MEMBERS", "_geometry",
           "arm_reactions", "member_label", "solve_case", "solve_FM", "wheel_rate_at_ride", "BOLT_UTS", "bending_check",
           "member_checks", "part_checks", "tube_props", "run_loads"]


def run_loads(cfg, susp, sp, lltd=None):
    """Every load case. The bump and pothole cases are also solved where the wheel actually is under that load:
    raised by (load - static load) / wheel rate, capped at full bump ("bump (deflected)", "pothole (deflected)").
    lltd: the car's front LLTD from the whole-car balance (see load_cases)."""
    cases, info = load_cases(cfg, susp, lltd)
    res, desc, tire, fz, deflect = {}, {}, {}, {}, {}
    geom0 = _geometry(susp, sp)
    k_w = wheel_rate_at_ride(cfg, susp, sp)
    travel = travel_range(cfg)[1]                       # full bump
    extra = []
    for name, forces, d, parts in cases:
        if name in ("bump", "pothole") and k_w > 1e-9:
            Fz = float(sum(f for f, _ in forces)[2])
            if spring_nonlinear(cfg["spring"]):          # dual-rate spring or bump stop: integrate the rate curve
                dz = wheel_travel_under(cfg, susp, sp, Fz - info["Fz0"], travel)
            else:
                dz = min(travel, max(0.0, (Fz - info["Fz0"]) / k_w))
            if dz > 0.05:
                extra.append((f"{name} (deflected)", forces, f"{d}, solved at +{dz:.1f} mm of wheel travel"
                              + (" (full bump)" if dz >= travel else ""), parts, dz))
    for name, forces, d, parts, dz in [c + (0.0,) for c in cases] + extra:
        try:
            geom = _geometry(susp, sp, dz) if dz else geom0
        except SolveError:
            continue                                   # the wheel can't reach that travel: keep the ride-height case only
        res[name] = solve_case(susp, sp, forces, geom)
        desc[name], fz[name] = d, parts
        tire[name] = sum(f for f, _ in forces)
        if dz:
            deflect[name] = dz
    info["wheel_rate"] = k_w
    checks = member_checks(cfg, susp, sp, res)
    return dict(results=res, desc=desc, tire=tire, fz_parts=fz, Fz0=info["Fz0"], info=info, deflect=deflect,
                checks=checks, parts=part_checks(cfg, checks), bending_check=bending_check(cfg, susp, sp, res, deflect),
                compliance=compliance(cfg, susp, sp, res))
