# SPDX-License-Identifier: AGPL-3.0-only
# The scan jobs' fixture, the same file for both sides: an L-bracket (40 ×
# 30 × 25, 5 mm walls, a 6.4 mm hole in the foot) as made (STEP) and as
# scanned (meshed at 0.8 mm with 0.02 mm of noise, seeded, STL), and what
# is true of it (truth.json).
#
#   python scripts/bakeoff/scan_fixture.py <out folder>
import os
import sys

if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
import FreeCAD  # noqa: E402

import json  # noqa: E402

import Mesh  # noqa: E402
import MeshPart  # noqa: E402
import numpy as np  # noqa: E402
import Part  # noqa: E402

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
foot = Part.makeBox(40, 30, 5)
wall = Part.makeBox(5, 30, 25)
truth = foot.fuse(wall).removeSplitter().cut(Part.makeCylinder(3.2, 5, FreeCAD.Vector(25, 15, 0)))
truth.exportStep(os.path.join(out, "bracket.step"))
m = MeshPart.meshFromShape(Shape=truth, MaxLength=0.8)
pts, tris = m.Topology
rng = np.random.default_rng(7)
V = np.array([[p.x, p.y, p.z] for p in pts]) + rng.normal(0, 0.02, (len(pts), 3))
scan = Mesh.Mesh()
scan.addFacets([[tuple(V[i]) for i in t] for t in tris])
scan.write(os.path.join(out, "bracket-scan.stl"))
with open(os.path.join(out, "truth.json"), "w") as f:
    json.dump({"hole": 6.4, "holeAt": [25, 15], "noiseSigma": 0.02, "volume": round(truth.Volume, 1), "section": {"z": 2.5}}, f)
print("fixture", out, len(tris), "triangles")
