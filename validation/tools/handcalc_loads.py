"""Hand-calculated member forces for a planar corner, written to validation/loads_handcalc.json.

    python3 validation/tools/handcalc_loads.py > validation/loads_handcalc.json

Horizontal arms with legs at +-200 mm fore-aft, a vertical damper on the upright, and tire forces that all lie in
the front-view plane through the ball joints. Nothing then turns the wheel about the (vertical) kingpin axis, so
the tie rod carries nothing; the arms are horizontal, so the damper carries all the vertical load; moments about
the damper's upright mount give the upper arm, and the sideways balance gives the lower arm:

    damper = -Fz                                  (compression)
    moments about the damper mount and Fu + Fl + Fy = 0 give the arm forces Fu, Fl on the upright
    leg tension = -F_arm x leg length / (2 x lateral leg length)

Only the vehicle numbers and plain statics are used; nothing is imported from the solver."""
import json
import math

G = 9.81
MASS, WF, CGH, WB = 280.0, 0.46, 290.0, 1550.0
BUMP_G, CORNER_G, POTHOLE_G, KERB_G = 3.0, 1.5, 5.0, 1.5
Y_IN, Y_BJ, Z_U, Z_L = 250.0, 560.0, 330.0, 130.0      # pivots, ball joints
LEG_X = 200.0
D = (540.0, 140.0)                                    # damper mount on the upright (Y, Z)
CP = (610.0, 0.0)                                     # contact patch (Y, Z)
TRACK = 2 * CP[0]

W = MASS * G
Fz0 = W * WF / 2
lat_per_g = W * CGH / TRACK * WF                     # lateral load transfer per g, front share = weight share
L_leg = math.hypot(LEG_X, Y_BJ - Y_IN)


def members(Fz, Fy):
    """Upright free body in the Y-Z plane. Unknowns: Fu, Fl (lateral forces from the arms on the upright), Fd."""
    Fd = -Fz                                          # vertical balance (arms horizontal)
    # moments about the damper mount D (M_x = r_y F_z - r_z F_y):
    #   tire: (CP_y - D_y) Fz - (CP_z - D_z) Fy;  upper: -(Z_U - D_z) Fu;  lower: -(Z_L - D_z) Fl
    # lateral balance: Fu + Fl + Fy = 0
    m_tire = (CP[0] - D[0]) * Fz - (CP[1] - D[1]) * Fy
    a, b = Z_U - D[1], Z_L - D[1]
    Fu = (m_tire + b * Fy) / (a - b)                  # from m_tire - a Fu - b (-Fy - Fu) = 0
    Fl = -Fy - Fu
    leg = lambda F: -F * L_leg / (2 * (Y_BJ - Y_IN))  # noqa: E731  each leg's tension
    return {"upper_front": leg(Fu), "upper_rear": leg(Fu), "lower_front": leg(Fl), "lower_rear": leg(Fl),
            "tie_rod": 0.0, "pushrod": Fd}


cases = {
    "bump": members(BUMP_G * Fz0, 0.0),
    "corner outer": members(Fz0 + CORNER_G * lat_per_g, -CORNER_G * (Fz0 + CORNER_G * lat_per_g)),
    "corner inner": members(Fz0 - CORNER_G * lat_per_g, CORNER_G * (Fz0 - CORNER_G * lat_per_g)),
    "pothole": members(POTHOLE_G * Fz0, 0.0),
    "curb strike": members(Fz0, -KERB_G * Fz0),
}
hp = {"upper_inboard_front": [-LEG_X, Y_IN, Z_U], "upper_inboard_rear": [LEG_X, Y_IN, Z_U],
      "lower_inboard_front": [-LEG_X, Y_IN, Z_L], "lower_inboard_rear": [LEG_X, Y_IN, Z_L],
      "upper_outboard": [0, Y_BJ, Z_U], "lower_outboard": [0, Y_BJ, Z_L],
      "trackrod_inboard": [-70, Y_IN, 230], "trackrod_outboard": [-70, Y_BJ, 230], "contact_patch": [0, *CP]}
out = {
    "name": "Planar corner, member forces by hand",
    "source": "hand statics (validation/tools/handcalc_loads.py), not the solver",
    "config": {"axle": "front", "hardpoints": hp, "wheel": {"camber_deg": 0.0, "toe_deg": 0.0},
               "vehicle": {"mass": MASS, "weight_front": WF, "cg_height": CGH, "wheelbase": WB},
               "loads": {"bump_g": BUMP_G, "corner_g": CORNER_G, "pothole_g": POTHOLE_G, "kerb_g": KERB_G, "lltd_front": WF},
               "spring": {"rod_on": "upright", "rod_outboard": [0, *D], "damper_chassis": [0, D[0], 450.0],
                          "rocker_pivot": None, "rocker_axis": None, "rocker_rod": None, "rocker_damper": None,
                          "spring_rate": 30.0, "unsprung_mass": 10.0, "tire_rate": 150.0}},
    "loads": {k: {m: [round(v, 6), 1e-6 * max(1.0, abs(v))] for m, v in r.items()} for k, r in cases.items()},
}
print(json.dumps(out, indent=1))
