"""The shared schema (schema/*.json): defaults, metric labels and help, target ranges and point names. The Python
solver loads it here; ui/build.py inlines the same files into the web page, so both read one source."""
import json
import os

_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "schema")


def _load(name):
    with open(os.path.join(_DIR, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


DEFAULTS_FILE = _load("defaults")
METRICS_FILE = _load("metrics")
TARGETS_FILE = _load("targets")
POINTS_FILE = _load("points")
