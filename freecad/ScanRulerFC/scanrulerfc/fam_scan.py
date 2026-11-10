# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/commands/core/scan.ts (open,
# query, nearest), src/commands/core/segment.ts, session.state's scan part
#
# The scan: open it, say what it holds, read its points, find its flat faces.

import os

from agentlink.protocol import Tool, ToolError

from . import model as M
from . import scanstate as S
from .schema import BOX, NORMAL, arr, boolean, enum, guarded, integer, location, num, obj, one_of, vec3

GROUP = "scan"
INFO = "The 3D scan measured (ScanRuler, ported): open it and read what it holds."




def tools(session):
    def scan_open(a):
        path = a.get("path")
        if not path or not os.path.isfile(path):
            raise ToolError("not_found", f"path {path!r}: no such file — give the scan's path on this computer.")
        st = S.state(session)
        if st["scan"] is not None and (st["elements"] or st["dimensions"]) and not a.get("discard"):
            raise ToolError("invalid_state", f"{st['scan'].name} is open with {len(st['elements'])} elements and {len(st['dimensions'])} dimensions: discard: true replaces it.")
        try:
            scan = S.load(path, a.get("units", "mm"), given="units" in a)
        except ValueError as e:
            raise ToolError("invalid_input", str(e))
        st.update(S.fresh())
        st["scan"] = scan
        return {"opened": scan.summary()}

    def scan_info(a):
        st = S.state(session)
        if st["scan"] is None:
            return {"scan": None, "note": "No scan open: scan_open { path }."}
        return {"scan": st["scan"].summary(), "elements": len(st["elements"]), "dimensions": len(st["dimensions"])}

    def scan_nearest(a):
        st = S.state(session)
        return M.js(M.resolve_location(M.require_scan(st), a["at"]), 6)

    def scan_query(a):
        st = S.state(session)
        scan = M.require_scan(st)
        limit = a.get("limit", 1000)
        mark = a.get("mark", False)
        fields = a.get("fields", "count" if mark else "all")
        every, kept, step = M.query(scan, a.get("box"), a.get("near"), a.get("normal"), limit)
        g = scan.graph()
        out = {"matched": int(len(every)), "returned": int(len(kept)), "step": int(step)}
        if len(kept):
            Q, Nq = g.P[kept], g.N[kept]
            mn = Nq.sum(axis=0)
            nl = float((mn @ mn) ** 0.5)
            out.update(bounds={"min": M.js(Q.min(axis=0), 4), "max": M.js(Q.max(axis=0), 4)}, centroid=M.js(Q.mean(axis=0), 4), meanNormal=M.js(mn / nl, 4) if nl > 0 else None)
        if mark:
            st["marked"] = {"vertices": every, "from": f"scan_query {'box' if a.get('box') else 'ball'}{' facing a way' if a.get('normal') else ''}"}
            out["marked"] = {"points": int(len(every)), "from": st["marked"]["from"]}
        if fields != "count":
            out["vertices"] = [int(v) for v in kept]
        if fields == "all":
            out["points"] = M.js(g.P[kept], 4)
            out["normals"] = M.js(g.N[kept], 3)
        return out

    def scan_segment(a):
        return M.scan_segment(S.state(session), a)

    return [
        Tool("scan_open", "Open a 3D scan (STL, PLY, OBJ, OFF, 3MF) to measure, in place of the one open: units mm (default), cm, m or in. A scan with elements or dimensions on it is kept unless discard: true.", obj({"path": {"type": "string"}, "units": {"type": "string", "enum": list(S.UNITS)}, "discard": {"type": "boolean"}}, ["path"]), scan_open),
        Tool("scan_nearest", "Where a place lands on the scan: the vertex (a point snaps to the nearest), its coordinates and outward normal, a triangle it is a corner of, and how far it lies from the point asked about. Use it to check a point lies on the surface before fitting there. Changes nothing.", obj({"at": location("The place on the scan.")}, ["at"]), guarded(scan_nearest)),
        Tool("scan_query", "The scan's vertices inside a box, or within a radius of a point (near), with their outward normals — the points on a face; normal keeps only those facing a direction. Returns matched, the vertex numbers, points and normals (mm, current frame), the box round them, centroid and mean normal; fields: count, ids or all (the default) says how much. Trap: at most limit come back (1000 by default, 20000 at most), every k-th spread evenly, step saying k — mark: true marks every matching vertex, not the thinned list, for element_fit_marked { marked: true }. Changes nothing on the part.", obj({"box": BOX, "near": obj({"at": vec3("The centre, mm."), "radius": num("mm.", exclusiveMinimum=0)}, ["at", "radius"], "A ball about a point, in place of box."), "normal": NORMAL, "limit": integer("How many vertices at most; 1000 by default, 20000 at most.", minimum=1, maximum=20000), "mark": boolean("Leave every matching vertex marked, for element_fit_marked { marked: true }."), "fields": enum(["count", "ids", "all"], "count: the numbers alone (the default with mark); ids: with the vertices; all: with points and normals (the default).")}), guarded(scan_query)),
        Tool("scan_segment", "The scan's planar regions, found all at once: grown from the flattest places outward within maxDeg (15°) and maxRms (0.05 mm), those smaller than minArea given back. Returns found, considered, claimed and the regions, largest first, at most limit (20): id, normal, point, sigma, area (mm²), box, vertices, neighbours { id, deg }. mark: a region's id, or several, leaves their points marked for element_fit_marked { marked: true }. Changes nothing.", obj({"kind": enum(["plane"], "What to find; plane, the default and for now the only one."), "box": BOX, "minArea": num("mm²; by default a square 2 % of the scan's diagonal on a side.", minimum=0), "maxRms": num("mm; 0.05 by default.", exclusiveMinimum=0), "maxDeg": num("Degrees; 15 by default.", exclusiveMinimum=0, maximum=60), "limit": integer("How many regions are listed; 20 by default.", minimum=1, maximum=200), "mark": one_of([integer("A region's id.", minimum=1), arr(integer(minimum=1), "Several regions' ids.", minItems=1)], "Leave this region's points marked, or several regions'."), "list": boolean("With mark: the list of regions too.")}), guarded(scan_segment)),
        Tool("scan_info", "The scan open: file, units, vertices, triangles, box, centre, area; and how many elements and dimensions are on it. Changes nothing.", obj({}), scan_info),
    ]
