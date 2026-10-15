"""CAD export checks: the IGES and STEP files read back in OpenCascade (the kernel behind FreeCAD) with every point
and line where the solver put it, in every axis frame and both unit systems. Run from the repo root:
    python3 tests/test_cad.py
Needs node and, for the CAD read-back, `pip install cadquery-ocp` (skipped with a note if it is missing)."""
import json, math, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("  ok   " if ok else "  FAIL ") + name + (f"  -> {detail}" if detail and not ok else ""))


def gen(design, opts):
    base = os.path.join(tempfile.mkdtemp(), "out")
    subprocess.run(["node", os.path.join(ROOT, "tests", "cad_gen.js"), os.path.join(ROOT, "ui"), design, base, json.dumps(opts)],
                   check=True, capture_output=True)
    return base, json.load(open(base + ".json"))


car = os.path.join(ROOT, "designs", "example_car.json")
raw = json.load(open(car))

print("\n1. Points land where the design puts them (solver frame, solver origin)")
base, g = gen(car, {"frame": "solver", "origin": "solver", "units": "mm"})
P = {p["name"]: p["p"] for p in g["points"]}
h = raw["front"]["hardpoints"]
pairs = [("upper_inboard_front", "upper_inboard_rear", "UCA"), ("lower_inboard_front", "lower_inboard_rear", "LCA")]
worst = 0.0
for a, b, arm in pairs:
    for key in (a, b):
        other = b if key == a else a
        phys = "front" if h[key][0] >= h[other][0] else "rear"
        worst = max(worst, math.dist(P[f"FR_{arm}_{phys}_pivot"], h[key]))
        worst = max(worst, math.dist(P[f"FL_{arm}_{phys}_pivot"], [h[key][0], -h[key][1], h[key][2]]))
check("front inboard pivots equal the JSON hardpoints, left side mirrored", worst < 1e-6, worst)
check("ball joints at ride height equal the JSON hardpoints", math.dist(P["FR_UCA_ball_joint"], h["upper_outboard"]) < 1e-6
      and math.dist(P["FR_LCA_ball_joint"], h["lower_outboard"]) < 1e-6)
wb = raw["vehicle"]["wheelbase"]
check("rear contact patch one wheelbase behind the front one",
      abs((P["FR_contact_patch"][0] - P["RR_contact_patch"][0]) - wb) < 1e-6, P["FR_contact_patch"][0] - P["RR_contact_patch"][0])

print("\n2. Axis frames and units")
_, ga = gen(car, {"frame": "solver", "origin": "axle", "units": "mm"})
A = {p["name"]: p["p"] for p in ga["points"]}
check("front-axle origin puts the front contact patch at X = 0, on the ground", abs(A["FR_contact_patch"][0]) < 1e-9 and abs(A["FR_contact_patch"][2]) < 1e-9)
maps = {"sw": lambda p: [p[0], p[2], p[1]], "iso": lambda p: [p[0], -p[1], p[2]], "adams": lambda p: [-p[0], p[1], p[2]]}
for fr, f in maps.items():
    _, gf = gen(car, {"frame": fr, "origin": "axle", "units": "in"})
    F = {p["name"]: p["p"] for p in gf["points"]}
    w = max(math.dist(F[n], [v / 25.4 for v in f(A[n])]) for n in A)
    check(f"frame '{fr}' in inches is the expected rotation of the solver frame", w < 1e-9, w)
    # right-handed: (forward x left) . up > 0 for each frame
    fwd, left, up = f([1, 0, 0]), f([0, -1, 0]), f([0, 0, 1])
    cr = [fwd[1] * left[2] - fwd[2] * left[1], fwd[2] * left[0] - fwd[0] * left[2], fwd[0] * left[1] - fwd[1] * left[0]]
    check(f"frame '{fr}' is right-handed, so the right corners sit on the car's right", sum(c * u for c, u in zip(cr, up)) > 0.5)

print("\n3. IGES and STEP read back in a CAD kernel (OpenCascade)")
try:
    from OCP.IGESControl import IGESControl_Reader
    from OCP.STEPControl import STEPControl_Reader
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.TopExp import TopExp_Explorer
    from OCP.TopAbs import TopAbs_VERTEX, TopAbs_EDGE
    from OCP.BRep import BRep_Tool
    from OCP.TopoDS import TopoDS
    from OCP.StlAPI import StlAPI_Reader
    from OCP.TopoDS import TopoDS_Shape
except ImportError:
    print("  (skipped: pip install cadquery-ocp to read the files back)")
else:
    def shape_of(reader, path):
        r = reader(); assert r.ReadFile(path) == IFSelect_RetDone; r.TransferRoots(); return r.OneShape()

    def verts_edges(sh):
        ex, vs = TopExp_Explorer(sh, TopAbs_VERTEX), []
        while ex.More():
            p = BRep_Tool.Pnt_s(TopoDS.Vertex(ex.Current())); vs.append((p.X(), p.Y(), p.Z())); ex.Next()
        ex, ne = TopExp_Explorer(sh, TopAbs_EDGE), 0
        while ex.More():
            ne += 1; ex.Next()
        return vs, ne

    for units in ("mm", "in"):
        base, gg = gen(car, {"frame": "sw", "origin": "axle", "units": units, "poses": ["bump", "droop", "steer"]})
        k = 25.4 if units == "in" else 1.0           # OpenCascade reports everything in mm
        want = [p["p"] for p in gg["points"]] + [l["a"] for l in gg["lines"]] + [l["b"] for l in gg["lines"]]
        for kind, reader, ext in (("IGES", IGESControl_Reader, ".igs"), ("STEP", STEPControl_Reader, ".step")):
            vs, ne = verts_edges(shape_of(reader, base + ext))
            miss = max(min(math.dist([c * k for c in q], v) for v in vs) for q in want)
            check(f"{kind} ({units}): {ne} lines and every point within 0.001 mm", ne == len(gg["lines"]) and miss < 1e-3, f"{ne} vs {len(gg['lines'])}, miss {miss}")
    st = TopoDS_Shape()
    ok = StlAPI_Reader().Read(st, base + ".stl")
    check("STL tube bodies read back", ok)

bad = results.count(False)
print(f"\n{len(results) - bad} of {len(results)} CAD export checks passed")
sys.exit(1 if bad else 0)
