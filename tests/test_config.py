"""Input handling: misspelled target keys are reported (with a suggestion) instead of silently ignored, and bad
input raises a typed error the caller can catch. Run from the repo root:  python3 tests/test_config.py"""
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from susp.config import load_car, load_config, make_config, unknown_car_target_keys, validate  # noqa: E402
from susp.errors import ConfigError, GoalError, SolveError, SuspError, UnknownPointError  # noqa: E402
from susp.car import CAR_TARGETS  # noqa: E402

results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("  ok   " if ok else "  FAIL ") + name + (f"  -> {detail}" if detail and not ok else ""))


front = json.load(open(os.path.join(ROOT, "designs", "example_front.json")))

print("\n1. Misspelled target keys are reported")
cases = [  # (targets, expected substring or None for "no warning")
    ({"camber": [-2, -1]}, None),
    ({"camberr": [-2, -1]}, "did you mean 'camber'"),
    ({"roll_centre": [20, 40]}, "did you mean 'roll_center'"),
    ({"bump_stear_max": [None, 0.1]}, "did you mean 'bump_steer_max'"),
    ({"ride_frequency": [3, 4]}, "did you mean 'ride_freq'"),
    ({"xyzzy": [0, 1]}, "Check the spelling"),
    ({"_note": "comments are fine"}, None),
]
for targets, want in cases:
    cfg = make_config(dict(front, targets=targets))
    msgs = [m for lv, m in validate(cfg) if "target" in m and "not a metric" in m]
    ok = (not msgs) if want is None else (len(msgs) == 1 and want in msgs[0])
    check(f"targets {list(targets)} -> {'no warning' if want is None else want}", ok, msgs)
cfg = make_config(dict(front, targets={}))
cfg["_team_targets"] = {"kpii": [2, 8]}
check("a misspelled key in the team targets file is reported too", any("team targets file" in m and "'kpi'" in m for _, m in validate(cfg)))
check("car targets: a misspelled car metric is reported", any("'lltd_vs_weight'" in m for m in unknown_car_target_keys({"lltd_vs_wieght": [0, 10]}, CAR_TARGETS)))
check("car targets: the three car metrics are accepted", not unknown_car_target_keys(dict(CAR_TARGETS), CAR_TARGETS))

print("\n2. Bad input raises a typed error")
tmp = tempfile.mkdtemp()


def raises(exc, fn):
    try:
        fn()
    except exc:
        return True
    except Exception as e:  # noqa: BLE001
        print("     raised", type(e).__name__, e)
        return False
    return False


def write(name, obj):
    p = os.path.join(tmp, name)
    with open(p, "w") as f:
        f.write(obj if isinstance(obj, str) else json.dumps(obj))
    return p


