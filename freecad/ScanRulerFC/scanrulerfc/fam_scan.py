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
DRAFT_LIMIT = 400_000
PATTERN_HEIGHTS, PATTERN_HEIGHTS_MAX, PATTERN_COUNT = 6, 12, 60
HEIGHT_CELLS, HEIGHT_SIDE, HEIGHT_CELLS_FINE, HEIGHT_SIDE_FINE, HEIGHT_LEVELS = 1600, 40, 25_600, 160, 12
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
        surface = NominalSurface(V, F)
        sheet = Q.sheet_reading(g, surface, noise["median"])
        gauge = sheet["gauge"] if sheet["gauge"] and sheet["twoSkins"] >= Q.SHEET_SHARE else None

        def sheet_notes(through=None):
            if not gauge:
                return []
            even = gauge["p95"] <= Q.SHEET_EVEN * gauge["p5"] + 2 * noise["median"] and gauge["p50"] <= Q.SHEET_GAUGE
            box = f" — thickness along {axis_name} (p50 {through:.1f} mm) reads the box across the part, not the {'sheet' if even else 'wall'}" if through is not None and through > 3 * gauge["p50"] else ""
            said = [f"{'Sheet metal' if even else 'Thin walls'}: two skins {gauge['p50']:.2f} mm apart over {round(100 * sheet['twoSkins'])} % of the area (p5–p95 {gauge['p5']:.2f}–{gauge['p95']:.2f} mm){box}."]
            regions = (sheet.get("apart") or {}).get("regions") or []
            if regions:
                n = len(regions) + sheet["apart"]["more"]
                said.append(f"{n} place{'s' if n != 1 else ''} stand{'s' if n == 1 else ''} over {sheet['apart']['reach']:.1f} mm off every main wall — tabs bent in, ribs, bosses (apart): the largest {round(regions[0]['area'])} mm² round {M.js(regions[0]['center'], 1)}. Model them too.")
            return said

        if gauge:
            out["sheet"] = {"gauge": {k: round(v, 3) for k, v in gauge.items()}, "twoSkins": round(sheet["twoSkins"], 3), "reach": round(sheet["reach"], 2), "sampled": sheet["sampled"]}
            if sheet.get("apart") and sheet["apart"]["regions"]:
                out["apart"] = {"reach": round(sheet["apart"]["reach"], 2), "regions": [{"center": M.js(r["center"], 2), "box": {"min": M.js(r["min"], 2), "max": M.js(r["max"], 2)}, "area": round(r["area"])} for r in sheet["apart"]["regions"]],
                                **({"more": sheet["apart"]["more"]} if sheet["apart"]["more"] else {})}
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
        us, vs, ts, tops, bots, u, v = Q.thickness_grid(surface, V, d)
        if len(ts) < 12:
            out["thickness"] = {"axis": M.js(d, 4), "axisFrom": frm, "cells": int(len(ts))}
            notes.append(f"Thickness along {axis_name}: too few rays went through the part to read it.")
            notes += sheet_notes()
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
        notes += sheet_notes(p50)
        out["notes"] = notes
        return out

    def scan_draft(a):
        import numpy as np

        from . import draft_core as DC

        st = S.state(session)
        scan = M.require_scan(st)
        pull = a["pull"]
        if not np.linalg.norm(pull) > 0:
            raise ToolError("invalid_input", "pull: give a direction, not a zero vector.")
        g = scan.graph()
        idx = np.arange(len(g.P))
        if a.get("box"):
            idx, _k, _s = M.query(scan, a["box"], None, None, len(g.P))
            idx = np.asarray(idx, dtype=np.int64)
        if len(idx) > DRAFT_LIMIT:
            idx = idx[:: len(idx) // DRAFT_LIMIT + 1]
        if len(idx) < 3:
            raise ToolError("invalid_input", "Too few scan points lie there to read a wall off.")
        split = None
        sp = a.get("split")
        if sp is not None:
            if isinstance(sp, dict):
                split = {"point": sp["point"], "normal": sp["normal"], "from": "the plane given"}
            elif str(sp).strip().lower() == "symmetry":
                el = next((e for e in reversed(st["elements"]) if e["kind"] == "plane" and e["source"].get("method") == "plane-symmetry"), None)
                if el:
                    split = {"point": el["fit"]["center"], "normal": el["fit"]["normal"], "from": el["name"]}
                else:
                    from .symmetry import accepted, find_symmetry

                    r = find_symmetry(scan)
                    if not r or not accepted(r):
                        raise ToolError("failed", "The scan has no mirror plane that holds — give split a plane instead.")
                    split = {"point": list(r["point"]), "normal": list(r["normal"]), "from": "the scan's mirror plane", "rms": r.get("rms")}
            elif str(sp).upper() in ("XY", "YZ", "XZ"):
                split = {"point": [0, 0, 0], "normal": {"XY": [0, 0, 1], "YZ": [1, 0, 0], "XZ": [0, 1, 0]}[str(sp).upper()], "from": str(sp).upper()}
            else:
                el = M.find_element(st, sp)
                if el["kind"] != "plane":
                    raise ToolError("invalid_input", f"split: {el['name']} is a {el['kind']} — a plane element, \"XY\", \"YZ\", \"XZ\", \"symmetry\" or {{ point, normal }}.")
                split = {"point": el["fit"]["center"], "normal": el["fit"]["normal"], "from": el["name"]}
        r = DC.draft_patches(g.P[idx], g.N[idx], pull, a.get("nearDeg", 10), a.get("patches", 12), a.get("minArea", 1.0),
                             {"point": split["point"], "normal": split["normal"]} if split else None)

        def v3(x):
            return M.js(x, 3)

        out = {"pull": v3(r["pull"]), "nearDeg": r["nearDeg"], "points": r["points"], "walls": r["walls"], "found": r["found"]}
        if split:
            out["split"] = {"point": v3(r["split"]["point"]), "normal": v3(r["split"]["normal"]), "from": split["from"]}
        out["patches"] = [{"draftDeg": round(p["draftDeg"], 3), "sigmaDeg": round(p["sigmaDeg"], 3), "spreadDeg": round(p["spreadDeg"], 2), "area": round(p["area"], 1),
                           "count": p["count"], "centroid": v3(p["centroid"]), "box": {"min": v3(p["min"]), "max": v3(p["max"])}, "facing": v3(p["facing"]),
                           "turnDeg": round(p["turnDeg"], 1), **({"round": True} if p.get("round") else {}), **({"side": p["side"]} if p.get("side") else {})}
                          for p in r["patches"]]
        return out

    def scan_pattern(a):
        import math

        import numpy as np

        from . import repeat_core as RC
        from . import section_core as SC
        from .construct import ref_axis

        st = S.state(session)
        scan = M.require_scan(st)
        ax = a["axis"]
        name = None
        if isinstance(ax, dict):
            origin, d = np.asarray(ax["origin"], float), np.asarray(ax["dir"], float)
        elif isinstance(ax, str) and ax.strip().lower() in ("x", "y", "z") and not any(e["name"].strip().lower() == ax.strip().lower() for e in st["elements"]):
            origin, d = np.zeros(3), np.eye(3)["xyz".index(ax.strip().lower())]
            name = ax.strip().upper()
        else:
            el = M.find_element(st, ax)
            line = ref_axis(el["fit"]) if el.get("fit") and el["kind"] in ("cylinder", "cone", "line", "circle") else None
            if line is None:
                raise ToolError("invalid_input", f"{el['name']} has no axis — choose a cylinder, cone, line or circle.")
            origin, d, name = line["origin"], line["dir"], el["name"]
        if not np.linalg.norm(d) > 1e-9:
            raise ToolError("invalid_input", "axis.dir: give a direction, not a zero vector.")
        d = d / np.linalg.norm(d)
        big = int(np.argmax(np.abs(d)))
        if d[big] < 0:
            d = -d
        origin = origin - (origin @ d) * d  # the world origin's foot on the axis
        zero = np.cross(d, np.eye(3)[int(np.argmin(np.abs(d)))])
        zero /= np.linalg.norm(zero)
        quarter = np.cross(d, zero)
        heights = a.get("at")
        if not heights:
            h = scan.V @ d
            lo, hi = float(h.min()), float(h.max())
            heights = [round(lo + (i + 0.5) / PATTERN_HEIGHTS * (hi - lo), 3) for i in range(PATTERN_HEIGHTS)]
        if len(heights) > PATTERN_HEIGHTS_MAX:
            raise ToolError("invalid_input", f"at: {PATTERN_HEIGHTS_MAX} heights at most.")
        rad = a.get("radius") or {}
        out = []
        for h in heights:
            o = origin + h * d
            P, off, _N = SC.slice_mesh(scan.V, scan.F, o, d, SC.EDGE_MIN_FEATURE_MM)
            flat = SC.project_cut(P, {"origin": o, "basisU": zero, "basisV": quarter})
            r = RC.rotational_repeat(SC.chains_of(flat, off), rad.get("min", 0.0), rad.get("max", math.inf), a.get("count", PATTERN_COUNT))
            rings = [{"radius": round(g["radius"], 3), "off": round(g["off"], 3), "towardDeg": round(g["towardDeg"], 1), "rms": round(g["rms"], 4)} for g in r["rings"]]
            if r["count"] == 1:
                out.append({"at": h, "count": 1, "length": round(r["length"], 1), **({"tried": {"count": r["tried"]["count"], "score": round(r["tried"]["score"], 3)}} if r.get("tried") else {}), "rings": rings})
                continue
            row = {"at": h, "count": r["count"], "pitchDeg": round(r["pitchDeg"], 4), "phaseDeg": round(r["phaseDeg"], 2),
                   "betweenDeg": round((r["phaseDeg"] + r["pitchDeg"] / 2) % 360, 2), "score": round(r["score"], 3), "rms": round(r["rms"], 4),
                   "worst": round(r["worst"], 3), "worstInstance": r["worstInstance"], "length": round(r["length"], 1), "rings": rings}
            if a.get("instances", True):
                row["instances"] = [{"angleDeg": round(c["angleDeg"], 2), "offDeg": round(c["offDeg"], 3), "radius": round(c["radius"], 3), "rms": round(c["rms"], 4),
                                     "worst": round(c["worst"], 3), "share": round(c["share"], 2)} for c in r["instances"]]
            out.append(row)
        return {"axis": {**({"name": name} if name else {}), "origin": M.js(origin, 6), "dir": M.js(d, 6), "zeroDir": M.js(zero, 6)}, "heights": out}

    def scan_heightmap(a):
        import os

        import numpy as np

        from . import heightmap_core as HM
        from .dev_surface import NominalSurface

        st = S.state(session)
        scan = M.require_scan(st)
        look = a.get("axis", "-z")
        k = "xyz".index(look[1])
        sign = 1 if look[0] == "+" else -1
        V = scan.V
        lo, hi = V.min(0), V.max(0)
        if a.get("box"):
            b = a["box"]
            if any(b["min"][i] > b["max"][i] for i in range(3)):
                raise ToolError("invalid_input", "The box's min lies past its max.")
            lo, hi = np.maximum(lo, b["min"]), np.minimum(hi, b["max"])
        want_levels = a.get("levels", False)
        show_grid = a.get("grid", not want_levels)
        g = HM.grid_over(lo, hi, k, a.get("cell"), HEIGHT_SIDE if show_grid else HEIGHT_SIDE_FINE, HEIGHT_CELLS if show_grid else HEIGHT_CELLS_FINE)
        surf = getattr(scan, "_surface", None)
        if surf is None or surf[0] != scan.version:
            surf = (scan.version, NominalSurface(V, scan.F))
            scan._surface = surf
        h = HM.heights(surf[1], lo, hi, k, sign, g)
        fin = np.isfinite(h)
        names = "xyz"
        out = {"axis": look, "along": names[k], "across": [names[g["ua"]], names[g["va"]]], "of": "height", "cell": g["cell"],
               **({"note": f"cell widened to {g['cell']} mm to keep the cells few"} if g["widened"] else {}),
               "origin": [round(g["u0"], 3), round(g["v0"], 3)], "cols": g["cols"], "rows": g["rows"], "hit": int(fin.sum()), "valued": int(fin.sum()),
               "min": round(float(h[fin].min()), 3) if fin.any() else None, "max": round(float(h[fin].max()), 3) if fin.any() else None}
        if show_grid:
            out["grid"] = [[None if not np.isfinite(x) else round(float(x), 2) for x in h[r * g["cols"]:(r + 1) * g["cols"]]] for r in range(g["rows"])]
        if want_levels:
            slope = a.get("slopeDeg", HM.LEVEL_SLOPE_DEG)
            steep = HM.sloped_cells(h, g["cols"], g["rows"], g["cell"], slope)
            counted = h.copy()
            counted[steep] = np.nan
            noise = HM.cell_noise(counted, g["cols"], g["rows"])
            found = HM.levels(counted, g, a.get("gap") or max(3 * noise, HM.LEVEL_GAP_MIN), h)
            out.update(slopeDeg=slope, sloped=int(steep.sum()), noise=round(noise, 4), gap=round(found["gap"], 4))

            def plane_out(p):
                su, sv = p["slope"]
                origin = np.zeros(3)
                origin[g["ua"]], origin[g["va"]], origin[k] = p["at"]
                n = np.zeros(3)
                n[k], n[g["ua"]], n[g["va"]] = 1.0, -su, -sv
                n = -sign * n / np.linalg.norm(n)
                return {"origin": M.js(origin, 3), "normal": M.js(n, 5)}

            out["levels"] = [{"height": round(l["height"], 3), "sigma": round(l["sigma"], 4), "range": [round(x, 3) for x in l["range"]], "cells": l["cells"],
                              "area": round(l["area"], 2), "sharePct": round(100 * l["share"], 1), "box": {"min": M.js(l["box"]["min"], 3), "max": M.js(l["box"]["max"], 3)},
                              **({"plane": plane_out(l["plane"])} if l["share"] >= 0.05 else {})} for l in found["levels"][:HEIGHT_LEVELS]]
            if len(found["levels"]) > HEIGHT_LEVELS:
                out["moreLevels"] = len(found["levels"]) - HEIGHT_LEVELS
            out["unassigned"] = found["unassigned"]
        if a.get("picture"):
            from agentlink import render as R

            img = np.zeros((g["rows"], g["cols"], 3)) + R.BG
            if fin.any():
                cols_ = R.colours_for(h[fin], float(h[fin].min()), float(h[fin].max()))
                img.reshape(-1, 3)[fin] = cols_
            img = img[::-1]
            scale = max(1, int(600 // max(g["cols"], g["rows"])))
            img = np.repeat(np.repeat(img, scale, 0), scale, 1)
            path = a.get("path") or os.path.join(session.out_dir, f"{os.path.splitext(scan.name)[0]}-heightmap-{look.replace('+', 'p').replace('-', 'm')}.png")
            with open(path, "wb") as f:
                f.write(R.png(img))
            out["picture"] = {"path": path, "note": "jet: low blue to high red; up in the picture is +" + names[g["va"]]}
        return out

    def scan_cloud(a):
        st = S.state(session)
        scan = M.require_scan(st)
        g = scan.graph()
        fmt = a.get("format", "ply")
        path = a.get("path") or os.path.join(session.out_dir, f"{os.path.splitext(scan.name)[0]}-cloud.{fmt}")
        if fmt == "xyz":
            import numpy as np

            np.savetxt(path, np.hstack([g.P, g.N]), fmt="%.5f")
        else:
            import numpy as np

            rec = np.zeros(len(g.P), dtype=[("p", "<f4", 3), ("n", "<f4", 3)])
            rec["p"], rec["n"] = g.P, g.N
            head = ("ply\nformat binary_little_endian 1.0\ncomment ScanRuler for FreeCAD\n"
                    f"element vertex {len(g.P)}\nproperty float x\nproperty float y\nproperty float z\nproperty float nx\nproperty float ny\nproperty float nz\nend_header\n")
            with open(path, "wb") as f:
                f.write(head.encode())
                f.write(rec.tobytes())
        return {"file": {"path": path, "name": os.path.basename(path), "bytes": os.path.getsize(path)}, "points": int(len(g.P)), "format": fmt,
                "note": "Every vertex with its outward normal, mm, in the pose the scan is measured in now."}

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
        Tool("scan_qa", "One call before modelling, to know what the scan will and will not give. Returns rims (the open edges of its holes: count, total length, the longest few with rim number, centre, size and circle where one fits), noise (the median scatter of small plane fits, mm; 0 on a CAD tessellation, with measured: the bends between facets), sheet where most of the area has a second skin facing back within reach (gauge { p5, p50, p95 }, twoSkins: that share), apart on such a part with flat walls (what stands over reach off every main wall — tabs bent in, ribs, bosses), tessellation where the mesh is an STL exported from CAD (cad, sparse, densifyTo), thickness through the part along axis — given, the alignment's z, or the way most of it faces — (p5, p50, p95; the main faces' tiltDeg, run and faces { topDeg, bottomDeg }) and notes, what looks wrong, plainly. Traps: a scanned skin with no rims, or only pinholes, is a wrap bridging the holes it did not see through; on a sheet or a thin shell, thickness reads the box across the part — the wall is sheet.gauge. Changes nothing.", obj({"axis": one_of([enum(["x", "y", "z"], "A world axis."), vec3("A direction, any length.")], "The thickness axis.")}), guarded(scan_qa)),
        Tool("scan_draft", "The scan's walls that run near a pull direction — the sides a mould opens along — gathered into patches, each with draftDeg, the angle it leans off the pull: positive where the wall faces partly along the pull, negative where it faces back (a back draft, an undercut); with sigmaDeg, spreadDeg, centroid, box, area (mm²), count, facing, turnDeg and round for a boss's or hole's round side. Needs pull; box, nearDeg (10), patches (12), minArea (1 mm²) and split (a plane no patch reaches across: \"symmetry\", a plane element, \"XY\", \"YZ\", \"XZ\" or { point, normal }) narrow it. Trap: read it early on a moulded or cast part, along each direction the tools open — walls that lean half a degree to a few explain fits that miss by the lean. Changes nothing.", obj({"pull": vec3("The pull direction, any length."), "box": BOX, "nearDeg": num("Degrees off square to the pull a wall may lean and count; 10 by default.", exclusiveMinimum=0, maximum=45), "patches": integer("How many patches, the largest first; 12 by default.", minimum=1, maximum=100), "minArea": num("mm²; 1 by default.", minimum=0), "split": one_of([{"type": ["string", "integer"]}, obj({"point": vec3("A point on the plane."), "normal": vec3("Its normal.")}, ["point", "normal"])], "A plane no patch reaches across.")}, ["pull"]), guarded(scan_draft)),
        Tool("scan_pattern", "Rotational repeats about an axis — a fan's blades, a flange's holes, a wheel's spokes, a gear's teeth — counted from the scan: it is cut square to the axis at each height in at (six spread over the part by default), and each cut (between radius.min and radius.max) is turned against itself. Needs axis: a cylinder, cone, line or circle element, \"X\", \"Y\", \"Z\", or { origin, dir }. Returns per height count, pitchDeg, phaseDeg (from zeroDir), betweenDeg, score (0 to 1; under 0.5 count is 1 and tried says the best), rms, worst, instances (angleDeg, radius, offDeg, rms, worst, share — a copy out of place or worn reads off) and rings (round outlines about the axis: radius, off, towardDeg, rms). Changes nothing.", obj({"axis": one_of([{"type": ["string", "integer"]}, obj({"origin": vec3("A point on the axis."), "dir": vec3("Its direction.")}, ["origin", "dir"])], "The axis the pattern turns about."), "at": arr(num("Height along the axis, mm."), "Heights to cut at.", minItems=1), "radius": obj({"min": num("mm.", minimum=0), "max": num("mm.", exclusiveMinimum=0)}, [], "Only the outline between these radii."), "count": integer("The most copies looked for; 60 by default.", minimum=2, maximum=128), "instances": boolean("Each copy's figures; true by default.")}, ["axis"]), guarded(scan_pattern)),
        Tool("scan_heightmap", "Where the scan is first met looking along an axis (axis, -z by default: the top surface from above), over a grid of cells: pocket floors, ledges, a step's height, a face's tilt, a pad's tiers in one call. Returns cell, origin [u0, v0], cols, rows, grid (rows of mm from the low v up, null where nothing; grid[r][c] stands at u0 + (c + ½)·cell, v0 + (r + ½)·cell), min, max, hit. levels: true gathers the heights into levels in place of the grid, largest first — the sloped cells (past slopeDeg, 10°) left out first — each holding 5 % of the map or more with its plane { origin, normal } (normal toward the viewer), which align_datum can level on. picture: true writes the map coloured as a PNG. box is in the world. Changes nothing.", obj({"axis": enum(["+x", "-x", "+y", "-y", "+z", "-z"], "The way looked: -z (the default) from above."), "box": BOX, "cell": num("mm.", exclusiveMinimum=0), "grid": boolean("The grid of numbers; the default without levels."), "levels": boolean("The heights gathered into levels."), "gap": num("levels: the least gap between two levels, mm.", exclusiveMinimum=0), "slopeDeg": num("levels: cells steeper than this are left out, degrees.", exclusiveMinimum=0, maximum=80), "picture": boolean("Write the map coloured as a PNG."), "path": {"type": "string"}}), guarded(scan_heightmap)),
        Tool("scan_cloud", "The scan as a point cloud: every vertex with its outward normal, in the pose it is measured in now, as binary PLY (the default) or XYZ text (x y z nx ny nz a line). path, or with your files. Changes nothing.", obj({"format": enum(["ply", "xyz"], "ply or xyz."), "path": {"type": "string"}}), guarded(scan_cloud)),
        Tool("scan_info", "The scan open: file, units, vertices, triangles, box, centre, area; and how many elements and dimensions are on it. Changes nothing.", obj({}), scan_info),
    ]
