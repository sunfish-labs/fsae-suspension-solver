"""Vehicle layout and drivetrain: what sits where, what it weighs, and how the car accelerates in a straight line.

Layout (the car file's "layout" block): components, each {name, mass (kg), at: [x, y, z] (its CG, mm), size: [l, w, h]
(mm, for its inertia as a solid box, and for drawing and the clearance check), group (optional, e.g. "drivetrain"),
solid (default true; false for mass spread over the car, like the frame or the wiring: it counts for the totals and
the inertia but isn't drawn or checked for clearance)}. Coordinates are the car
frame the 3D view and the CAD export ("solver" origin) use: the front corner's own X, Y right, Z up from the ground; the
rear axle sits one wheelbase behind the front contact patch. The four wheel assemblies (unsprung mass) come from the
corners: spring.unsprung_mass each, at the wheel centers.
    total mass, CG (x, y, z), front and left weight shares, roll / pitch / yaw inertia about the CG (kg m^2)
With layout.apply true, the car's vehicle.mass, weight_front and cg_height are taken from the layout instead of typed.

Drivetrain (the car file's "drivetrain" block), straight-line only, rear-wheel drive:
    torque_curve [[rpm, N m], ...] (engine or motor), redline (rpm, default the curve's last point), primary (ratio,
    engine to gearbox), gears [ratios], final (ratio, gearbox to wheels: rear sprocket / front sprocket), efficiency,
    shift_time (s, no drive while shifting), mass_factor (the spinning parts as extra mass; 1.05 = 5 %), drag_area
    (Cd A, m^2), rolling (coefficient), launch_rpm (the clutch slips below it: the engine gives its torque there).
    Wheel force = torque x primary x gear x final x efficiency / tire radius, capped by the rear tires' grip:
    mu (vehicle.tire_mu) x the rear load, which grows with acceleration: F_z,rear = m g (1 - weight_front) + m a h / L.
    The car accelerates from rest over the 75 m acceleration event, shifting at the redline.
    Results: the time and speed at 75 m, top speed in each gear at the redline, where each shift happens, how far
    the car is grip-limited, and the drag-limited top speed."""
from __future__ import annotations

import math

import numpy as np

from .errors import ConfigError

G = 9.81
DRIVE_DEFAULTS = dict(primary=1.0, efficiency=0.9, shift_time=0.08, mass_factor=1.05, drag_area=0.9, rolling=0.015,
                      air_density=1.2, distance=75.0)


def _num(v, pos=True):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and (v > 0 if pos else True)


def check_layout(lay, where="layout"):
    if not isinstance(lay, dict) or not isinstance(lay.get("components"), list):
        raise ConfigError(f"{where}: layout needs a components list")
    for i, c in enumerate(lay["components"]):
        nm = c.get("name") or f"#{i + 1}"
        if not _num(c.get("mass")):
            raise ConfigError(f"{where}: layout component {nm} needs a positive mass (kg)")
        if not (isinstance(c.get("at"), list) and len(c["at"]) == 3 and all(_num(v, False) for v in c["at"])):
            raise ConfigError(f"{where}: layout component {nm} needs at: [x, y, z] (mm)")
        if c.get("solid") is not None and not isinstance(c["solid"], bool):
            raise ConfigError(f"{where}: layout component {nm}: solid must be true or false")
        if c.get("size") is not None and not (isinstance(c["size"], list) and len(c["size"]) == 3 and all(_num(v) for v in c["size"])):
            raise ConfigError(f"{where}: layout component {nm}: size must be [length, width, height] in mm, all positive")


def check_drivetrain(d, where="drivetrain"):
    tc = d.get("torque_curve")
    if not (isinstance(tc, list) and len(tc) >= 2 and all(isinstance(p, list) and len(p) == 2 and _num(p[0]) and _num(p[1], False) and p[1] >= 0 for p in tc)):
        raise ConfigError(f"{where}: drivetrain.torque_curve needs at least two [rpm, N m] points")
    if any(b[0] <= a[0] for a, b in zip(tc, tc[1:])):
        raise ConfigError(f"{where}: drivetrain.torque_curve rpm must increase")
    if not (isinstance(d.get("gears"), list) and d["gears"] and all(_num(g) for g in d["gears"])):
        raise ConfigError(f"{where}: drivetrain.gears needs one or more positive ratios")
    if not _num(d.get("final")):
        raise ConfigError(f"{where}: drivetrain.final needs a positive ratio (rear sprocket / front sprocket)")
    for k in ("primary", "efficiency", "shift_time", "mass_factor", "drag_area", "rolling", "redline", "launch_rpm", "distance", "top_speed_need"):
        v = d.get(k)
        if v is None:
            continue
        strict = k in ("primary", "efficiency", "mass_factor", "redline", "launch_rpm", "distance", "top_speed_need")
        if not _num(v, False) or v < 0 or (strict and v == 0):
            raise ConfigError(f"{where}: drivetrain.{k} must be a {'positive' if strict else 'non-negative'} number")
    if d.get("efficiency") is not None and d["efficiency"] > 1:
        raise ConfigError(f"{where}: drivetrain.efficiency is a fraction (0.9 = 90 %)")