check("missing hardpoints -> ConfigError", raises(ConfigError, lambda: load_config(write("a.json", {"axle": "front"}))))
check("not JSON -> ConfigError", raises(ConfigError, lambda: load_config(write("b.json", "{nope"))))
check("missing team targets file -> ConfigError", raises(ConfigError, lambda: load_config(write("c.json", dict(front, targets_file="missing.json")))))
check("car file without a rear -> ConfigError", raises(ConfigError, lambda: load_car(write("d.json", {"type": "car", "front": front}))))
check("negative bump travel -> ConfigError", raises(ConfigError, lambda: load_config(write("e.json", dict(front, sweep={"bump_travel": -5})))))
check("caliper missing its size -> ConfigError", raises(ConfigError, lambda: load_config(write("f.json", dict(front, wheel={"caliper": {"clock_deg": 0, "radius": 100, "offset": 0}})))))
check("halfshaft with a 2D point -> ConfigError", raises(ConfigError, lambda: load_config(write("g.json", dict(front, axle="rear", halfshaft={"diff_output": [0, 150], "cv_outboard": [0, 500, 250]})))))
check("a second spring rate without a breakpoint -> ConfigError", raises(ConfigError, lambda: load_config(write("k.json", dict(front, spring=dict(front["spring"], spring_rate2=80))))))
check("a bump stop without a rate -> ConfigError", raises(ConfigError, lambda: load_config(write("l.json", dict(front, spring=dict(front["spring"], bumpstop_gap=10))))))
check("a bar linkage missing its arm tip -> ConfigError", raises(ConfigError, lambda: load_config(write("m.json", dict(front, arb={"link_outboard": [0, 400, 150], "bar_pivot": [100, 330, 330], "bar_od": 12})))))
check("tire load sensitivity outside 0..1 -> ConfigError", raises(ConfigError, lambda: load_config(write("n.json", dict(front, vehicle={"tire_load_sens": 1.5})))))
check("an unknown joint name -> ConfigError", raises(ConfigError, lambda: load_config(write("h.json", dict(front, joints={"tie_rod_out": {"bolt": "x"}})))))
check("a bad bolt direction -> ConfigError", raises(ConfigError, lambda: load_config(write("i.json", dict(front, joints={"trackrod_outboard": {"bolt": "up"}})))))
check("a rod end can't be a bearing -> ConfigError", raises(ConfigError, lambda: load_config(write("j.json", dict(front, joints={"trackrod_outboard": {"type": "bearing"}})))))
check("an unknown tube surface -> ConfigError", raises(ConfigError, lambda: load_config(write("o.json", dict(front, members={"surface": "polished"})))))
check("a tab with zero thickness -> ConfigError", raises(ConfigError, lambda: load_config(write("p.json", dict(front, members={"tab": {"thickness": 0}})))))
check("a gusset with no height -> ConfigError", raises(ConfigError, lambda: load_config(write("p.json", dict(front, members={"gusset": {"thickness": 3, "length_in": 50}})))))
check("a gusset of an unknown type -> ConfigError", raises(ConfigError, lambda: load_config(write("p.json", dict(front, members={"gusset": {"type": "plate"}})))))
check("a bracket into the node needs no sizes", not raises(ConfigError, lambda: load_config(write("p.json", dict(front, members={"gusset": {"type": "to_node"}})))))
check("a heave sweep of 3 steps -> ConfigError (slopes need 5)", raises(ConfigError, lambda: load_config(write("p.json", dict(front, sweep={"steps": 3})))))
check("a roll sweep of 1 step -> ConfigError", raises(ConfigError, lambda: load_config(write("p.json", dict(front, sweep={"roll_steps": 1})))))
check("a fractional step count -> ConfigError", raises(ConfigError, lambda: load_config(write("p.json", dict(front, sweep={"rack_steps": 7.5})))))
par = json.loads(json.dumps(front))
for k_ in ("upper_inboard_front", "upper_inboard_rear", "upper_outboard"):
    par["hardpoints"][k_][2] = par["hardpoints"][k_.replace("upper", "lower")][2] + 200.0
check("wishbones parallel in the front view -> a warning about the roll center",
      any("almost parallel" in m for _, m in validate(load_config(write("p.json", par)))))
rk_ok = {"thickness": 6.35, "pivot_bore": 22, "pivot_edge": 20, "edge": 12, "width": 30}
check("a rocker with no arm depth -> ConfigError", raises(ConfigError, lambda: load_config(write("p.json", dict(front, members={"rocker": dict(rk_ok, width=None)})))))
check("a rocker pivot bore wider than its hub -> ConfigError", raises(ConfigError, lambda: load_config(write("p.json", dict(front, members={"rocker": dict(rk_ok, pivot_edge=10)})))))
check("a rocker with its five sizes is enough", not raises(ConfigError, lambda: load_config(write("p.json", dict(front, members={"rocker": rk_ok})))))
carL = json.load(open(os.path.join(ROOT, "designs", "example_car_layout.json")))
fL, rL, iL = load_car(os.path.join(ROOT, "designs", "example_car_layout.json"))
check("layout.apply: both corners take the car's mass, front share and CG height from the layout",
      all(abs(c["vehicle"][k] - iL["layout_res"][k]) < 1e-5 for c in (fL, rL) for k in ("mass", "weight_front", "cg_height")))
