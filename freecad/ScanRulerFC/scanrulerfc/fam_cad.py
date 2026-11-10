# SPDX-License-Identifier: AGPL-3.0-only
# The measured elements into the FreeCAD document as analytic geometry —
# planes, cylinders, cones, spheres, tori as Part shapes, lines, circles and
# points as reference geometry — to model on, and as STEP for other CAD.
# ScanRuler's files.step (src/commands/core/files.ts, src/core/
# exportStep.ts), for FreeCAD: here the geometry goes straight into the
# document, where PartDesign can take its faces and edges as references.

import os

import numpy as np
from agentlink.protocol import Tool, ToolError

from . import model as M
from . import scanstate as S

GROUP = "scan-cad"
INFO = "Scan elements into the FreeCAD document (ScanRuler, ported): fitted planes, cylinders, cones, spheres, tori, lines, circles and points as Part geometry; STEP."


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


def shape_of(el, style):
    """The element as a Part shape: a face for a surface (a solid for a
    round one with style solids), an edge for a line or circle, a vertex
    for a point. As drawn — an assumed diameter taken over the fitted."""
    import FreeCAD
    import Part

    V = FreeCAD.Vector
    f = el["fit"]
    k = f["kind"]
    c = V(*map(float, f["center"]))
    assumed = el.get("assumed")
    if k == "point":
        return Part.Vertex(c)
    if k == "line":
        d = V(*map(float, f["dir"]))
        h = max(float(f.get("length", 10.0)) / 2, 1e-6)
        return Part.LineSegment(c - d * h, c + d * h).toShape()
    if k == "circle":
        r = float(assumed) / 2 if assumed else float(f["radius"])
        return Part.makeCircle(r, c, V(*map(float, f["normal"])))
    if k == "plane":
        n = np.asarray(f["normal"], float)
        u = np.asarray(f.get("basisU") or np.cross(n, [1, 0, 0] if abs(n[0]) < 0.9 else [0, 1, 0]), float)
        u /= np.linalg.norm(u)
        v = np.cross(n, u)
        eu, ev = max(float(f.get("extentU", 10)), 1e-6), max(float(f.get("extentV", 10)), 1e-6)
        C = np.asarray(f["center"], float)
        pts = [C + su * eu * u + sv * ev * v for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        return Part.Face(Part.makePolygon([V(*p) for p in pts + [pts[0]]]))
    axis = V(*map(float, f.get("axis", [0, 0, 1])))
    if k == "cylinder":
        r = float(assumed) / 2 if assumed else float(f["radius"])
        L = max(float(f["length"]), 1e-6)
        s = Part.makeCylinder(r, L, c - axis * (L / 2), axis)
        return s if style == "solids" else s.Faces[0]
    if k == "cone":
        L = max(float(f["length"]), 1e-6)
        s = Part.makeCone(max(float(f["radius1"]), 1e-6), max(float(f["radius2"]), 1e-6), L, c - axis * (L / 2), axis)
        return s if style == "solids" else s.Faces[0]
    if k == "sphere":
        r = float(assumed) / 2 if assumed else float(f["radius"])
        s = Part.makeSphere(r, c)
        return s if style == "solids" else s.Faces[0]
    if k == "torus":
        s = Part.makeTorus(float(f["majorRadius"]), float(f["minorRadius"]), c, axis)
        return s if style == "solids" else s.Faces[0]
    raise ToolError("invalid_input", f"{el['name']}: a {k} has no CAD form here.")


def tools(session):
    def element_to_document(a):
        import Part

        st = S.state(session)
        refs = a.get("elements")
        try:
            els = [M.find_element(st, r) for r in refs] if refs else [e for e in st["elements"] if e.get("fit")]
        except M.Refusal as e:
            raise ToolError(e.code, e.message)
        els = [e for e in els if e.get("fit")]
        if not els:
            raise ToolError("invalid_state", "No elements to bring over: element_fit first.")
        style = a.get("style", "solids")
        doc = session.doc
        group_name = a.get("group", "Scan elements")
        group = next((o for o in doc.Objects if o.TypeId == "App::DocumentObjectGroup" and o.Label == group_name), None) or doc.addObject("App::DocumentObjectGroup", "ScanElements")
        group.Label = group_name
        made, shapes = [], []
        for el in els:
            sh = shape_of(el, style)
            o = doc.addObject("Part::Feature", "ScanElement")
            o.Label = el["name"]
            o.Shape = sh
            group.addObject(o)
            made.append({"element": el["name"], "kind": el["kind"], "object": o.Name, "label": o.Label,
                         "shape": "solid" if sh.Solids else "face" if sh.Faces else "edge" if sh.Edges else "vertex"})
            shapes.append(sh)
        doc.recompute()
        out = {"group": group.Label, "made": made, "style": style,
               "note": "In the frame the scan is measured in now. Faces and edges here are references PartDesign can take (a sketch on a plane, a pad up to a face)."}
        if a.get("export"):
            path = a["export"] if os.path.isabs(a["export"]) else os.path.join(session.out_dir, a["export"])
            if not path.lower().endswith((".step", ".stp")):
                path += ".step"
            Part.makeCompound(shapes).exportStep(path)
            out["file"] = {"path": path, "name": os.path.basename(path), "bytes": os.path.getsize(path)}
        return out

    return [
        Tool("element_to_document",
             "The measured elements into the FreeCAD document as analytic geometry, in a group (group, \"Scan elements\" by default): a plane as a face of its extent; a cylinder, "
             "cone, sphere or torus as a solid (style: solids, the default) or its surface (style: surfaces); a line or circle as an edge, a point as a vertex — as drawn, "
             "an assumed diameter taken over the fitted. elements: names or ids, all by default. export: a .step path to write them too. In the frame the scan is measured "
             "in now: align first to model in the part's own frame.",
             obj({"elements": {"type": "array", "items": {"type": ["string", "integer"]}}, "style": {"enum": ["solids", "surfaces"]}, "group": {"type": "string"},
                  "export": {"type": "string"}}),
             element_to_document, changes=True),
    ]