def wheels(fcfg, rcfg, wheelbase):
    """The four wheel assemblies as point masses at the wheel centers: [(name, mass, [x, y, z])]."""
    out = []
    for cfg, ax in ((fcfg, "front"), (rcfg, "rear")):
        cp = cfg["hardpoints"]["contact_patch"]
        x = fcfg["hardpoints"]["contact_patch"][0] - (wheelbase if ax == "rear" else 0.0)
        R = float(cfg["wheel"].get("tire_radius") or 254.0)
        m = float((cfg.get("spring") or {}).get("unsprung_mass") or 0.0)
        for side, s in (("right", 1), ("left", -1)):
            out.append((f"{ax} {side} wheel", m, [x, s * float(cp[1]), R]))
    return out


def layout_mass(lay, fcfg, rcfg, wheelbase):
    """Totals for the layout plus the four wheel assemblies: mass, CG, weight shares, inertias about the CG."""
    items = [(c.get("name") or "", float(c["mass"]), [float(v) for v in c["at"]], c.get("size")) for c in lay["components"]]
    items += [(n, m, p, None) for n, m, p in wheels(fcfg, rcfg, wheelbase) if m > 0]
    M = sum(m for _, m, _, _ in items)
    if M <= 0:
        raise ConfigError("layout: the total mass is zero")
    cg = np.sum([m * np.array(p) for _, m, p, _ in items], axis=0) / M
    xf = float(fcfg["hardpoints"]["contact_patch"][0])
    wf = 1.0 - (xf - cg[0]) / wheelbase                    # front share from the CG's distance behind the front axle
    yf = float(fcfg["hardpoints"]["contact_patch"][1])
    left = 0.5 - cg[1] / (2 * yf) if yf else 0.5            # left share (Y right), between the front contact patches
    Ixx = Iyy = Izz = 0.0
    for _, m, p, size in items:
        d = (np.array(p) - cg) / 1000.0
        lx, ly, lz = ([float(v) / 1000.0 for v in size] if size else (0.0, 0.0, 0.0))
        Ixx += m * (ly * ly + lz * lz) / 12 + m * (d[1] ** 2 + d[2] ** 2)
        Iyy += m * (lx * lx + lz * lz) / 12 + m * (d[0] ** 2 + d[2] ** 2)
        Izz += m * (lx * lx + ly * ly) / 12 + m * (d[0] ** 2 + d[1] ** 2)
    unsprung = sum(m for n, m, _, _ in items if n.endswith(" wheel"))
    return dict(mass=M, cg=[float(v) for v in cg], weight_front=float(wf), weight_left=float(left), cg_height=float(cg[2]),
                Ixx=float(Ixx), Iyy=float(Iyy), Izz=float(Izz), sprung=M - unsprung, unsprung=unsprung, n=len(lay["components"]),
                groups=_groups(lay))


def _groups(lay):
    g = {}
    for c in lay["components"]:
        k = c.get("group") or "other"
        g[k] = g.get(k, 0.0) + float(c["mass"])
    return g


def apply_layout(raw_vehicle, lay_res):
    """The vehicle block with mass, weight_front and cg_height from the layout."""
    v = dict(raw_vehicle or {})
    v.update(mass=round(lay_res["mass"], 6), weight_front=round(lay_res["weight_front"], 9), cg_height=round(lay_res["cg_height"], 6))
    return v


def _torque(tc, rpm):
    rp = [p[0] for p in tc]
    return float(np.interp(rpm, rp, [p[1] for p in tc], left=tc[0][1], right=0.0))


