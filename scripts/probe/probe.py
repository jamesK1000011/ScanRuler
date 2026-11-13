# SPDX-License-Identifier: AGPL-3.0-only
# Diagnostics for the open red-team items: sewing, assembly joints, bodies.
import os, sys, traceback
sys.path.append(os.environ["FREECAD_LIB"])
import FreeCAD, Part
print("FreeCAD", FreeCAD.Version()[:4])
V = FreeCAD.Vector

def sect(t):
    print("\n=====", t)

sect("sewing")
try:
    box = Part.makeBox(10, 10, 10)
    faces = [f.copy() for f in box.Faces]
    faces[0].translate(V(-0.05, 0, 0))
    c = Part.makeCompound([f.copy() for f in faces])
    c.sewShape(0.1)
    print("compound sewShape ->", c.ShapeType, "shells", len(c.Shells), [s.isClosed() for s in c.Shells], "free edges?")
    sh = Part.makeShell([f.copy() for f in faces])
    print("makeShell closed", sh.isClosed())
    sh2 = sh.copy(); sh2.sewShape(0.1)
    print("shell sewShape ->", sh2.ShapeType, [s.isClosed() for s in sh2.Shells])
    for f in faces: print("  face tol", round(f.Tolerance if hasattr(f,'Tolerance') else -1, 4), f.Surface.__class__.__name__, [tuple(round(x,3) for x in v.Point) for v in f.Vertexes][:2])
    try:
        import BOPTools
    except Exception: pass
    # alternative: Part.Shape.sewShape on compound after fixTolerance
    c3 = Part.makeCompound([f.copy() for f in faces]); c3.fixTolerance(0.1)
    c3.sewShape(0.1); print("fixTolerance+sew ->", c3.ShapeType, [s.isClosed() for s in c3.Shells])
    print("has Part.BRepBuilderAPI?", hasattr(Part, "BRepOffsetAPI"), [n for n in dir(Part) if "ew" in n.lower()])
    import inspect
    print("sewShape doc:", c.sewShape.__doc__)
except Exception:
    traceback.print_exc()

sect("pd body with base feature")
try:
    d = FreeCAD.newDocument("P")
    pf = d.addObject("Part::Feature", "Shape"); pf.Shape = Part.makeBox(5, 5, 5)
    b = d.addObject("PartDesign::Body", "Body"); b.BaseFeature = pf
    d.recompute(); print("body vol", b.Shape.Volume, "tip", b.Tip and b.Tip.Name, "group", [o.Name for o in b.Group])
    print("feature has Refine?", "Refine" in d.addObject("PartDesign::AdditiveBox","B2").PropertiesList)
except Exception:
    traceback.print_exc()

sect("assembly")
try:
    from agentlink.tools import Session, build_server
    import json, tempfile
    s = Session(out_dir=tempfile.mkdtemp()); srv = build_server(s, lean=False)
    def call(n, a=None):
        r = srv.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": n, "arguments": a or {}}})["result"]
        out = json.loads(r["content"][0]["text"]); print(" ", n, "ERR" if r.get("isError") else "ok", str(out)[:300]); return out
    call("pd_body_new", {"name": "Plate"}); call("sketch_new", {"body": "Plate", "plane": "XY", "name": "P"})
    call("sketch_add", {"sketch": "P", "items": [{"kind": "rectangle", "corner": [0, 0], "size": [60, 40]}, {"kind": "circle", "center": [30, 20], "diameter": 10}]})
    call("pd_pad", {"body": "Plate", "sketch": "P", "length": 8})
    call("pd_body_new", {"name": "Pin"}); call("sketch_new", {"body": "Pin", "plane": "XY", "name": "Q"})
    call("sketch_add", {"sketch": "Q", "items": [{"kind": "circle", "center": [100, 0], "diameter": 9.98}]})
    call("pd_pad", {"body": "Pin", "sketch": "Q", "length": 20})
    call("asm_new", {"parts": ["Plate", "Pin"]})
    call("asm_joint", {"kind": "cylindrical", "a": {"part": "Plate", "element": {"kind": "face", "type": "cylinder"}}, "b": {"part": "Pin", "element": {"kind": "face", "type": "cylinder"}}})
    d = s.doc
    j = [o for o in d.Objects if hasattr(o, "JointType")][0]
    print("joint props:", [(p, str(j.getPropertyByName(p))[:60]) for p in j.PropertiesList if p not in ("ExpressionEngine","Label2","Visibility")])
    pin = [o for o in d.Objects if o.Label == "Pin"][0]
    print("pin before", pin.Placement)
    call("asm_explode", {"axis": "z"})
    print("pin exploded", pin.Placement)
    d.recompute(); print("pin after recompute", pin.Placement)
    asm = [o for o in d.Objects if o.TypeId == "Assembly::AssemblyObject"][0]
    print("asm methods", [m for m in dir(asm) if not m.startswith("_")][:200])
    call("asm_explode", {"collapse": True})
    import UtilsAssembly
    print("UtilsAssembly fns", [n for n in dir(UtilsAssembly) if "lacement" in n or "Joint" in n or "joint" in n][:60])
except Exception:
    traceback.print_exc()

sect("replace links")
try:
    d = FreeCAD.newDocument("L")
    src = d.addObject("Part::Box", "Box")
    lk = d.addObject("App::Link", "Link"); lk.LinkedObject = src
    user = d.addObject("Part::Mirroring", "Mir"); user.Source = lk
    d.recompute()
    print("doc methods", [m for m in dir(d) if "eplace" in m or "elink" in m.lower()], [m for m in dir(lk) if "eplace" in m])
except Exception:
    traceback.print_exc()
