# SPDX-License-Identifier: AGPL-3.0-only
# Diagnostics, round 3: ways to close a gap between faces in FreeCAD 1.1.
import os, sys, traceback
sys.path.append(os.environ["FREECAD_LIB"])
import FreeCAD, Part
print("FreeCAD", FreeCAD.Version()[:4])
V = FreeCAD.Vector

def gapped(d=0.05):
    box = Part.makeBox(10, 10, 10)
    faces = [f.copy() for f in box.Faces]
    faces[0].translate(V(-d, 0, 0))
    return faces

def report(name, sh):
    try:
        shells = sh.Shells
        print(name, sh.ShapeType, "faces", len(sh.Faces), "shells", [(len(s.Faces), s.isClosed()) for s in shells], "valid", sh.isValid())
        if shells and shells[0].isClosed():
            so = Part.makeSolid(shells[0]); print("   solid vol", round(abs(so.Volume), 3), so.isValid())
    except Exception as e:
        print(name, "report failed", e)

for d in (0.05, 0.2):
    print("\n== gap", d, "tolerance 0.1")
    f = gapped(d)
    for name, fn in (
        ("multiFuse fuzzy", lambda: f[0].multiFuse(f[1:], 0.1)),
        ("generalFuse fuzzy", lambda: f[0].generalFuse(f[1:], 0.1)[0]),
        ("compound fuse fuzzy", lambda: Part.makeCompound(f[:1]).fuse(Part.makeCompound(f[1:]), 0.1)),
    ):
        try:
            r = fn()
            report(name, r)
            try:
                sh = Part.Shell(r.Faces); report("  -> Part.Shell", sh)
            except Exception as e:
                print("  -> Part.Shell failed", e)
            try:
                sh = Part.makeShell(r.Faces); report("  -> makeShell", sh)
            except Exception as e:
                print("  -> makeShell failed", e)
        except Exception as e:
            print(name, "failed", e)
    try:
        sf = Part.ShapeFix.Shape(Part.makeCompound(f)); sf.Precision = 0.1; sf.MaxTolerance = 0.1; sf.perform(); report("ShapeFix.Shape", sf.shape())
    except Exception as e:
        print("ShapeFix.Shape failed", e)
    try:
        sh = Part.Shape(); sh.makeShapeFromMesh(*Part.makeCompound(f).tessellate(0.01), 0.1); report("makeShapeFromMesh", sh)
    except Exception as e:
        print("makeShapeFromMesh failed", e)
