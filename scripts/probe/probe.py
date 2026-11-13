# SPDX-License-Identifier: AGPL-3.0-only
# Which cosmetic-edge call takes FreeCAD 1.0 down.
import faulthandler, os, sys
faulthandler.enable()
sys.path.append(os.environ["FREECAD_LIB"])
import FreeCAD, Part, TechDraw
V = FreeCAD.Vector
print("FreeCAD", FreeCAD.Version()[:4], flush=True)
d = FreeCAD.newDocument("T")
b = d.addObject("Part::Box", "Box"); b.Length, b.Width, b.Height = 60, 40, 8
pg = d.addObject("TechDraw::DrawPage", "Page"); t = d.addObject("TechDraw::DrawSVGTemplate", "Tpl"); pg.Template = t
v = d.addObject("TechDraw::DrawViewPart", "View"); pg.addView(v); v.Source = [b]; v.Direction = V(0, 0, 1)
d.recompute()
import time
for _ in range(40):
    if v.getVisibleEdges(): break
    time.sleep(0.1); d.recompute()
print("edges", len(v.getVisibleEdges()), flush=True)
tag = v.makeCosmeticLine(V(-30, -10, 0), V(30, 10, 0)); print("made", tag, flush=True)
ce = v.getCosmeticEdge(tag); print("got", flush=True)
print("format", ce.Format, flush=True)
fm = list(ce.Format); fm[0], fm[1] = 4, 0.18
ce.Format = tuple(fm); print("format set", flush=True)
d.recompute(); print("recomputed", len(v.getVisibleEdges()), flush=True)
v.removeCosmeticEdge(tag); print("removed", flush=True)
d.recompute(); print("recomputed 2", flush=True)
tag = v.makeCosmeticCircle(V(0, 0, 0), 5); print("circle", flush=True); d.recompute(); print("ok", flush=True)