def accel_run(d, veh, tire_radius, wheelbase, dt=1e-3):
    """Straight-line run from rest (see the module notes). veh: the vehicle block (mass, weight_front, cg_height,
    tire_mu). Returns the time and speed at the event distance, gear table, shifts and the speed trace."""
    d = dict(DRIVE_DEFAULTS, **{k: v for k, v in d.items() if v is not None})
    tc = d["torque_curve"]
    red = float(d.get("redline") or tc[-1][0])
    launch = float(d.get("launch_rpm") or tc[0][0])
    m, wf, h, L = float(veh["mass"]), float(veh["weight_front"]), float(veh["cg_height"]) / 1000, wheelbase / 1000
    mu, R = float(veh.get("tire_mu") or 1.5), tire_radius / 1000
    me = m * d["mass_factor"]
    ratio = [d["primary"] * g * d["final"] for g in d["gears"]]
    top = [red * 2 * math.pi / 60 / r * R for r in ratio]                     # m/s at the redline in each gear

    def resist(v):
        return 0.5 * d["air_density"] * d["drag_area"] * v * v + d["rolling"] * m * G

    def drive(v, gi):
        rpm = max(v / R * ratio[gi] * 60 / (2 * math.pi), launch)
        return _torque(tc, min(rpm, red)) * ratio[gi] * d["efficiency"] / R

    def accel(v, gi):
        """(a, grip-limited?) at speed v in gear gi: the drive force, capped by the rear tires' grip, which rises with
        the load transfer onto the rear: F <= mu (m g (1 - wf) + m a h / L)."""
        F, D = drive(v, gi), resist(v)
        a = (F - D) / me
        cap_den = me - mu * m * h / L
        a_grip = (mu * m * G * (1 - wf) - D) / cap_den if cap_den > 0 else float("inf")
        return (a_grip, True) if a > a_grip else (a, False)

    t = x = v = 0.0
    gi, shift_left, step = 0, 0.0, 0
    grip_until = 0.0
    trace, shifts = [(0.0, 0.0, 0.0, 1)], []
    dist = d["distance"]
    while x < dist and t < 60:
        if shift_left > 0:
            a, lim = -resist(v) / me, False
            shift_left -= dt
        else:
            rpm = v / R * ratio[gi] * 60 / (2 * math.pi)
            if rpm >= red and gi < len(ratio) - 1:
                gi += 1
                shifts.append(dict(gear=gi + 1, t=t, x=x, v=v))
                shift_left = d["shift_time"]
                continue
            a, lim = accel(v, gi)
            if rpm >= red:                                     # top gear at the redline: hold the speed
                a = min(a, 0.0)
            if lim:
                grip_until = x
        v2 = max(0.0, v + a * dt)
        x2 = x + (v + v2) / 2 * dt
        if x2 >= dist:                                         # land exactly on the distance
            f = (dist - x) / (x2 - x) if x2 > x else 1.0
            t += f * dt
            v = v + (v2 - v) * f
            x = dist
            break
        t, x, v = t + dt, x2, v2
        step += 1
        if step % 20 == 0:
            trace.append((round(t, 3), round(x, 3), round(v, 4), gi + 1))
    trace.append((t, x, v, gi + 1))
    # drag-limited top speed in each gear: the speed where the drive force meets drag and rolling, up to the redline
    vmax = []
    for i in range(len(ratio)):
        lo, hi = 0.0, top[i]
        if drive(hi, i) >= resist(hi):
            vmax.append(top[i])
            continue
        for _ in range(60):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if drive(mid, i) > resist(mid) else (lo, mid)
        vmax.append(lo)
    return dict(time=t, speed=v, distance=dist, grip_limited_to=grip_until, shifts=shifts,
                gears=[dict(gear=i + 1, ratio=r, top_speed=top[i], max_speed=vmax[i]) for i, r in enumerate(ratio)],
                top_speed=max(vmax), trace=trace, mass=m, mu=mu,
                launch_accel=accel(0.0, 0)[0] / G, grip_accel=(mu * m * G * (1 - wf) - resist(0.0)) / (me - mu * m * h / L) / G
                if me > mu * m * h / L else float("inf"))


TOP_SPEED_NEED = 105.0     # km/h: D.12.2.2, endurance courses are laid out for top speeds of about 105 km/h


def gearing_sweep(d, veh, tire_radius, wheelbase, finals=None, need_kph=None):
    """The acceleration run (accel_run) for a range of final drives: 75 m time, speed at the line and the drag-limited
    top speed for each. Finals default to 75-125 % of the drivetrain's own in 11 steps. need_kph (default
    drivetrain.top_speed_need or 105 km/h, the endurance course's design top speed, D.12.2.2): a final whose top speed
    falls short of it would hit the rev limiter on the course. best: the quickest final that reaches it."""
    base = float(d["final"])
    finals = finals or [round(base * (0.75 + 0.05 * i), 4) for i in range(11)]
    need = float(need_kph or d.get("top_speed_need") or TOP_SPEED_NEED)
    rows = []
    for f in finals:
        r = accel_run(dict(d, final=f), veh, tire_radius, wheelbase)
        rows.append(dict(final=f, time=r["time"], speed=r["speed"], top_speed=r["top_speed"], shifts=len(r["shifts"]),
                         reaches=r["top_speed"] * 3.6 >= need - 1e-9))
    ok = [r for r in rows if r["reaches"]]
    best = min(ok or rows, key=lambda r: r["time"])
    cur = accel_run(d, veh, tire_radius, wheelbase)
    return dict(rows=rows, need_kph=need, best=best, current=dict(final=base, time=cur["time"], top_speed=cur["top_speed"]),
                gain=cur["time"] - best["time"])

