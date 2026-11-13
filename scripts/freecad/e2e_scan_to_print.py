# SPDX-License-Identifier: AGPL-3.0-only
# One part all the way from a scan to a sliced print, through the tools an
# agent calls, timed and with what it cost (agentlink.usage): an L-bracket
# with a bolt hole, scanned (meshed with noise), measured, rebuilt as a
# PartDesign body from a section, checked against the scan, judged printable
# and sliced. Prints E2E lines; a step that fails is reported and the rest go
# on where they can.

# FreeCAD first: its start clears names already imported into __main__.
import os
import sys

if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
import FreeCAD  # noqa: E402

import json  # noqa: E402
import os  # noqa: E402,F811
import tempfile  # noqa: E402
import time  # noqa: E402

import Mesh  # noqa: E402
import numpy as np  # noqa: E402
import Part  # noqa: E402

os.environ.setdefault("AGENTLINK_USAGE", "on")
from agentlink import usage  # noqa: E402
from agentlink.tools import Session, build_server  # noqa: E402

out = tempfile.mkdtemp()

# The part as made: 40 × 30 × 25 L, 5 mm walls, a 6.4 mm hole in the foot.
foot = Part.makeBox(40, 30, 5)
wall = Part.makeBox(5, 30, 25)
truth = foot.fuse(wall).removeSplitter().cut(Part.makeCylinder(3.2, 5, FreeCAD.Vector(25, 15, 0)))
import MeshPart  # noqa: E402

m = MeshPart.meshFromShape(Shape=truth, MaxLength=0.8)
pts, tris = m.Topology
rng = np.random.default_rng(7)
V = np.array([[p.x, p.y, p.z] for p in pts]) + rng.normal(0, 0.02, (len(pts), 3))
scan = Mesh.Mesh()
scan.addFacets([[tuple(V[i]) for i in t] for t in tris])
scan_path = os.path.join(out, "bracket-scan.stl")
scan.write(scan_path)

session = Session(out_dir=out)
server = build_server(session, lean=True)
server.meter = usage.Meter(os.path.join(out, "usage"))
server.handle({"jsonrpc": "2.0", "id": 0, "method": "tools/list"})
results = []


def call(name, args=None):
    r = server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
    o = json.loads(r["content"][0]["text"])
    return (not r.get("isError")), o


def step(title, fn):
    t0 = time.time()
    try:
        got = fn()
        ok = True
        note = got if isinstance(got, str) else ""
    except Exception as e:  # noqa: BLE001 — report and go on
        ok, note = False, str(e)[:300]
    results.append({"step": title, "ok": ok, "s": round(time.time() - t0, 2), "note": note})
    print(f"E2E step\t{'ok' if ok else 'FAIL'}\t{title}\t{round(time.time() - t0, 2)}s\t{note}", flush=True)
    return ok


def need(name, args=None):
    ok, o = call(name, args)
    if not ok:
        raise RuntimeError(f"{name}: {o.get('error', o)}")
    return o


state = {}


def open_scan():
    need("doc_new", {"name": "E2E"})
    need("tool_groups", {"enable": ["scan", "elements", "sections", "deviation", "feature", "sketch"]})
    server.handle({"jsonrpc": "2.0", "id": 0, "method": "tools/list"})  # the client lists again on list_changed
    o = need("scan_open", {"path": scan_path})
    return f"{o['opened']['triangles']} triangles"


def measure_hole():
    o = need("element_fit", {"kind": "cylinder", "at": {"point": [25 + 3.2, 15, 2.5]}, "side": "inside", "name": "Bolt hole"})
    el = o["element"]
    f = el.get("fit") or el
    d = el.get("diameter") or (2 * f["radius"] if f.get("radius") else None)
    state["hole"] = d
    if d is None or abs(d - 6.4) > 0.1:
        raise RuntimeError(f"hole read {d}")
    return f"hole Ø {d:.3f} (6.4 made)"


def rebuild():
    sec = need("section_cut", {"across": "XZ", "name": "Profile"})["section"]
    need("section_fit", {"section": sec["id"]})
    sk = need("section_to_sketch", {"section": sec["id"], "name": "Profile sketch"})
    need("pd_pad", {"body": sk["body"], "sketch": sk["sketch"], "length": 30, "sides": "symmetric"})
    state["body"] = sk["body"]
    vol = next(o for o in session.doc.Objects if o.Label == sk["body"]).Shape.Volume
    return f"body {sk['body']}: {vol:.0f} mm³ (truth before the hole {foot.fuse(wall).Volume:.0f})"


def hole():
    b = next(o for o in session.doc.Objects if o.Label == state["body"])
    bb = b.Shape.BoundBox
    # The profile lies in the scan's XZ plane through its middle; the pad
    # runs ±15 along Y about it.
    tool = Part.makeCylinder(state["hole"] / 2, 100, FreeCAD.Vector(25, (bb.YMin + bb.YMax) / 2, -50))
    o = session.doc.addObject("Part::Feature", "Rebuilt")
    o.Shape = b.Shape.cut(tool)
    o.Label = "Bracket"
    if hasattr(b, "ViewObject") and b.ViewObject is not None:
        b.ViewObject.Visibility = False
    session.doc.recompute()
    state["final"] = "Bracket"
    return f"{o.Shape.Volume:.0f} mm³ (truth {truth.Volume:.0f})"


def compare():
    need("deviation_open_reference", {"body": state["final"]})
    o = need("deviation_align", {"mode": "auto"})
    st = o.get("statistics") or o.get("map") or o
    rms = st.get("rms") or st.get("RMS")
    if rms is None or rms > 0.15:
        raise RuntimeError(f"deviation rms {rms}")
    return f"scan vs rebuilt: RMS {rms:.3f} mm"


def printable():
    need("setup", {"action": "add", "type": "print", "bodies": [state["final"]], "settings": {"printer": "generic", "layerHeight": 0.2, "infill": 20}})
    o = need("part_review", {"body": state["final"]})
    return f"verdict {o.get('verdict')}"


def slice_it():
    if not os.environ.get("AGENTLINK_ORCASLICER") and not os.environ.get("AGENTLINK_SLICER"):
        return "no slicer here: skipped"
    o = need("slice", {"body": state["final"]})
    return f"{o.get('time')}, {o.get('filamentG')} g, {o.get('layers')} layers"


t0 = time.time()
step("open the scan", open_scan)
step("measure the bolt hole", measure_hole)
step("rebuild from a section", rebuild)
step("cut the hole", hole)
step("check against the scan", compare)
step("printability verdict", printable)
step("slice", slice_it)
tot = server.meter.session_totals()
passed = sum(r["ok"] for r in results)
print(f"E2E summary\t{passed}/{len(results)} steps\t{round(time.time() - t0, 1)}s\t{tot['calls']} calls\t~{tot['tokens']} tokens in calls\t~{tot['toolList']['tokens']} tokens tool list ({tot['toolList']['tools']} tools)", flush=True)
for b in tot["byTool"][:8]:
    print(f"E2E tool\t{b['tool']}\t{b['calls']} calls\t~{b['tokens']} tokens", flush=True)
