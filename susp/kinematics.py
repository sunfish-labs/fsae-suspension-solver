"""Rigid-link double-wishbone kinematics: solver, heave/roll/steer sweeps, packaging, summary metrics."""
from __future__ import annotations

import math

import numpy as np

from .config import HP, default_targets


from .errors import SolveError  # noqa: F401 - re-exported (older code imports it from here)


# --------------------------------------------------------------------------- #
#  Geometry helpers
# --------------------------------------------------------------------------- #
def skew(v):
    return np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])


def rodrigues(rv):
    th = float(np.linalg.norm(rv))
    if th < 1e-12:
        K = skew(rv)
        return np.eye(3) + K + 0.5 * (K @ K)
    K = skew(rv / th)
    return np.eye(3) + math.sin(th) * K + (1 - math.cos(th)) * (K @ K)


def unit(v):
    return v / np.linalg.norm(v)


def seg_dist(p1, q1, p2, q2):
    """Minimum distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection)."""
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1 @ d1, d2 @ d2, d2 @ r
    c, b = d1 @ r, d1 @ d2
    den = a * e - b * b
    s = np.clip((b * f - c * e) / den, 0, 1) if den > 1e-12 else 0.0
    t = (b * s + f) / e
    if t < 0:
        t, s = 0.0, np.clip(-c / a, 0, 1)
    elif t > 1:
        t, s = 1.0, np.clip((b - c) / a, 0, 1)
    return float(np.linalg.norm((p1 + d1 * s) - (p2 + d2 * t)))


def plane(p1, p2, p3):
    n = np.cross(p2 - p1, p3 - p1)
    n = n / np.linalg.norm(n)
    return n, float(n @ p1)


def line_intersect_2d(p1, d1, p2, d2):
    """Intersection of two 2D lines p + t d; None if parallel."""
    A = np.array([[d1[0], -d2[0]], [d1[1], -d2[1]]])
    if abs(np.linalg.det(A)) < 1e-12:
        return None
    t = np.linalg.solve(A, np.asarray(p2) - np.asarray(p1))[0]
    return np.asarray(p1) + t * np.asarray(d1)