bad_lay = json.loads(json.dumps(carL))
bad_lay["layout"]["components"][0]["mass"] = 0
check("a layout part with no mass -> ConfigError", raises(ConfigError, lambda: load_car(write("cl.json", bad_lay))))
bad_dt = json.loads(json.dumps(carL))
bad_dt["drivetrain"]["torque_curve"] = [[5000, 40], [4000, 45]]
check("a torque curve whose rpm goes down -> ConfigError", raises(ConfigError, lambda: load_car(write("cd.json", bad_dt))))
bad_dt["drivetrain"]["torque_curve"] = carL["drivetrain"]["torque_curve"]
bad_dt["drivetrain"]["efficiency"] = 88
check("drivetrain efficiency given in % -> ConfigError (it is a fraction)", raises(ConfigError, lambda: load_car(write("cd.json", bad_dt))))
bad_ck = json.loads(json.dumps(carL))
bad_ck["cockpit"]["hip"] = [-800]
check("a cockpit point with one coordinate -> ConfigError", raises(ConfigError, lambda: load_car(write("ck.json", bad_ck))))
bad_ck["cockpit"]["hip"] = carL["cockpit"]["hip"]
bad_ck["cockpit"]["back_angle"] = 95
check("a seat back angle past 80 deg -> ConfigError", raises(ConfigError, lambda: load_car(write("ck.json", bad_ck))))
bad_ck["cockpit"]["back_angle"] = 30
bad_ck["cockpit"].pop("back_angle")
check("a seat hip point without its back angle -> ConfigError", raises(ConfigError, lambda: load_car(write("ck.json", bad_ck))))
bad_ck["cockpit"].pop("hip")
check("a frame-only cockpit (no hip, no back angle) loads", not raises(ConfigError, lambda: load_car(write("ck.json", bad_ck))))
bad_ck["cockpit"].update(hip=carL["cockpit"]["hip"], back_angle=30)
bad_ck["cockpit"]["lap_belt_mount"] = [-870]
check("a frame point with one coordinate -> ConfigError", raises(ConfigError, lambda: load_car(write("ck.json", bad_ck))))
bad_gp = json.loads(json.dumps(carL))
bad_gp["ground_points"] = [{"name": "sump", "at": [0, 85]}]
check("a ground point with two coordinates -> ConfigError", raises(ConfigError, lambda: load_car(write("gp.json", bad_gp))))
check("negative fatigue cycles -> ConfigError", raises(ConfigError, lambda: load_config(write("q.json", dict(front, loads={"fatigue_cycles": -5})))))
check("every library error is a SuspError", all(issubclass(e, SuspError) for e in (ConfigError, GoalError, SolveError, UnknownPointError)))
from susp import tools as T  # noqa: E402
cfg = make_config(front)
check("unknown point in --vary -> UnknownPointError", raises(UnknownPointError, lambda: T.parse_vary(cfg, "nosuch.x")))
check("bad goal -> GoalError", raises(GoalError, lambda: T.parse_goal("roll_center~3")))
check("unknown goal metric -> GoalError naming the nearest metric",
      raises(GoalError, lambda: T.optimize(cfg, "trackrod_inboard.z", ["roll_centre=30:5"])))
far = dict(front, hardpoints=dict(front["hardpoints"], trackrod_inboard=[2000.0, 147.0, 190.0]))
from susp.kinematics import evaluate  # noqa: E402
check("links that can't reach -> SolveError", raises(SolveError, lambda: evaluate(make_config(far))))

print("\n3. One schema for both languages")
from susp.config import METRICS, load_car as _lc  # noqa: E402
from susp.kinematics import evaluate as _ev  # noqa: E402
fc, rc_, _ = _lc(os.path.join(ROOT, "designs", "example_car.json"))
missing = sorted({k for c in (fc, rc_) for k, v in _ev(c)["metrics"].items() if isinstance(v, (int, float)) and k not in METRICS})
check("every metric the solver reports has a label in schema/metrics.json", not missing, missing)
schema_metrics = json.load(open(os.path.join(ROOT, "schema", "metrics.json")))["corner"]
terms = {t for t in (d.get("term") for d in schema_metrics.values()) if t}
gl = open(os.path.join(ROOT, "ui", "glossary.js")).read()
check("every metric's glossary term exists", all(f'id: "{t}"' in gl for t in terms), [t for t in terms if f'id: "{t}"' not in gl])

print("\n4. Advice: single and paired moves, checked with a full evaluation")
from susp.tools.advise import advise, apply_move, candidate_moves  # noqa: E402
tight = make_config(dict(front, targets=dict(front.get("targets", {}), roll_center=[45, 60])))
ev_t = _ev(tight)
labels = [lab for lab, _ in candidate_moves(tight, "roll_center")]
check("the candidate list includes the paired moves from schema/moves.json", any("+" in lab for lab in labels) and len(labels) == 8 * 3 + 5)
adv = advise(tight, ev_t)
row = [a for a in adv if a[0] == "roll_center"]
ok = bool(row and row[0][4])
for c in (row[0][4] if ok else []):
    coords = [(p, "xyz".index(c["coord"].split(" ")[0].rsplit(".", 1)[1])) for p in c["coord"].split(" ")[0].rsplit(".", 1)[0].split("+")]
    v = _ev(apply_move(tight, coords, c["move"]))["metrics"]["roll_center"]
    ok = ok and 45 - 1e-6 <= v <= 60 + 1e-6
check("every suggested move really fixes the roll center in a full evaluation", ok, row)

bad = results.count(False)
print(f"\n{len(results) - bad} of {len(results)} input-handling checks passed")
sys.exit(1 if bad else 0)
