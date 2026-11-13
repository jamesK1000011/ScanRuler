# SPDX-License-Identifier: AGPL-3.0-only
# Diagnostics for the open red-team items, round 2.
import os, sys, traceback, inspect
sys.path.append(os.environ["FREECAD_LIB"])
import FreeCAD, Part
print("FreeCAD", FreeCAD.Version()[:4])
V = FreeCAD.Vector

def sect(t):
    print("\n=====", t)

def gapped():
    box = Part.makeBox(10, 10, 10)
    faces = [f.copy() for f in box.Faces]
    faces[0].translate(V(-0.05, 0, 0))
    return faces

sect("sewing 2")
try:
    print("Part names:", [n for n in dir(Part) if n[0].isupper() or n.startswith("make")])
    if hasattr(Part, "ShapeFix"):
        print("ShapeFix:", dir(Part.ShapeFix))
    if hasattr(Part, "ShapeUpgrade"):
        print("ShapeUpgrade:", dir(Part.ShapeUpgrade))
    for kw in ({"tolerance": 0.1},):
        c = Part.makeCompound(gapped())
        try:
            c.sewShape(**kw); print("kw", kw, c.ShapeType, [s.isClosed() for s in c.Shells])
        except Exception as e:
            print("kw failed", e)
    c = Part.makeCompound(gapped())
    r = c.sewShape(0.1); print("return value", type(r), getattr(r, "ShapeType", None), "self now", c.ShapeType)
    # Part.Shape() then sew
    s0 = Part.Shape(Part.makeCompound(gapped())); s0.sewShape(0.1); print("Part.Shape sew", s0.ShapeType, [s.isClosed() for s in s0.Shells])
    # a bigger tolerance
    for t in (0.06, 0.5, 1.0):
        c = Part.makeCompound(gapped()); c.sewShape(t); print("tol", t, c.ShapeType, [s.isClosed() for s in c.Shells])
    # mesh route as a control
    import Mesh, MeshPart
    print("TopoShape sewShape src? ", Part.TopoShape.sewShape.__doc__ if hasattr(Part, "TopoShape") else "")
except Exception:
    traceback.print_exc()

sect("ShapeFix shell / sewing classes")
try:
    sf = Part.ShapeFix
    for n in dir(sf):
        if not n.startswith("_"):
            o = getattr(sf, n)
            print(" ", n, [m for m in dir(o) if not m.startswith("_")][:40])
except Exception:
    traceback.print_exc()

sect("UtilsAssembly")
try:
    import UtilsAssembly
    for n in ("getJointDistance", "getJointXYAngle", "getGlobalPlacement"):
        print(inspect.getsource(getattr(UtilsAssembly, n)))
except Exception:
    traceback.print_exc()

sect("techdraw cosmetic")
try:
    import TechDraw
    d = FreeCAD.newDocument("T")
    b = d.addObject("Part::Box", "Box"); b.Length, b.Width, b.Height = 60, 40, 8
    pg = d.addObject("TechDraw::DrawPage", "Page"); t = d.addObject("TechDraw::DrawSVGTemplate", "Tpl"); pg.Template = t
    v = d.addObject("TechDraw::DrawViewPart", "View"); pg.addView(v); v.Source = [b]; v.Direction = V(0, 0, 1); v.Scale = 2
    d.recompute()
    import time
    for _ in range(40):
        if v.getVisibleEdges(): break
        time.sleep(0.1); d.recompute()
    es = v.getVisibleEdges()
    print("edges", len(es), [[tuple(round(c, 2) for c in p.Point) for p in e.Vertexes] for e in es])
    print("view methods", [m for m in dir(v) if "osmetic" in m or "enter" in m or "anonical" in m or "Vertex" in m])
    print("TechDraw fns", [n for n in dir(TechDraw) if not n.startswith("_")])
    p, q = es[0].Vertexes[0].Point, es[0].Vertexes[-1].Point
    for fn, args in (("makeCosmeticLine", (p, q)), ("makeCosmeticLine3D", (V(0, 0, 8), V(60, 40, 8)))):
        try:
            tag = getattr(v, fn)(*args); d.recompute()
            ce = v.getCosmeticEdge(tag)
            print(fn, "tag", tag, [m for m in dir(ce) if not m.startswith("_")])
            for attr in ("Start", "End", "Center", "Radius", "Format", "Tag"):
                if hasattr(ce, attr):
                    print("   ", attr, getattr(ce, attr))
        except Exception as e:
            print(fn, "failed", e)
    try:
        tag = v.makeCosmeticCircle(V(0, 0, 0), 5); d.recompute(); print("circle ok", tag, v.getCosmeticEdge(tag).Center)
    except Exception as e:
        print("circle failed", e)
    try:
        print(v.makeCosmeticLine.__doc__)
        print(v.makeCenterLine.__doc__)
        n = [f"Edge{i}" for i, e in enumerate(es) if abs(e.Vertexes[0].Point.y - e.Vertexes[-1].Point.y) < 1e-6][:2]
        tag = v.makeCenterLine(n, 2); d.recompute(); cl = v.getCenterLine(tag); print("centerline", tag, [m for m in dir(cl) if not m.startswith("_")])
    except Exception as e:
        print("centerline failed", e)
    es2 = v.getVisibleEdges(); print("edges after", len(es2))
    for e in es2[len(es):]:
        print("  new", [tuple(round(c, 2) for c in p.Point) for p in e.Vertexes])
    if hasattr(TechDraw, "makeCanonicalPoint"):
        print("canonical of", p, "->", TechDraw.makeCanonicalPoint(v, p))
except Exception:
    traceback.print_exc()

sect("dimension")
try:
    dm = d.addObject("TechDraw::DrawViewDimension", "Dim"); print("dim props", dm.PropertiesList)
except Exception:
    traceback.print_exc()