# --------------------------------------------------------------------------- #
#  Solver
# --------------------------------------------------------------------------- #
class Suspension:
    """Rigid-link kinematics of one (right-hand) wheel. State x = [tx ty tz rx ry rz] of the upright."""

    def __init__(self, cfg):
        self.cfg = cfg
        h = {HP[k]: np.array(v, float) for k, v in cfg["hardpoints"].items()}
        self.h = h
        w, veh = cfg["wheel"], cfg["vehicle"]
        self.R = float(w["tire_radius"])
        self.WB = float(veh["wheelbase"])
        self.CG = float(veh["cg_height"])
        self.front_share = float(veh["front_brake_share"])
        self.track = float(veh["track"]) if veh.get("track") else 2 * h["cp"][1]
        self.axle = cfg["axle"]
        rd = np.array(cfg["rack_direction"], float)
        self.rack_dir = rd / np.linalg.norm(rd)

        g, toe = math.radians(w["camber_deg"]), math.radians(w["toe_deg"])
        a = np.array([math.sin(toe) * math.cos(g), math.cos(toe) * math.cos(g), -math.sin(g)])
        self.a0 = a / np.linalg.norm(a)
        up = np.array([0, 0, 1.0]) - self.a0[2] * self.a0
        up /= np.linalg.norm(up)
        self.cpz0 = h["cp"][2]
        self.c0 = h["cp"] + self.R * up                           # wheel center
        self.P0 = np.vstack([h["ubj"], h["lbj"], h["tro"], self.c0])
        self.ref = self.c0.copy()
        self.tri0 = h["tri"]
        self.L = np.array([np.linalg.norm(h["ubj"] - h["uif"]), np.linalg.norm(h["ubj"] - h["uir"]),
                           np.linalg.norm(h["lbj"] - h["lif"]), np.linalg.norm(h["lbj"] - h["lir"]),
                           np.linalg.norm(h["tro"] - h["tri"])])
        self.cpx0 = h["cp"][0]
        self._cache = {}

    # ---- kinematic core ---------------------------------------------------
    def transform(self, x):
        """(Rm, t): a static upright point p moves to (p - ref) @ Rm.T + ref + t."""
        return rodrigues(x[3:]), x[:3]

    def move(self, x, p):
        Rm, t = self.transform(x)
        return (np.asarray(p, float) - self.ref) @ Rm.T + self.ref + t

    def _unpack(self, x):
        Rm = rodrigues(x[3:])
        P = (self.P0 - self.ref) @ Rm.T + self.ref + x[:3]
        return P, Rm @ self.a0

    def _contact(self, P, a):
        up = np.array([0, 0, 1.0]) - a[2] * a
        up /= np.linalg.norm(up)
        return P[3] - self.R * up

    def _res(self, x, dz, rack):
        P, a = self._unpack(x)
        h = self.h
        tri = self.tri0 + rack * self.rack_dir
        cp = self._contact(P, a)
        return np.array([
            np.linalg.norm(P[0] - h["uif"]) - self.L[0], np.linalg.norm(P[0] - h["uir"]) - self.L[1],
            np.linalg.norm(P[1] - h["lif"]) - self.L[2], np.linalg.norm(P[1] - h["lir"]) - self.L[3],
            np.linalg.norm(P[2] - tri) - self.L[4], cp[2] - (self.cpz0 + dz)])

    def _newton(self, x, dz, rack, tol=1e-9, maxit=40):
        x = x.copy()
        r = self._res(x, dz, rack)
        for _ in range(maxit):
            if np.max(np.abs(r)) < tol:
                return x, True
            J = np.empty((6, 6))
            for i in range(6):
                xp = x.copy()
                xp[i] += 1e-6
                J[:, i] = (self._res(xp, dz, rack) - r) / 1e-6
            try:
                dx = np.linalg.solve(J, -r)
            except np.linalg.LinAlgError:
                return x, False
            t = 1.0
            while t > 1e-4:
                xn = x + t * dx
                rn = self._res(xn, dz, rack)
                if np.linalg.norm(rn) < np.linalg.norm(r) * (1 - 1e-4 * t) or np.max(np.abs(rn)) < tol:
                    break
                t *= 0.5
            else:
                return x, bool(np.max(np.abs(r)) < 1e-6)
            x, r = xn, rn
        return x, bool(np.max(np.abs(r)) < 1e-6)

    def ramp(self, x, s0, s1, step=1.5):
        """Walk the upright from state s0=(heave, rack) to s1 in small steps (robust continuation)."""
        n = max(1, int(math.ceil(max(abs(s1[0] - s0[0]), abs(s1[1] - s0[1])) / step)))
        for k in range(1, n + 1):
            f = k / n
            dz, rk = s0[0] + (s1[0] - s0[0]) * f, s0[1] + (s1[1] - s0[1]) * f
            x, ok = self._newton(x, dz, rk)
            if not ok:
                raise SolveError(f"No valid solution at heave {dz:.1f} mm, rack {rk:.1f} mm. "
                                 "The links cannot reach that position - check hardpoints "
                                 "or reduce the travel/rack range.")
        return x

    def states(self, dzs):
        """Upright states at the given heave values (rack 0), walking out from ride height. Cached."""
        out = {}
        todo = sorted({float(d) for d in dzs})
        for side in (1, -1):
            seq = sorted([d for d in todo if d * side > 0], key=abs)
            x, z = np.zeros(6), 0.0
            for d in seq:
                if d in self._cache:
                    x, z = self._cache[d], d
                else:
                    x = self.ramp(x, (z, 0.0), (d, 0.0))
                    z = d
                    self._cache[d] = x
                out[d] = x
        if 0.0 in todo:
            out[0.0] = np.zeros(6)
        return out

    # ---- observations ------------------------------------------------------
    def observe(self, x, dz, rack=0.0):
        P, a = self._unpack(x)
        ub, lb, tro, c = P
        cp = self._contact(P, a)
        h = self.h
        d = ub - lb
        o = dict(dz=dz, rack=rack)
        o["camber"] = -math.degrees(math.asin(np.clip(a[2], -1, 1)))
        o["toe"] = math.degrees(math.atan2(a[0], a[1]))
        o["caster"] = math.degrees(math.atan((lb[0] - ub[0]) / d[2]))
        o["kpi"] = math.degrees(math.atan((lb[1] - ub[1]) / d[2]))
        f = (lb[2] - cp[2]) / d[2]
        o["scrub"] = cp[1] - (lb[1] + (lb[1] - ub[1]) * f)
        o["trail"] = (lb[0] + (lb[0] - ub[0]) * f) - cp[0]   # vs the CURRENT contact patch
        o["cp_x"], o["cp_y"], o["cp_z"] = cp
        # instant axis from the two wishbone planes (matches KineSolver)
        n1, d1 = plane(h["uif"], h["uir"], ub)
        n2, d2 = plane(h["lif"], h["lir"], lb)
        dv = np.cross(n1, n2)
        if np.linalg.norm(dv) < 1e-9:
            # parallel wishbone planes: instant axis at infinity, force lines run parallel to the planes
            pt = None
            dv_f, dv_s = np.cross(n1, [1.0, 0, 0]), np.cross(n1, [0, 1.0, 0])
        else:
            pt = np.linalg.solve(np.vstack([n1, n2, dv]), [d1, d2, 0.0])
            dv_f = dv_s = dv
        # front view: line from the contact patch through the instant center
        if pt is not None and abs(dv[0]) > 1e-9:
            q = pt + ((cp[0] - pt[0]) / dv[0]) * dv
            dy, dzz = q[1] - cp[1], q[2] - cp[2]
            o["fv_ic"] = (float(q[1]), float(q[2]))
            o["fvsa"] = abs(dy)
        else:
            dy, dzz = dv_f[1], dv_f[2]
            o["fv_ic"] = None
            o["fvsa"] = float("inf")
        o["fv_line"] = (float(cp[1]), float(cp[2]), float(dy), float(dzz))
        rc = -cp[1] * dzz / dy if abs(dy) > 1e-12 else float("nan")
        o["roll_center"] = rc                      # above the ground (KineSolver convention)
        o["roll_center_chassis"] = rc + cp[2]      # in the chassis frame (ground moves in the sweep)

        # side view slope (positive = rises toward the rear) from a reference point
        if pt is not None and abs(dv[1]) > 1e-9:
            sv = pt + ((cp[1] - pt[1]) / dv[1]) * dv
            o["sv_ic"] = (float(sv[0]), float(sv[2]))
        else:
            sv = None
            o["sv_ic"] = None

        def slope_rear(ref):
            if sv is not None:
                return (sv[2] - ref[2]) / (ref[0] - sv[0])
            return -dv_s[2] / dv_s[0] if abs(dv_s[0]) > 1e-12 else 0.0
        veh = self.cfg["vehicle"]
        k = self.WB / self.CG * 100.0
        ref_brake = c if veh["brakes"] == "inboard" else cp
        if self.axle == "front":
            o["antidive"] = slope_rear(ref_brake) * k * self.front_share
        else:
            ref_drive = c if veh["drive"] == "inboard" else cp
            o["antisquat"] = -slope_rear(ref_drive) * k
            o["antilift"] = -slope_rear(ref_brake) * k * (1 - self.front_share)
        o["_pts"] = dict(ub=ub, lb=lb, tro=tro, c=c, a=a, cp=cp, tri=self.tri0 + rack * self.rack_dir)
        o["_x"] = x
        return o

    # ---- sweeps ------------------------------------------------------------
    def heave_sweep(self, steps=None, travel=None):
        sw = self.cfg["sweep"]
        T = float(travel if travel is not None else sw["travel"])
        n = int(steps if steps is not None else sw["steps"])
        n += (n % 2 == 0)                       # odd, so 0 is on the grid
        zs = [float(z) for z in np.linspace(-T, T, n)]
        zs[n // 2] = 0.0
        xs = self.states(zs)
        return [self.observe(xs[z], z) for z in zs]

    def roll_sweep(self, max_deg=None, steps=None):
        """Body roll with equal and opposite wheel travel (right wheel = outer, in bump, for roll > 0).

        The left wheel is the mirror image of this one. Camber is reported relative to the ground.
        The kinematic roll center is where the two contact-patch-to-instant-center lines cross."""
        sw = self.cfg["sweep"]
        m = float(max_deg if max_deg is not None else sw["roll_deg"])
        n = int(steps if steps is not None else sw["roll_steps"])
        n += (n % 2 == 0)
        phis = np.linspace(-m, m, n)
        t = self.h["cp"][1]
        ss = [float(t * math.tan(math.radians(p))) for p in phis]
        ss[n // 2] = 0.0
        xs = self.states(ss + [-s for s in ss])
        rows = []
        for phi, s in zip(phis, ss):
            o_out, o_in = self.observe(xs[s], s), self.observe(xs[-s if s else 0.0], -s)
            yR, zR, dyR, dzR = o_out["fv_line"]
            yL, zL, dyL, dzL = o_in["fv_line"]
            pR, dR = np.array([yR, zR]), np.array([dyR, dzR])
            pL, dL = np.array([-yL, zL]), np.array([-dyL, dzL])       # mirror the left wheel
            rc = line_intersect_2d(pR, dR, pL, dL)
            g = unit(pR - pL)
            mid = 0.5 * (pR + pL)
            if rc is None:
                h_rc, y_rc = float("nan"), float("nan")
            else:
                v = rc - mid
                h_rc = float(g[0] * v[1] - g[1] * v[0])   # height above the ground line
                y_rc = float(g @ v)                      # + = toward the outer (right) wheel
            rows.append(dict(roll=float(phi), dz_outer=s,
                             camber_outer=o_out["camber"] + phi, camber_inner=o_in["camber"] - phi,
                             toe_outer=o_out["toe"], toe_inner=o_in["toe"],
                             rc_height=h_rc, rc_lateral=y_rc))
        return rows

    def steer_sweep(self, rack_max=None, steps=None):
        """Right-wheel toe/camber vs rack, mirrored for the other wheel, then Ackermann."""
        sw = self.cfg["sweep"]
        Rm = float(rack_max if rack_max is not None else sw["rack_travel"])
        n = int(steps if steps is not None else sw["rack_steps"])
        rs = np.linspace(0, Rm, n + 1)
        base = self.observe(np.zeros(6), 0.0, 0.0)
        cols = {+1: [base], -1: [base]}
        for sgn in (+1, -1):
            x = np.zeros(6)
            for i in range(1, n + 1):
                x = self.ramp(x, (0.0, sgn * rs[i - 1]), (0.0, sgn * rs[i]))
                cols[sgn].append(self.observe(x, 0.0, sgn * rs[i]))
        rows = []
        for i, r in enumerate(rs):
            a, b = cols[+1][i], cols[-1][i]
            fa, fb = a["toe"] - base["toe"], b["toe"] - base["toe"]
            # right wheel toes OUT (f<0) when the car turns right -> right wheel is the inner wheel
            if fa < 0:
                inner, outer, cam_in, cam_out = -fa, fb, a["camber"], b["camber"]
            else:
                inner, outer, cam_in, cam_out = -fb, fa, b["camber"], a["camber"]
            ack = float("nan")
            if outer > 1.0 and inner > 0.5:
                def cot(t):
                    return 1.0 / math.tan(math.radians(t))
                ack = (cot(outer) - cot(inner)) * self.WB / self.track * 100.0
            rows.append(dict(rack=float(r), inner=inner, outer=outer, ackermann=ack,
                             camber_inner=cam_in, camber_outer=cam_out))
        return rows

    def grid(self, heaves, racks):
        """Upright states on a (heave x rack) grid, via continuation."""
        xs = self.states(heaves)
        out = {}
        for h_ in heaves:
            xh = xs[float(h_)]
            for r_ in racks:
                out[(h_, r_)] = self.ramp(xh, (h_, 0.0), (h_, r_)) if r_ else xh
        return out

    def steer_arm(self):
        h = self.h
        k = unit(h["ubj"] - h["lbj"])
        v = h["tro"] - h["lbj"]
        return float(np.linalg.norm(v - (v @ k) * k))

    # ---- packaging ----------------------------------------------------------
    def packaging(self, spring=None, heaves=None, racks=None):
        """Center-line clearance between moving links, and a radial rim check, over heave (x rack, front)."""
        sw = self.cfg["sweep"]
        T, Rk = sw["travel"], sw["rack_travel"]
        heaves = heaves if heaves is not None else [-T, 0.0, T]
        if racks is None:
            racks = [-Rk, 0.0, Rk] if self.axle == "front" else [0.0]
        h = self.h
        rim_r = self.cfg["wheel"]["rim_diameter_in"] * 25.4 / 2
        cl = self.cfg["clearance"]
        od = {"tie rod": cl["tie_rod_od"], "pushrod": cl.get("pushrod_od", 15.9), "arm": cl["wishbone_tube_od"]}
        res = dict(rim_radius=rim_r, pairs={}, rim_max=0.0, rim_where=None)
        rodname = "toe link" if self.axle == "rear" else "tie rod"
        for (hz, rk), x in self.grid(heaves, racks).items():
            o = self.observe(x, hz, rk)
            p = o["_pts"]
            legs = {
                f"lower arm leg to pivot X={h['lif'][0]:.0f}": ("lower", h["lif"], p["lb"]),
                f"lower arm leg to pivot X={h['lir'][0]:.0f}": ("lower", h["lir"], p["lb"]),
                f"upper arm leg to pivot X={h['uif'][0]:.0f}": ("upper", h["uif"], p["ub"]),
                f"upper arm leg to pivot X={h['uir'][0]:.0f}": ("upper", h["uir"], p["ub"]),
            }
            def need(a, b):
                return (od[a] + od[b]) / 2 + cl["margin"]
            checks = [(f"{rodname} - {n}", (p["tri"], p["tro"]), (s0, s1), need("tie rod", "arm"))
                      for n, (_, s0, s1) in legs.items()]
            if spring is not None:
                st = spring.state(x)
                pr = (st["rod_out"], st["rod_in"])
                for n, (arm, s0, s1) in legs.items():
                    if arm != spring.on:
                        checks.append((f"pushrod - {n}", pr, (s0, s1), need("pushrod", "arm")))
                checks.append((f"pushrod - {rodname}", pr, (p["tri"], p["tro"]), need("pushrod", "tie rod")))
                # the other side's damper is this one mirrored about Y = 0
                d0, d1 = st["damper_out"], spring.dch
                mir = np.array([1.0, -1.0, 1.0])
                checks.append(("damper - other side's damper", (d0, d1), (d0 * mir, d1 * mir),
                               cl.get("damper_od", 55.0) + cl["margin"]))
            for name, (a0, a1), (b0, b1), req in checks:
                dist = seg_dist(a0, a1, b0, b1)
                cur = res["pairs"].get(name)
                if cur is None or dist - req < cur[0] - cur[3]:
                    res["pairs"][name] = (dist, hz, rk, req)
            for nm in ("ub", "lb", "tro"):
                v = p[nm] - p["c"]
                rad = float(np.linalg.norm(v - (v @ p["a"]) * p["a"]))
                if rad > res["rim_max"]:
                    res["rim_max"], res["rim_where"] = rad, (nm, hz, rk)
        wd = min(res["pairs"].items(), key=lambda kv: kv[1][0] - kv[1][3])
        res["min_clearance"], res["required"], res["min_pair"] = wd[1][0], wd[1][3], wd
        res["ok"] = wd[1][0] >= wd[1][3]
        res["rim_margin"] = rim_r - res["rim_max"]
        return res


# --------------------------------------------------------------------------- #
#  Summaries and checks
# --------------------------------------------------------------------------- #
def summarize(rows, roll_rows, cfg):
    """Scalar metrics from a heave sweep (rows sorted by heave, 0 included) and a roll sweep."""
    i0 = min(range(len(rows)), key=lambda i: abs(rows[i]["dz"]))
    r0, lo, hi = rows[i0], rows[0], rows[-1]
    span_in = (hi["dz"] - lo["dz"]) / 25.4
    toes = np.array([r["toe"] for r in rows])
    cpy = np.array([r["cp_y"] for r in rows])
    m = {k: r0[k] for k in ("camber", "toe", "caster", "kpi", "scrub", "trail", "roll_center", "fvsa")}
    m["camber_gain"] = -(hi["camber"] - lo["camber"]) / span_in
    m["bump_steer"] = (hi["toe"] - lo["toe"]) / span_in
    m["bump_steer_max"] = float(np.max(np.abs(toes - r0["toe"])))
    m["bump_steer_curve"] = (hi["toe"] + lo["toe"]) / 2 - r0["toe"]   # curved part of the toe trace
    m["track_change"] = float(cpy.max() - cpy.min())
    m["rc_min"] = float(min(r["roll_center"] for r in rows))
    m["rc_max"] = float(max(r["roll_center"] for r in rows))
    for k in ("antidive", "antisquat", "antilift"):
        if k in r0:
            m[k] = r0[k]
    if roll_rows:
        j0 = len(roll_rows) // 2
        a, b = roll_rows[j0 - 1], roll_rows[j0 + 1]     # central difference around 0 deg
        dphi = b["roll"] - a["roll"]
        m["roll_camber"] = (b["camber_outer"] - a["camber_outer"]) / dphi
        m["roll_steer"] = (b["toe_outer"] - a["toe_outer"]) / dphi
        m["rc_lat"] = (b["rc_lateral"] - a["rc_lateral"]) / dphi
        top = roll_rows[-1]
        m["roll_camber_max"] = top["camber_outer"]
        m["rc_height_roll"] = top["rc_height"]
        m["roll_max_deg"] = top["roll"]
    return m


def ackermann_at(steer_rows, outer_deg):
    """Ackermann % when the outer wheel reaches outer_deg (interpolated); falls back to last row."""
    prev = None
    for r in steer_rows:
        if r["outer"] >= outer_deg and prev is not None:
            f = (outer_deg - prev["outer"]) / max(1e-9, r["outer"] - prev["outer"])
            if not (math.isnan(prev["ackermann"]) or math.isnan(r["ackermann"])):
                return prev["ackermann"] + f * (r["ackermann"] - prev["ackermann"]), True
            return r["ackermann"], True
        prev = r
    return steer_rows[-1]["ackermann"], False


def rack_for_angle(steer_rows, key, deg):
    prev = None
    for r in steer_rows:
        if r[key] >= deg and prev is not None:
            f = (deg - prev[key]) / max(1e-9, r[key] - prev[key])
            return prev["rack"] + f * (r["rack"] - prev["rack"])
        prev = r
    return None


def evaluate(cfg, full=True, steer=True, pack=True, ride=True):
    """Everything in one dict: metrics, heave rows, roll rows, steer rows, packaging, spring/ride."""
    from .ride import Spring, ride_metrics   # local import: ride depends on kinematics
    s = Suspension(cfg)
    rows = s.heave_sweep(None if full else 3)
    roll = s.roll_sweep(steps=None if full else 3)
    out = dict(susp=s, rows=rows, roll=roll, metrics=summarize(rows, roll, cfg), steer=None, pack=None,
               spring=None, ride=None)
    m = out["metrics"]
    if steer and cfg["axle"] == "front":
        out["steer"] = s.steer_sweep(steps=None if full else 7)
        ack, reached = ackermann_at(out["steer"], cfg["sweep"]["ackermann_at_outer_deg"])
        m["ackermann"] = ack
        out["ack_reached"] = reached
        last = out["steer"][-1]
        if last["outer"] > 1:
            m["turn_radius"] = s.WB / math.sin(math.radians(last["outer"])) / 1000.0
        m["steer_arm"] = s.steer_arm()
    if cfg.get("spring") and ride:
        sp = Spring(s, cfg["spring"])
        out["spring"] = sp
        out["ride"] = ride_metrics(cfg, s, sp, rows)
        m.update({k: v for k, v in out["ride"].items() if not k.startswith("_")})
    if pack:
        out["pack"] = s.packaging(out["spring"])
        m["clearance_min"] = out["pack"]["min_clearance"]
        m["clearance_margin"] = out["pack"]["min_clearance"] - out["pack"]["required"]
        m["rim_margin"] = out["pack"]["rim_margin"]
    return out


def check_targets(cfg, m):
    rows = []
    for k, (lo, hi) in default_targets(cfg).items():
        if k not in m or m[k] is None or (isinstance(m[k], float) and math.isnan(m[k])):
            rows.append((k, None, lo, hi, "not computed"))
            continue
        ok = (lo is None or m[k] >= lo - 1e-9) and (hi is None or m[k] <= hi + 1e-9)
        rows.append((k, m[k], lo, hi, "PASS" if ok else "FAIL"))
    return rows
