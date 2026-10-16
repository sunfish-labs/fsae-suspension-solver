"""Independent reference for the kinematics: a planar double wishbone solved as a 2D four-bar linkage.

    python3 validation/tools/planar_fourbar.py > validation/planar_fourbar.json

Every pivot axis runs fore-aft (along X) and the tie rod copies the upper arm (its inner point on the upper pivot
axis, its outer point beside the upper ball joint), so the upright moves only in the front-view (Y-Z) plane.
Then the motion is a four-bar linkage: turn the lower arm by phi, find the upper ball joint where the upper arm's
circle meets the upright's circle around the lower ball joint, rotate the upright to match, and bisect on phi until
the contact patch has risen by dz. This uses only plain 2D geometry and shares no code with the solver."""
import json
import math

R = 254.0                       # tire radius, mm
CAMBER = -1.0                   # static camber, deg (- = top in)
UP, LP = (270.0, 320.0), (230.0, 130.0)       # upper / lower pivot axes (Y, Z)
UBJ, LBJ = (545.0, 330.0), (575.0, 125.0)     # ball joints (Y, Z)
CP = (600.0, 0.0)                             # contact patch (Y, Z)


def rot(v, t):
    c, s = math.cos(t), math.sin(t)
    return (c * v[0] - s * v[1], s * v[0] + c * v[1])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1])


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def circle_meet(c1, r1, c2, r2, near):
    """The crossing of two circles closest to `near`."""
    d = math.dist(c1, c2)
    a = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
    h = math.sqrt(max(r1 * r1 - a * a, 0.0))
    ex = ((c2[0] - c1[0]) / d, (c2[1] - c1[1]) / d)
    m = (c1[0] + a * ex[0], c1[1] + a * ex[1])
    p1, p2 = (m[0] - h * ex[1], m[1] + h * ex[0]), (m[0] + h * ex[1], m[1] - h * ex[0])
    return p1 if math.dist(p1, near) < math.dist(p2, near) else p2


g = math.radians(CAMBER)
a0 = (math.cos(g), -math.sin(g))                       # spin axis (Y, Z): camber = -asin(a_z)


def low_point(w, a):
    """Lowest point of the tire circle: wheel center minus R along 'up' projected into the wheel plane."""
    up = (0.0 - a[1] * a[0], 1.0 - a[1] * a[1])
    n = math.hypot(*up)
    return (w[0] - R * up[0] / n, w[1] - R * up[1] / n)


up0 = (-a0[1] * a0[0], 1.0 - a0[1] ** 2)
W0 = (CP[0] + R * up0[0] / math.hypot(*up0), CP[1] + R * up0[1] / math.hypot(*up0))
Lu, Lup = math.dist(UP, UBJ), math.dist(LBJ, UBJ)


def pose(phi):
    lbj = add(LP, rot(sub(LBJ, LP), phi))
    ubj = circle_meet(UP, Lu, lbj, Lup, UBJ)
    psi = math.atan2(*reversed(sub(ubj, lbj))) - math.atan2(*reversed(sub(UBJ, LBJ)))
    w = add(lbj, rot(sub(W0, LBJ), psi))
    a = rot(a0, psi)
    return low_point(w, a), a


def at(dz):
    lo, hi = -0.6, 0.6
    for _ in range(200):
        mid = (lo + hi) / 2
        if pose(mid)[0][1] - CP[1] < dz:
            lo = mid
        else:
            hi = mid
    cp, a = pose((lo + hi) / 2)
    return cp, -math.degrees(math.asin(a[1]))


dzs = list(range(-30, 31, 5))
pts = {dz: at(dz) for dz in dzs}
hp = {"upper_inboard_front": [-200, *UP], "upper_inboard_rear": [200, *UP], "lower_inboard_front": [-200, *LP],
      "lower_inboard_rear": [200, *LP], "upper_outboard": [0, *UBJ], "lower_outboard": [0, *LBJ],
      "trackrod_inboard": [-70, *UP], "trackrod_outboard": [-70, *UBJ], "contact_patch": [0, *CP]}
case = {
    "name": "Planar double wishbone, 2D four-bar closed form",
    "source": "independent 2D four-bar solution (validation/tools/planar_fourbar.py), not the solver",
    "config": {"axle": "front", "hardpoints": hp, "wheel": {"camber_deg": CAMBER, "toe_deg": 0.0, "tire_radius": R},
               "sweep": {"travel": 30, "steps": 13}},
    "curves": {"camber": [[dz, round(pts[dz][1], 10)] for dz in dzs],
               "cp_y": [[dz, round(pts[dz][0][0], 10)] for dz in dzs],
               "toe": [[dz, 0.0] for dz in dzs]},
    "curve_tol": {"camber": 1e-6, "cp_y": 1e-6, "toe": 1e-6},
}
print(json.dumps(case, indent=1))
