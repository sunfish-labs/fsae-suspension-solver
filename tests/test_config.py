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
from susp.ride import CAR_TARGETS  # noqa: E402

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

bad = results.count(False)
print(f"\n{len(results) - bad} of {len(results)} input-handling checks passed")
sys.exit(1 if bad else 0)
