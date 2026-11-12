# SPDX-License-Identifier: AGPL-3.0-only
# What OrcaSlicer's command line can do headless, from the build CI has: its
# options, a cube sliced with a system printer preset (inheritance resolved
# by Agent Link), and everything it hands back — result.json and the sliced
# 3MF's own files (plate info, warnings, settings). A report for designing
# the two-way FreeCAD <-> OrcaSlicer loop; never a failure.

# FreeCAD first: its start clears names already imported into __main__.
import os
import sys

if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
import FreeCAD  # noqa: E402,F401

import glob  # noqa: E402,F401
import json  # noqa: E402
import os  # noqa: E402,F811
import subprocess  # noqa: E402,F401
import sys  # noqa: E402,F811
import tempfile  # noqa: E402
import zipfile  # noqa: E402,F401
from agentlink import slicer_presets as sp  # noqa: E402
from agentlink import slicers  # noqa: E402

exe = slicers.find("orcaslicer")
print("orca:", exe)
if not exe:
    sys.exit(0)
h = subprocess.run([exe, "--help"], capture_output=True, text=True, timeout=120)
print("=== HELP\n" + (h.stdout or h.stderr)[-12000:])

print("env presets:", os.environ.get("AGENTLINK_ORCA_PRESETS"), "roots:", sp.roots("orcaslicer"))
for r in sp.roots("orcaslicer"):
    print("json files under", r, len(glob.glob(os.path.join(r, "**", "*.json"), recursive=True)))
for r in sp.roots("orcaslicer"):
    n = sum(len([f for f in fs if f.endswith(".json")]) for _d, _s, fs in os.walk(r, followlinks=True))
    print("json files (following links):", n)
    for v in sorted(os.listdir(r))[:6] + [x for x in os.listdir(r) if x.startswith("BBL")]:
        p = os.path.join(r, v)
        kind = "link->" + os.readlink(p) if os.path.islink(p) else ("dir" if os.path.isdir(p) else f"file {os.path.getsize(p)}")
        print("  ", v, kind, (sorted(os.listdir(p))[:5] if os.path.isdir(p) else ""))
    bbl = os.path.join(r, "BBL")
    if os.path.isdir(bbl):
        for d, _s, fs in list(os.walk(bbl, followlinks=True))[:4]:
            print("   walk", d, len(fs), fs[:3])
print("fetch:", sp.fetch_orca(["BBL"], exe=exe))
idx = sp.scan("orcaslicer")
print("presets:", {k: len(v) for k, v in idx.items()})
pick = {}
for k, want in (("machine", "Bambu Lab H2D 0.4 nozzle"), ("process", "0.20mm Standard @BBL H2D"), ("filament", "Bambu PLA Basic @BBL H2D")):
    names = [n for n in idx[k] if n == want] or [n for n in idx[k] if "H2D" in n and idx[k][n][0]["listed"]]
    pick[k] = names[0] if names else None
print("picked:", pick)
work = tempfile.mkdtemp()
paths = {}
for k, n in pick.items():
    if not n:
        print("no", k)
        sys.exit(0)
    flat = sp.resolve(idx, k, n)
    flat.pop("_system", None)
    p = os.path.join(work, k + ".json")
    json.dump(flat, open(p, "w"))
    paths[k] = p
    print(k, n, "keys", len(flat))

import Mesh  # noqa: E402
import Part  # noqa: E402

stl = os.path.join(work, "cube.stl")
shape = Part.makeBox(20, 20, 20).cut(Part.makeCylinder(4, 20, FreeCAD.Vector(10, 10, 0)))
m = Mesh.Mesh(shape.tessellate(0.05))
m.write(stl)
out = os.path.join(work, "out")
os.makedirs(out)
args = [exe, "--slice", "0", "--export-statistics", "--load-settings", f"{paths['machine']};{paths['process']}", "--load-filaments", paths["filament"],
        "--outputdir", out, "--export-3mf", "out.3mf", "--export-slicedata", os.path.join(out, "slicedata"), stl]
r = subprocess.run(args, capture_output=True, text=True, timeout=600, cwd=out)
print("=== RUN", r.returncode)
print("\n".join(((r.stdout or "") + (r.stderr or "")).splitlines()[-40:]))
for f in sorted(glob.glob(os.path.join(out, "**", "*"), recursive=True)):
    print("file:", os.path.relpath(f, out), os.path.getsize(f) if os.path.isfile(f) else "dir")
rj = os.path.join(out, "result.json")
if os.path.isfile(rj):
    print("=== result.json\n" + open(rj).read()[:6000])
tm = os.path.join(out, "out.3mf")
if os.path.isfile(tm):
    with zipfile.ZipFile(tm) as z:
        for n in z.namelist():
            print("3mf:", n, z.getinfo(n).file_size)
        for n in z.namelist():
            if n.endswith((".config", ".json")) and "project_settings" not in n:
                print(f"=== {n}\n" + z.read(n).decode("utf-8", "replace")[:5000])
            if "project_settings" in n:
                ps = json.loads(z.read(n))
                print(f"=== {n}: {len(ps)} keys; names:", {k: ps.get(k) for k in ("printer_settings_id", "print_settings_id", "filament_settings_id", "inherits")})
gc = sorted(glob.glob(os.path.join(out, "*.gcode")))
if gc:
    head = open(gc[0], errors="replace").read().splitlines()
    print("=== gcode header\n" + "\n".join(l for l in head[:400] if l.startswith(";") and ("=" in l or ":" in l))[:5000])
    tail = [l for l in head[-600:] if l.startswith(";")]
    print("=== gcode tail\n" + "\n".join(tail[-120:])[:5000])

# Back again: the project read (threemf.read), then sliced as it stands.
from agentlink import threemf  # noqa: E402

if os.path.isfile(tm):
    idx2 = {}

    def resolve(slicer, kind, name):
        if slicer not in idx2:
            idx2[slicer] = sp.scan(slicer)
        return sp.resolve(idx2[slicer], kind, name)

    back = threemf.read(tm, resolve)
    print("=== READ BACK\n" + json.dumps({k: v for k, v in back.items() if k != "statistics"}, indent=1)[:4000])
    print("=== STATISTICS\n" + json.dumps(back.get("statistics"), indent=1)[:3000])
    exe2, found = slicers.slice_project("orcaslicer", tm, os.path.join(work, "again"), export=os.path.join(work, "again.3mf"))
    print("=== RESLICED", found, slicers.read_gcode(found[0]), json.dumps(slicers.LAST)[:1500])
