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
SURFACE_LIMIT = 20000
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

    def scan_qa(a):
        import math

        import numpy as np

        from . import noise_core as NC
        from . import qa_core as Q
        from .dev_surface import NominalSurface

        st = S.state(session)
        scan = M.require_scan(st)
        g = scan.graph()
        V, F = g.P, g.F
        r = Q.rims(V, F)
        cad, flat_share = NC.is_cad(g)
        measured = NC.local_noise(g, NC.NOISE_SAMPLE)
        noise = {"median": 0.0, "p90": 0.0, "sampled": measured["sampled"]} if cad else measured
        lo, hi = V.min(0), V.max(0)
        size = float(np.linalg.norm(hi - lo))
        area = float(g.vertex_areas().sum()) if hasattr(g, "vertex_areas") else 0.0
        spacing = math.sqrt(area / len(V)) if len(V) else 0.0
        sparse = cad and spacing > Q.SPARSE_SPACING * g.bbox_diag
        out = {"rims": {"count": r["count"], "total": round(r["total"], 1),
                        "largest": [{"rim": x["rim"], "length": round(x["length"], 1), "at": M.js(x["at"], 2), "size": round(x["size"], 1),
                                     **({"circle": {"center": M.js(x["circle"]["center"], 3), "axis": M.js(x["circle"]["axis"], 4), "diameter": round(2 * x["circle"]["radius"], 3), "rms": round(x["circle"]["rms"], 4)}} if "circle" in x else {})}
                                    for x in r["largest"]]},
               "noise": {"median": round(noise["median"], 4), "p90": round(noise["p90"], 4), "sampled": noise["sampled"],
                         **({"measured": {"median": round(measured["median"], 4), "p90": round(measured["p90"], 4)}} if cad and measured["median"] >= 1e-4 else {})}}
        if r["circles"]:
            out["rims"]["circles"] = [{"rim": x["rim"], "length": round(x["length"], 1), "circle": {"center": M.js(x["circle"]["center"], 3), "axis": M.js(x["circle"]["axis"], 4), "diameter": round(2 * x["circle"]["radius"], 3)}} for x in r["circles"]]
        if r["moreCircles"]:
            out["rims"]["moreCircles"] = r["moreCircles"]
        densify = Q.densify_edge_for(size)
        if cad:
            out["tessellation"] = {"cad": True, "sparse": bool(sparse), "spacing": round(spacing, 3), "flatShare": round(flat_share, 3), **({"densifyTo": densify} if sparse else {})}
        notes = []
        scanned = not noise["median"] < 1e-4
        if r["count"] > 0 and scanned and r["total"] <= 0.02 * size:
            notes.append(f"Closed skin but for pinholes, {r['count']} open rim{'s' if r['count'] != 1 else ''}, {r['total']:.1f} mm in all on a part {size:.0f} mm across: a wrap bridges holes it did not see through — read each hole from both ends; element_fit on a bore answers closed where its axis runs into the skin.")
        elif r["count"] > 0:
            l0 = r["largest"][0]
            notes.append(f"{r['count']} open rim{'s' if r['count'] != 1 else ''}, {r['total']:.1f} mm in all — the longest {l0['length']:.1f} mm round {M.js(l0['at'], 1)}: the scan has holes there; fits and sections near them see less surface.")
        if r["count"] == 0 and scanned:
            notes.append("Closed skin, no open rims: a wrap bridges holes it did not see through — read each hole from both ends; element_fit on a bore answers closed where its axis runs into the skin.")
        if cad and sparse:
            notes.append(f"A CAD tessellation, not a scan — and a sparse one: vertices {spacing:.2f} mm apart on average, on its edges and rims. The noise is 0; densify it first (mesh edges of {densify:g} mm or less), then read it exactly.")
        elif cad or noise["median"] < 1e-4:
            notes.append("The surface has no noise — a CAD tessellation, not a scan: read its numbers exactly.")
        elif noise["median"] > 0.03:
            notes.append(f"Noisy surface: {noise['median']:.3f} mm median scatter — read sizes from fits over large patches, not single points.")
        # The thickness axis: given, the alignment's z, or the way most faces.
        ax = a.get("axis")
        aligned = not (np.allclose(scan.R, np.eye(3)) and np.allclose(scan.t, 0))
        if isinstance(ax, list):
            d = np.asarray(ax, float)
            if not np.linalg.norm(d) > 0:
                raise ToolError("invalid_input", "axis: give a direction, not a zero vector.")
            d /= np.linalg.norm(d)
            frm = "given"
        elif ax or aligned:
            d = np.eye(3)["xyz".index(ax or "z")]
            frm = "given" if ax else "the alignment's z"
        else:
            d = Q.dominant_facing(g.N[:: max(1, len(V) // 60000)])
            if d is None:
                raise ToolError("failed", "The scan has too few points to read a thickness axis off — give axis.")
            big = int(np.argmax(np.abs(d)))
            if d[big] < 0:
                d = -d
            frm = "the way most of the surface faces"
        axis_name = next((n for n, e in zip("xyz", np.eye(3)) if np.allclose(d, e)), M.js(d, 2))
        us, vs, ts, tops, bots, u, v = Q.thickness_grid(NominalSurface(V, F), V, d)
        if len(ts) < 12:
            out["thickness"] = {"axis": M.js(d, 4), "axisFrom": frm, "cells": int(len(ts))}
            notes.append(f"Thickness along {axis_name}: too few rays went through the part to read it.")
            return {**out, "notes": notes}
        srt = np.sort(ts)

        def pct(q):
            return float(srt[min(len(srt) - 1, int(q * len(srt)))])

        p50 = pct(0.5)

        def near(t):
            return max(0.3, 0.06 * t)

        step = max(1, len(ts) // 400)
        best_n, mode = 0, p50
        for i in range(0, len(ts), step):
            n = int((np.abs(ts - ts[i]) <= near(ts[i]) / 2).sum())
            if n > best_n:
                best_n, mode = n, float(ts[i])
        main = np.abs(ts - mode) <= near(mode)
        th = {"axis": M.js(d, 4), "axisFrom": frm, "cells": int(len(ts)), "p5": round(pct(0.05), 3), "p50": round(p50, 3), "p95": round(pct(0.95), 3)}
        trend = Q.robust_plane(us[main], vs[main], ts[main])
        if trend:
            slope = math.hypot(trend["b"], trend["c"])
            tilt = math.degrees(math.atan(slope))
            toward = (trend["b"] * u + trend["c"] * v) / slope if slope > 0 else np.zeros(3)
            along = (us[main] * trend["b"] + vs[main] * trend["c"]) / slope if slope > 0 else np.zeros(int(main.sum()))
            a0, a1 = float(along.min()), float(along.max())
            mean = trend["a"] + (trend["b"] * us[main].mean() + trend["c"] * vs[main].mean())
            mid = float(along.mean())
            t_from, t_to = mean - slope * (mid - a0), mean + slope * (a1 - mid)
            ft, fb = Q.robust_plane(us[main], vs[main], tops[main]), Q.robust_plane(us[main], vs[main], bots[main])

            def deg(f):
                return round(math.degrees(math.atan(math.hypot(f["b"], f["c"]))), 3) if f else None

            th.update(tiltDeg=round(tilt, 3), thickensToward=M.js(toward, 2), run=[round(t_from, 3), round(t_to, 3)], over=round(a1 - a0, 1), faces={"topDeg": deg(ft), "bottomDeg": deg(fb)})
            if tilt >= 0.2:
                notes.append(f"Faces across {axis_name} that should be parallel are {tilt:.2f}° apart: the part thickens from {t_from:.2f} to {t_to:.2f} mm over {a1 - a0:.0f} mm toward {M.js(toward, 2)}. "
                             f"A scan merge or alignment error, or a real taper — decide before modelling to one thickness, which misses by up to {abs(t_to - t_from) / 2:.2f} mm.")
        if pct(0.95) - pct(0.05) > 0.3 * p50:
            notes.append(f"Thickness along {axis_name} varies from {pct(0.05):.2f} to {pct(0.95):.2f} mm (p5–p95): steps, pockets or bosses — a section shows where.")
        out["thickness"] = th
        out["notes"] = notes
        return out

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

    def scan_fit_surface(a):
        import numpy as np

        from . import height_surface as HS

        st = S.state(session)
        scan = M.require_scan(st)
        limit = a.get("limit", SURFACE_LIMIT)
        if (a.get("vertices") is None) == (a.get("box") is None):
            raise ToolError("invalid_input", "Give vertices or box — one of them.")
        g = scan.graph()
        if a.get("box"):
            _every, kept, _step = M.query(scan, a["box"], None, a.get("normal"), limit)
            P = g.P[kept]
        else:
            vs = a["vertices"]
            bad = next((v for v in vs if v >= len(g.P)), None)
            if bad is not None:
                raise ToolError("invalid_input", f"vertices: {bad} is past the scan's {len(g.P)} vertices.")
            step = max(1, -(-len(vs) // limit))
            P = g.P[np.asarray(vs[::step], dtype=np.int64)]
        if len(P) < 7:
            raise ToolError("invalid_input", f"Only {len(P)} scan points lie there — a surface needs 7 at least.")
        model = a.get("model", "best")
        r = HS.fit_models(P, HS.MODELS if model == "best" else [model])
        if not r:
            raise ToolError("failed", "The points lie on a line — no surface is fitted through them.")
        fr = r["frame"]
        out = {"points": int(len(P)), "frame": {k: M.js(fr[k], 4) for k in ("origin", "basisU", "basisV", "normal")},
               "models": {f["model"]: {"coefficients": f["coefficients"], "rms": f["rms"], "worst": f["worst"],
                                       **({"curvature": {**f["curvature"], "axis1": M.js(f["curvature"]["axis1"], 4), "axis2": M.js(f["curvature"]["axis2"], 4)}} if f.get("curvature") else {})}
                          for f in r["fits"]}}
        if model == "best":
            out["best"] = r["best"]
        return out

    return [
        Tool("scan_open", "Open a 3D scan (STL, PLY, OBJ, OFF, 3MF; glTF/GLB, Collada, VRML, 3DS in the units their format says) to measure, in place of the one open: units mm (default), cm, m or in. A scan with elements or dimensions on it is kept unless discard: true.", obj({"path": {"type": "string"}, "units": {"type": "string", "enum": list(S.UNITS)}, "discard": {"type": "boolean"}}, ["path"]), scan_open),
        Tool("scan_nearest", "Where a place lands on the scan: the vertex (a point snaps to the nearest), its coordinates and outward normal, a triangle it is a corner of, and how far it lies from the point asked about. Use it to check a point lies on the surface before fitting there. Changes nothing.", obj({"at": location("The place on the scan.")}, ["at"]), guarded(scan_nearest)),
        Tool("scan_query", "The scan's vertices inside a box, or within a radius of a point (near), with their outward normals — the points on a face; normal keeps only those facing a direction. Returns matched, the vertex numbers, points and normals (mm, current frame), the box round them, centroid and mean normal; fields: count, ids or all (the default) says how much. Trap: at most limit come back (1000 by default, 20000 at most), every k-th spread evenly, step saying k — mark: true marks every matching vertex, not the thinned list, for element_fit_marked { marked: true }. Changes nothing on the part.", obj({"box": BOX, "near": obj({"at": vec3("The centre, mm."), "radius": num("mm.", exclusiveMinimum=0)}, ["at", "radius"], "A ball about a point, in place of box."), "normal": NORMAL, "limit": integer("How many vertices at most; 1000 by default, 20000 at most.", minimum=1, maximum=20000), "mark": boolean("Leave every matching vertex marked, for element_fit_marked { marked: true }."), "fields": enum(["count", "ids", "all"], "count: the numbers alone (the default with mark); ids: with the vertices; all: with points and normals (the default).")}), guarded(scan_query)),
        Tool("scan_segment", "The scan's planar regions, found all at once: grown from the flattest places outward within maxDeg (15°) and maxRms (0.05 mm), those smaller than minArea given back. Returns found, considered, claimed and the regions, largest first, at most limit (20): id, normal, point, sigma, area (mm²), box, vertices, neighbours { id, deg }. mark: a region's id, or several, leaves their points marked for element_fit_marked { marked: true }. Changes nothing.", obj({"kind": enum(["plane"], "What to find; plane, the default and for now the only one."), "box": BOX, "minArea": num("mm²; by default a square 2 % of the scan's diagonal on a side.", minimum=0), "maxRms": num("mm; 0.05 by default.", exclusiveMinimum=0), "maxDeg": num("Degrees; 15 by default.", exclusiveMinimum=0, maximum=60), "limit": integer("How many regions are listed; 20 by default.", minimum=1, maximum=200), "mark": one_of([integer("A region's id.", minimum=1), arr(integer(minimum=1), "Several regions' ids.", minItems=1)], "Leave this region's points marked, or several regions'."), "list": boolean("With mark: the list of regions too.")}), guarded(scan_segment)),
        Tool("scan_fit_surface", "A patch of the scan measured as a surface — a sloped side, a twisted ruled face, a dome, a saddle — from vertices or a box (normal keeps those facing a way). Returns the patch's frame (origin, normal, basisU, basisV) and each model as a height over (u, v): plane (a + b·u + c·v), bilinear (+ d·u·v) and quadric (+ d·u² + e·u·v + f·v², with curvature { k1, k2, r1, r2, axis1, axis2, shape }), each with coefficients, rms and worst; model: best (the default) fits every one and names the simplest whose rms is within a tenth of the lowest. Trap: 7 points at least, at most limit (20000) spread evenly. Changes nothing.", obj({"vertices": arr(integer(minimum=0), "The scan vertices of the patch.", minItems=7), "box": BOX, "normal": NORMAL, "model": enum(["plane", "bilinear", "quadric", "best"], "Which surface; best (the default) fits each and names the simplest that holds."), "limit": integer("How many points at most; 20000 by default.", minimum=7, maximum=20000)}), guarded(scan_fit_surface)),
        Tool("scan_qa", "One call before modelling, to know what the scan will and will not give. Returns rims (the open edges of its holes: count, total length, the longest few with rim number, centre, size and circle where one fits), noise (the median scatter of small plane fits, mm; 0 on a CAD tessellation, with measured: the bends between facets), tessellation where the mesh is an STL exported from CAD (cad, sparse, densifyTo), thickness through the part along axis — given, the alignment's z, or the way most of it faces — (p5, p50, p95; the main faces' tiltDeg, run and faces { topDeg, bottomDeg }) and notes, what looks wrong, plainly. Trap: a scanned skin with no rims, or only pinholes, is a wrap bridging the holes it did not see through. Changes nothing.", obj({"axis": one_of([enum(["x", "y", "z"], "A world axis."), vec3("A direction, any length.")], "The thickness axis.")}), guarded(scan_qa)),
        Tool("scan_info", "The scan open: file, units, vertices, triangles, box, centre, area; and how many elements and dimensions are on it. Changes nothing.", obj({}), scan_info),
    ]
