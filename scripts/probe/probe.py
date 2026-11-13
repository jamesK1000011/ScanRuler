# SPDX-License-Identifier: AGPL-3.0-only
# Which cosmetic-edge call takes FreeCAD 1.0 down, through Agent Link's own view.
import faulthandler, json, os, sys, tempfile
faulthandler.enable()
sys.path.append(os.environ["FREECAD_LIB"])
import FreeCAD
V = FreeCAD.Vector
print("FreeCAD", FreeCAD.Version()[:4], flush=True)
from agentlink.tools import Session, build_server
s = Session(out_dir=tempfile.mkdtemp()); srv = build_server(s, lean=False)
def call(n, a=None):
    r = srv.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": n, "arguments": a or {}}})["result"]
    out = json.loads(r["content"][0]["text"]); print(" ", n, "ERR" if r.get("isError") else "ok", str(out)[:200], flush=True); return out
call("pd_body_new", {"name": "Plate"}); call("sketch_new", {"plane": "XY", "name": "Outline"})
call("sketch_add", {"sketch": "Outline", "items": [{"kind": "rectangle", "corner": [0, 0], "size": [60, 40]}]})
call("pd_pad", {"sketch": "Outline", "length": 8})
call("td_page", {"action": "new", "paper": "A4", "name": "Gaps"})
vl = call("td_view", {"page": "Gaps", "bodies": ["Plate"], "direction": "top", "scale": 1, "at": [80, 60], "name": "G lines"})["view"]
v = s.doc.getObjectsByLabel(vl)[0]
print("edges", len(v.getVisibleEdges()), "rotation", getattr(v, "Rotation", None), flush=True)
tag = v.makeCosmeticLine(V(-30, -10, 0), V(30, 10, 0)); print("made", tag, flush=True)
ce = v.getCosmeticEdge(tag); print("got", flush=True)
print("format", ce.Format, flush=True)
fm = dict(ce.Format, style=4, weight=0.18)
ce.Format = fm; print("format set", flush=True)
s.doc.recompute(); print("recomputed", len(v.getVisibleEdges()), flush=True)
v.removeCosmeticEdge(tag); print("removed", flush=True)
s.doc.recompute(); print("recomputed 2", flush=True)
call("td_cosmetic", {"view": vl, "items": [{"kind": "line", "from": [0, 10, 8], "to": [60, 30, 8]}]})
print("done", flush=True)
