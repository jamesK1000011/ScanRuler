# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/commands/core/flat.ts
# (flat.open_image, flat.calibrate, flat.detect_edges, flat.edges, flat.fit,
# flat.dimension_add, flat.report), src/core/flat/construct.ts (the methods),
# src/app/flatReport.ts and the exports src/core/flat/dxf.ts and svg.ts.
#
# The 2D sheet: a flatbed image, or the section cut last. A place on the
# sheet is in the sheet's units — millimetres once calibrated (a section
# always is), pixels before — with the origin at the image's bottom-left
# corner, +X right, +Y up.

import math
import os

import numpy as np

from agentlink.protocol import Tool, ToolError

from . import flat_core as FC
from . import scanstate as S
from .fam_sections import find_section, flat_chains, sec_state
from .geom2d import FitError, fit_arc, fit_arc_region, fit_circle, fit_circle_region, fit_line, fit_line_region, flat_point

GROUP = "flat"
INFO = "The 2D sheet (ScanRuler, ported): a flatbed image or a section — calibrate, detect edges, fit lines and circles, dimension, report, DXF/SVG."

METHODS = {
    "point": [("flat-point-pick", "pick", 1), ("flat-point-midpoint", "construct", ["point", "point"]), ("flat-point-intersect", "construct", ["line", "line"]), ("flat-point-center", "construct", ["point"])],
    "line": [("flat-line-pick", "pick", 2), ("flat-line-seed", "seed", 4), ("flat-line-edge", "edge", 8)],
    "circle": [("flat-circle-pick", "pick", 3), ("flat-circle-seed", "seed", 6), ("flat-circle-edge", "edge", 12), ("flat-circle-centers", "construct", ["point", "point", "point"])],
    "arc": [("flat-arc-pick", "pick", 3), ("flat-arc-edge", "edge", 12)],
}
COLORS = ["#e4572e", "#2e86ab", "#a23b72", "#f18f01", "#3b8132", "#6a4c93"]


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


def fl_state(session):
    st = S.state(session)
    f = st.setdefault("flatState", {"subject": None, "image": None, "pxPerMm": None, "calSource": "none", "chains": None, "sensitivity": 0.5, "elements": [], "dimensions": [], "nextEl": 1, "nextDim": 1})
    want = st.get("flatSubject")
    if want and want != f["subject"]:
        # A section put on the sheet (section_cut): its cut is the sheet's
        # edges, in millimetres.
        f.update({"subject": dict(want), "elements": [], "dimensions": [], "nextEl": 1, "nextDim": 1, "chains": None})
    return f


def sheet(session):
    """(units, scale per chain unit {x, y}, chains in chain units, what)."""
    f = fl_state(session)
    subj = f["subject"]
    if subj is None:
        raise ToolError("invalid_state", "Nothing is on the 2D sheet — open an image with flat_open_image, or cut a section.")
    if subj["kind"] == "section":
        sec = find_section(session, subj["id"])
        return "mm", {"x": 1.0, "y": 1.0}, [c for c in flat_chains(sec)], sec
    p = f["pxPerMm"]
    unit = {"x": 1 / p["x"], "y": 1 / p["y"]} if p else {"x": 1.0, "y": 1.0}
    return ("mm" if p else "px"), unit, f["chains"] or [], None


def to_doc(p, unit):
    return np.array([p[0] * unit["x"], p[1] * unit["y"]])


def doc_chains(session):
    units, unit, chains, _ = sheet(session)
    return [np.asarray(c, dtype=float) * np.array([unit["x"], unit["y"]]) for c in chains], units


def nearest_on_chain(chains, p, radius):
    """The nearest point of the edges within radius of p: (at, chain, d)."""
    best = None
    for ci, c in enumerate(chains):
        if len(c) < 2:
            continue
        a, b = c[:-1], c[1:]
        d = b - a
        L = (d * d).sum(1)
        t = np.clip(np.where(L > 0, ((p - a) * d).sum(1) / np.where(L > 0, L, 1), 0), 0, 1)
        q = a + d * t[:, None]
        dist = np.linalg.norm(q - p, axis=1)
        k = int(np.argmin(dist))
        if dist[k] <= radius and (best is None or dist[k] < best[2]):
            best = (q[k], ci, float(dist[k]))
    return best


def element_named(f, ref):
    if isinstance(ref, int) and not isinstance(ref, bool):
        hits = [e for e in f["elements"] if e["id"] == ref]
    else:
        hits = [e for e in f["elements"] if e["name"].strip().lower() == str(ref).strip().lower()]
    if not hits:
        raise ToolError("not_found", f"There is no 2D element {ref!r}.")
    if len(hits) > 1:
        raise ToolError("invalid_input", f"{len(hits)} 2D elements are named {ref!r} — name it by its id.")
    return hits[0]


def rounded(v):
    if isinstance(v, float):
        return round(v, 6)
    if isinstance(v, list):
        return [rounded(x) for x in v]
    if isinstance(v, dict):
        return {k: rounded(x) for k, x in v.items()}
    return v


def evaluated(f, units):
    out = []
    for d in f["dimensions"]:
        els = [next((e for e in f["elements"] if e["id"] == i), None) for i in d["refs"]]
        title = " → ".join(e["name"] if e else "?" for e in els)
        if all(e and e.get("fit") for e in els):
            v = FC.evaluate_dimension(d["type"], [e["fit"] for e in els], units)
        else:
            v = {"label": "Dimension", "invalid": "A referenced element is unavailable."}
        out.append({"dim": d, "title": title, "value": v})
    return out


def report_input(session):
    f = fl_state(session)
    units, _unit, _c, sec = sheet(session)
    r = {"imageName": f["image"]["name"] if f["image"] else "", "imageWidth": f["image"]["width"] if f["image"] else 0, "imageHeight": f["image"]["height"] if f["image"] else 0,
         "calSource": "section" if sec else f["calSource"], "pxPerMm": f["pxPerMm"], "unit": units, "elements": f["elements"],
         "dimensions": [{"title": d["title"], "value": d["value"]} for d in evaluated(f, units)]}
    if sec:
        r["section"] = {"name": sec["name"], "scanName": S.scan_of(session).name, "cut": f"across {sec['across']}, offset {round(sec['offset'], 3)} mm"}
    return r


def describe_flat(session):
    f = fl_state(session)
    units, _u, chains, sec = sheet(session) if f["subject"] else (None, None, [], None)
    return {"subject": f["subject"], "image": None if not f["image"] else {k: f["image"][k] for k in ("fileName", "width", "height", "decoder")},
            "units": units, "calibration": {"source": "section" if sec else f["calSource"], "pxPerMm": f["pxPerMm"]},
            "edges": {"chains": len(chains), "sensitivity": f["sensitivity"]},
            "elements": [{"id": e["id"], "name": e["name"], "kind": e["kind"], "fit": rounded(e["fit"])} for e in f["elements"]],
            "dimensions": [{"id": d["dim"]["id"], "name": d["dim"]["name"], "type": d["dim"]["type"], "refs": d["dim"]["refs"], "value": rounded(d["value"].get("raw"))} for d in evaluated(f, units or "mm")]}


def read_image(path, data):
    """(gray rows top first, width, height, decoder): Qt's QImage from
    FreeCAD's PySide where it loads, else this port's PNG reader."""
    try:
        from PySide import QtGui  # FreeCAD's PySide shim

        img = QtGui.QImage()
        if img.loadFromData(data) and not img.isNull():
            img = img.convertToFormat(QtGui.QImage.Format_Grayscale8)
            w, h = img.width(), img.height()
            bpl = img.bytesPerLine()
            buf = bytes(img.constBits())[: bpl * h] if hasattr(img, "constBits") else bytes(img.bits())[: bpl * h]
            g = np.frombuffer(buf, dtype=np.uint8).reshape(h, bpl)[:, :w].copy()
            return g, w, h, "QImage"
    except Exception:
        pass
    if FC.is_png(data):
        g, w, h = FC.decode_png_gray(data)
        return g, w, h, "png (zlib)"
    raise ValueError("only PNG is read where Qt's image reader is not available — save the scan as PNG")


def tools(session):
    def detect(f, sensitivity):
        img = f["image"]
        p = f["pxPerMm"]
        min_len = FC.EDGE_MIN_FEATURE_MM * p["x"] if p else 24
        f["chains"] = FC.detect_edges(img["gray"], sensitivity, min_length=min_len)
        f["sensitivity"] = sensitivity
        return len(f["chains"])

    def flat_open_image(a):
        path = a.get("path")
        if not path or not os.path.isfile(path):
            raise ToolError("not_found", f"path {path!r}: no such file — give the image's path on this computer.")
        with open(path, "rb") as fh:
            data = fh.read()
        try:
            gray, w, h, decoder = read_image(path, data)
        except ValueError as e:
            raise ToolError("invalid_input", f"{os.path.basename(path)}: {e}")
        f = fl_state(session)
        ppm = FC.image_pixels_per_mm(data)
        S.state(session)["flatSubject"] = {"kind": "image", "name": os.path.basename(path)}
        f = fl_state(session)
        # Rows bottom first: the sheet's y runs up.
        f.update({"image": {"name": os.path.basename(path), "fileName": os.path.basename(path), "width": w, "height": h, "gray": gray[::-1].copy(), "decoder": decoder},
                  "pxPerMm": ppm, "calSource": "metadata" if ppm else "none"})
        detect(f, f["sensitivity"])
        return {"flat": describe_flat(session)}

    def flat_calibrate(a):
        f = fl_state(session)
        units, unit, _c, sec = sheet(session)
        if sec:
            raise ToolError("invalid_state", "A section is in millimetres already.")
        mode, pts, mm = a["mode"], a["points"], a["mm"]
        if mode == "distance" and len(pts) != 2:
            raise ToolError("invalid_input", "distance takes two places.")
        if mode == "diameter" and len(pts) < 3:
            raise ToolError("invalid_input", "diameter takes three places or more.")
        px = [[p[0] / unit["x"], p[1] / unit["y"]] for p in pts]
        try:
            ppm = FC.distance_calibration(px[0], px[1], mm, f["pxPerMm"]) if mode == "distance" else FC.diameter_calibration(px, mm)
        except FitError as e:
            raise ToolError("invalid_input", str(e))
        f.update({"pxPerMm": ppm, "calSource": "measured"})
        # Elements keep their places on the image: their fits scale with it.
        k = {"x": unit["x"] * ppm["x"], "y": unit["y"] * ppm["y"]}
        for e in f["elements"]:
            e["fit"] = scale_fit(e["fit"], 1 / k["x"])
        detect(f, f["sensitivity"])
        return {"calibration": {"source": "measured", "pxPerMm": rounded(ppm), "dpi": round(ppm["x"] * 25.4, 2)}, "chains": len(f["chains"])}

    def flat_detect_edges(a):
        f = fl_state(session)
        _u, _s, _c, sec = sheet(session)
        if sec:
            return {"chains": len(flat_chains(sec)), "note": "A section's cut is its edges, every one, in millimetres."}
        return {"chains": detect(f, a.get("sensitivity", f["sensitivity"]))}

    def flat_edges(a):
        chains, units = doc_chains(session)
        out = []
        for i, c in enumerate(chains):
            closed = len(c) > 3 and math.hypot(*(c[0] - c[-1])) <= 2 * float(np.median(np.hypot(*np.diff(c, axis=0).T)) or 1)
            out.append({"chain": i, "points": int(len(c)), "length": round(float(np.hypot(*np.diff(c, axis=0).T).sum()), 4), "closed": bool(closed), "bounds": {"min": rounded(c.min(0).tolist()), "max": rounded(c.max(0).tolist())}})
        out.sort(key=lambda x: -x["length"])
        limit = a.get("limit", 50)
        return {"units": units, "total": len(chains), "chains": out[:limit]}

    def flat_fit(a):
        f = fl_state(session)
        kind = a["kind"]
        methods = METHODS[kind]
        by_edges = a.get("chains") is not None or a.get("box") is not None
        mid = a.get("method") or next((m[0] for m in methods if m[1] == ("edge" if by_edges else "pick")), methods[0][0])
        m = next((x for x in methods if x[0] == mid), None)
        if m is None:
            raise ToolError("invalid_input", f"A 2D {kind} has no method \"{mid}\" — it has {', '.join(x[0] for x in methods)}.")
        if m[1] == "seed":
            raise ToolError("invalid_input", f"{mid}: growing a fit along an edge from one place is not ported to ScanRuler for FreeCAD yet — use the edge method with chains or box, or pick points.")
        chains, units = doc_chains(session)
        _u, unit, _c, _sec = sheet(session)
        picks = None
        try:
            if m[1] == "construct":
                refs = [element_named(f, r) for r in (a.get("refs") or [])]
                slots = m[2]
                if (len(refs) < len(slots)) if mid == "flat-circle-centers" else (len(refs) != len(slots)):
                    raise ToolError("invalid_input", f"{mid} takes {len(slots)}{' or more' if mid == 'flat-circle-centers' else ''} source element{'s' if len(slots) > 1 else ''}.")
                fit = construct(mid, [e["fit"] for e in refs])
            elif m[1] == "edge":
                if not chains:
                    raise ToolError("invalid_state", "No edges are detected on the sheet — flat_detect_edges finds them, more faintly at a higher sensitivity.")
                pts = edge_points(chains, a.get("chains"), a.get("box"))
                if len(pts) == 0:
                    raise ToolError("invalid_input", "No point of those chains lies inside the box." if a.get("chains") else "No detected edge point lies inside the box.")
                fit = {"line": fit_line_region, "circle": fit_circle_region, "arc": fit_arc_region}[kind](pts)
            else:
                pts = a.get("points") or []
                if len(pts) < m[2]:
                    raise ToolError("invalid_input", f"{mid} takes {m[2]} point{'s' if m[2] > 1 else ''} or more.")
                reach = a.get("reach", 10 * unit["x"])
                picks, placed = [], []
                for p in pts:
                    p = np.array(p, dtype=float)
                    hit = nearest_on_chain(chains, p, reach) if a.get("snap", True) and chains else None
                    if hit:
                        placed.append(hit[0])
                        picks.append({"at": rounded(hit[0].tolist()), "chain": hit[1], "moved": round(hit[2], 6)})
                    else:
                        placed.append(p)
                        picks.append({"at": rounded(p.tolist())})
                placed = np.array(placed)
                fit = flat_point(placed[0]) if kind == "point" else {"line": fit_line, "circle": fit_circle, "arc": fit_arc}[kind](placed)
        except FitError as e:
            raise ToolError("failed", str(e))
        eid = f["nextEl"]
        f["nextEl"] += 1
        count = sum(1 for e in f["elements"] if e["kind"] == kind) + 1
        el = {"id": eid, "name": a.get("name") or f"{kind.capitalize()} {count}", "kind": kind, "method": mid, "fit": fit}
        f["elements"].append(el)
        return {"element": {"id": eid, "name": el["name"], "kind": kind, "fit": rounded(fit)}, **({"picks": picks} if picks else {})}

    def flat_dimension_add(a):
        f = fl_state(session)
        units, _u, _c, _s = sheet(session)
        els = [element_named(f, r) for r in a["refs"]]
        roles = [FC.role_of(e["kind"]) for e in els]

        def fits(tid):
            t = next(x for x in FC.DIMENSION_TYPES if x["id"] == tid)
            return t["slots"] == roles

        chosen = a.get("type") or next((t["id"] for t in FC.DIMENSION_TYPES if fits(t["id"])), None)
        if not chosen or not fits(chosen):
            raise ToolError("invalid_input", f"{' and '.join(e['name'] for e in els)} make no {a.get('type') or '2D'} dimension in that order.")
        did = f["nextDim"]
        f["nextDim"] += 1
        group = next(t["group"] for t in FC.DIMENSION_TYPES if t["id"] == chosen)
        n = sum(1 for d in f["dimensions"] if next(t["group"] for t in FC.DIMENSION_TYPES if t["id"] == d["type"]) == group) + 1
        f["dimensions"].append({"id": did, "type": chosen, "name": a.get("name") or f"{'Angle' if group == 'angle' else 'Distance'} {n}", "refs": [e["id"] for e in els]})
        return {"flat": describe_flat(session), "report": FC.build_report(report_input(session))}

    def flat_report(a):
        return {"text": FC.build_report(report_input(session)), "flat": describe_flat(session)}

    def flat_export(a):
        f = fl_state(session)
        units, unit, chains, sec = sheet(session)
        fmt = a["format"]
        r = report_input(session)
        if sec:
            pts = np.vstack(chains) if chains else np.zeros((1, 2))
            pad = 0.05 * max(float(np.ptp(pts[:, 0])), float(np.ptp(pts[:, 1])), 1.0)
            bounds = {"min": (pts.min(0) - pad).tolist(), "max": (pts.max(0) + pad).tolist()}
        else:
            img = f["image"]
            bounds = {"min": [0.0, 0.0], "max": [img["width"] * unit["x"], img["height"] * unit["y"]]}
        drawing = {"bounds": bounds, "chains": chains, "chainUnit": unit, "unit": units, "title": FC.title_line(r), "scaleNote": FC.scale_line(r),
                   "elements": [{"fit": e["fit"], "color": COLORS[i % len(COLORS)], "name": e["name"], "value": FC.format_primary(e["fit"], units)} for i, e in enumerate(f["elements"])],
                   "edgeTolerance": FC.DXF_EDGE_TOLERANCE["mm" if units == "mm" else "px"], "origin": None}
        text = FC.build_dxf(drawing) if fmt == "dxf" else FC.build_svg(drawing)
        stem = os.path.splitext(f["image"]["name"])[0] if not sec and f["image"] else (sec["name"].replace(" ", "-") if sec else "sheet")
        path = a.get("path") or os.path.join(session.out_dir, f"{stem}.{fmt}")
        with open(path, "w", encoding="utf-8" if fmt == "svg" else "latin-1", errors="replace") as fh:
            fh.write(text)
        return {"file": {"path": path, "bytes": os.path.getsize(path)}, "elements": len(drawing["elements"]), "chains": len(chains or [])}

    spot = {"type": "array", "items": {"type": "number"}, "minItems": 2, "maxItems": 2}
    ref = {"oneOf": [{"type": "integer", "minimum": 1}, {"type": "string", "minLength": 1}]}
    def flat_objects(a):
        import math

        from . import flat_objects as FO

        f = fl_state(session)
        img = f.get("image")
        if f["subject"] is None or f["subject"].get("kind") == "section" or not img:
            raise ToolError("invalid_state", "flat_objects reads a flatbed image: flat_open_image first.")
        units, unit, _chains, _ = sheet(session)
        sx, sy = unit["x"], unit["y"]
        min_area = a.get("minArea", 4 * sx * sy * 100)
        r = FO.find_objects(img["gray"], sx, sy, min_area, a.get("threshold"), a.get("dark"), a.get("minHoleArea"))
        f["objects"] = r["objects"]

        def rd(v, d=4):
            return round(float(v), d)

        out = []
        for i, o in enumerate(r["objects"]):
            row = {"object": i + 1, "area": rd(o["area"], 3), "holes": o["holes"], "box": {"min": [rd(x) for x in o["box"]["min"]], "max": [rd(x) for x in o["box"]["max"]]},
                   "centroid": [rd(x) for x in o["centroid"]], "equivalentDiameter": rd(o["equivalentDiameter"]),
                   "feret": {"max": rd(o["feret"]["max"]), "maxAngleDeg": rd(math.degrees(o["feret"]["maxAngle"]), 2), "min": rd(o["feret"]["min"]), "minAngleDeg": rd(math.degrees(o["feret"]["minAngle"]), 2)},
                   "axisAngleDeg": rd(math.degrees(o["axisAngle"]), 2)}
            if a.get("outline"):
                row["outline"] = [[rd(x, 3), rd(y, 3)] for x, y in o["outline"][:: max(1, len(o["outline"]) // 400)]]
            out.append(row)
        return {"units": units, "threshold": r["threshold"], "dark": r["dark"], "count": len(out), "objects": out[: a.get("limit", 100)],
                **({"more": len(out) - a.get("limit", 100)} if len(out) > a.get("limit", 100) else {}),
                "note": "In reading order: rows from the top of the sheet down, left to right. flat_profile takes them by number."}

    def flat_profile(a):
        import math

        from . import flat_objects as FO

        f = fl_state(session)
        units, unit, chains, _ = sheet(session)
        if a.get("object") is not None:
            objs = f.get("objects")
            if not objs:
                raise ToolError("invalid_state", "No objects yet: flat_objects first.")
            if not 1 <= a["object"] <= len(objs):
                raise ToolError("invalid_input", f"object: 1 to {len(objs)}.")
            o = objs[a["object"] - 1]
            P = o["outline"]
        elif a.get("chains"):
            dc, _u = doc_chains(session)
            bad = [i for i in a["chains"] if not 0 <= i < len(dc)]
            if bad:
                raise ToolError("invalid_input", f"chains: 0 to {len(dc) - 1}.")
            P = np.concatenate([dc[i] for i in a["chains"]])
            o = None
        else:
            raise ToolError("invalid_input", "Give object (a number from flat_objects) or chains.")
        kind = a.get("kind", "radial")
        if a.get("about") is not None:
            el = element_named(f, a["about"])
            if kind == "radial":
                c = FC.ref_point(el["fit"])
                if c is None:
                    raise ToolError("invalid_input", f"{el['name']} has no centre: a radial profile is read about a circle, an arc or a point.")
                about = {"kind": "radial", "center": c}
            else:
                ln = FC.ref_line(el["fit"])
                if ln is None:
                    raise ToolError("invalid_input", f"{el['name']} is no line: an axial profile is read along a line.")
                about = {"kind": "axial", "origin": ln[0], "dir": ln[1]}
        elif kind == "radial":
            about = {"kind": "radial", "center": o["centroid"] if o else P.mean(0)}
        else:
            ang = o["axisAngle"] if o else math.atan2(*np.linalg.eigh(np.cov((P - P.mean(0)).T))[1][:, 1][::-1])
            about = {"kind": "axial", "origin": o["centroid"] if o else P.mean(0), "dir": [math.cos(ang), math.sin(ang)]}
        floor = 1.5 * max(unit["x"], unit["y"])
        r = FO.outline_profile(P, about, floor, a.get("samples"), a.get("prominence"))

        def side(sd):
            out = {"peaks": len(sd["peaks"]), "max": round(sd["max"], 4), "min": round(sd["min"], 4),
                   "peakMean": None if sd["peakMean"] is None else round(sd["peakMean"], 4), "valleyMean": None if sd["valleyMean"] is None else round(sd["valleyMean"], 4)}
            if sd["pitch"] is not None:
                out["pitch"] = round(math.degrees(sd["pitch"]), 4) if r["kind"] == "radial" else round(sd["pitch"], 4)
                out["pitchUnit"] = "deg" if r["kind"] == "radial" else units
            if sd["peakMean"] is not None and sd["valleyMean"] is not None:
                out["depth"] = round(sd["peakMean"] - sd["valleyMean"], 4)
            if a.get("detail") == "full":
                out["peakList"] = [{"at": [round(x, 3) for x in p["at"]], "position": round(math.degrees(p["position"]) if r["kind"] == "radial" else p["position"], 3),
                                    "value": round(p["value"], 4), "prominence": round(p["prominence"], 4)} for p in sd["peaks"]]
            return out

        about_out = {"kind": r["kind"], **({"center": [round(float(x), 4) for x in about["center"]]} if r["kind"] == "radial" else
                                           {"origin": [round(float(x), 4) for x in about["origin"]], "dir": [round(float(x), 5) for x in about["dir"]]})}
        return {"units": units, "about": about_out, "prominence": round(r["prominence"], 4), "sides": [side(sd) for sd in r["sides"]],
                "note": "Radial: radius against angle about the centre; axial: distance from the axis, [0] left of its direction, [1] right."}

    kinds = ", ".join(f"{k}: {', '.join(f'{m[0]} ({m[1]})' for m in v)}" for k, v in METHODS.items())
    return [
        Tool("flat_objects", "The separate parts on the flatbed image, parted from the background by a grey level (Otsu's unless threshold is given; dark: whether the parts are darker, read from the border by default) and numbered in reading order — what flat_profile takes by number. Returns each with area, holes, box, centroid, equivalentDiameter, feret (largest and smallest caliper widths and their directions), axisAngleDeg and, with outline: true, its outline. minArea drops specks (sheet units²). Changes nothing on the sheet.",
             obj({"threshold": {"type": "integer", "minimum": 0, "maximum": 255}, "dark": {"type": "boolean"}, "minArea": {"type": "number", "minimum": 0}, "minHoleArea": {"type": "number", "minimum": 0},
                  "outline": {"type": "boolean"}, "limit": {"type": "integer", "minimum": 1, "maximum": 1000}}), flat_objects),
        Tool("flat_profile", "An outline read against a centre (kind radial, the default: a part seen from above — a knurl's or a gear's teeth round it) or along an axis (axial: a part lying on its side, each side apart), and its peaks counted by prominence. The outline: object (a number from flat_objects) or chains (edge chains by number). about: a 2D circle, arc or point (radial) or line (axial); else the object's own centroid or long axis. Returns per side peaks, pitch (degrees radial, sheet units axial), max, min, peakMean, valleyMean, depth; detail: full lists the peaks. samples and prominence override the defaults. Changes nothing.",
             obj({"object": {"type": "integer", "minimum": 1}, "chains": {"type": "array", "items": {"type": "integer", "minimum": 0}, "minItems": 1}, "kind": {"type": "string", "enum": ["radial", "axial"]},
                  "about": {"type": ["integer", "string"]}, "samples": {"type": "integer", "minimum": 3, "maximum": 4096}, "prominence": {"type": "number", "exclusiveMinimum": 0},
                  "detail": {"type": "string", "enum": ["brief", "full"]}}), flat_profile),
        Tool("flat_open_image", "Open a flatbed scan of a part — PNG (or JPEG where Qt's image reader loads) at the highest optical resolution — on the 2D sheet, in place of what was there, and find its edges. The scale the file declares (pHYs, JFIF) is taken until it is calibrated. Returns the 2D state, image.decoder saying how it was read.",
             obj({"path": {"type": "string", "minLength": 1}}, ["path"]), flat_open_image),
        Tool("flat_calibrate", "Set the image's scale against a known length: distance takes two places a known distance apart, diameter three or more on a circle of known diameter; mm is that length; places in the sheet's units as they are now. The edges are found again (their chain numbers change).",
             obj({"mode": {"type": "string", "enum": ["distance", "diameter"]}, "points": {"type": "array", "items": spot, "minItems": 2}, "mm": {"type": "number", "exclusiveMinimum": 0}}, ["mode", "points", "mm"]), flat_calibrate),
        Tool("flat_detect_edges", "Find the image's edges again at a sensitivity from 0 (only the strongest) to 1 (every faint one): subpixel Canny chains, gaps bridged, chains under a millimetre and texture dropped. Returns how many chains.", obj({"sensitivity": {"type": "number", "minimum": 0, "maximum": 1}}), flat_detect_edges),
        Tool("flat_edges", "The sheet's edge chains, longest first: chain number, points, length and bounds in the sheet's units, closed. Changes nothing.", obj({"limit": {"type": "integer", "minimum": 1}}), flat_edges),
        Tool("flat_fit", f"Make a 2D element — kind point, line, circle or arc, by a method of that kind: {kinds}. A pick method takes points (snapped to the nearest edge within reach unless snap: false; picks says where each landed); an edge method chains (whole) and/or box (sheet units), strays voted out; a construct method refs, other 2D elements. Seed methods are not ported.",
             obj({"kind": {"type": "string", "enum": list(METHODS)}, "method": {"type": "string"}, "points": {"type": "array", "items": spot, "minItems": 1}, "chains": {"type": "array", "items": {"type": "integer", "minimum": 0}, "minItems": 1},
                  "box": obj({"min": spot, "max": spot}, ["min", "max"]), "refs": {"type": "array", "items": ref}, "name": {"type": "string", "minLength": 1}, "snap": {"type": "boolean"}, "reach": {"type": "number", "exclusiveMinimum": 0}}, ["kind"]), flat_fit),
        Tool("flat_dimension_add", "Measure between two 2D elements: flat-dist-point-point, flat-dist-point-line, flat-dist-line-line (near-parallel only), flat-angle-line-line. Points, circles and arcs count as their centre, lines as lines. Without type, the first that takes the two in the order given. Returns the dimensions and the report.",
             obj({"refs": {"type": "array", "items": ref, "minItems": 2, "maxItems": 2}, "type": {"type": "string", "enum": [t["id"] for t in FC.DIMENSION_TYPES]}, "name": {"type": "string", "minLength": 1}}, ["refs"]), flat_dimension_add),
        Tool("flat_report", "The 2D report as ScanRuler's Copy button gives it: the image or section, the scale it rests on, every element and dimension. Changes nothing.", obj({}), flat_report),
        Tool("flat_export", "Write the sheet at true scale: dxf (AutoCAD 2000, millimetres declared, y up; edges as LWPOLYLINE thinned to 0.01 mm, fits as LINE/CIRCLE/ARC/POINT, labels as TEXT) or svg (one unit per millimetre, y down). To path, the session's folder by default.",
             obj({"format": {"type": "string", "enum": ["dxf", "svg"]}, "path": {"type": "string", "minLength": 1}}, ["format"]), flat_export),
    ]


def scale_fit(fit, k):
    """A fit in sheet units scaled by k (a new calibration)."""
    out = dict(fit)
    for key in ("center", "at"):
        if key in out:
            out[key] = [x * k for x in out[key]]
    for key in ("radius", "length", "sigma", "formError"):
        if out.get(key) is not None:
            out[key] = out[key] * k
    return out


def edge_points(chains, which, box):
    pts = []
    sel = which if which is not None else range(len(chains))
    for c in sel:
        if c >= len(chains):
            raise ToolError("not_found", f"There is no chain {c} — the sheet has {len(chains)}, numbered 0 to {len(chains) - 1}; flat_edges lists them.")
        pts.append(chains[c])
    P = np.vstack(pts) if pts else np.zeros((0, 2))
    if box is not None and len(P):
        lo = np.minimum(box["min"], box["max"])
        hi = np.maximum(box["min"], box["max"])
        P = P[np.all((P >= lo) & (P <= hi), axis=1)]
    return P


def construct(mid, fits):
    if mid == "flat-point-midpoint":
        a, b = FC.ref_point(fits[0]), FC.ref_point(fits[1])
        if a is None or b is None:
            raise FitError("Midpoint takes two points, circles or arcs.")
        return flat_point((a + b) / 2)
    if mid == "flat-point-center":
        p = FC.ref_point(fits[0])
        if p is None:
            raise FitError("A center point takes a circle, an arc or a point.")
        return flat_point(p)
    if mid == "flat-point-intersect":
        a, b = FC.ref_line(fits[0]), FC.ref_line(fits[1])
        if a is None or b is None:
            raise FitError("Line intersection takes two lines.")
        den = a[1][0] * b[1][1] - a[1][1] * b[1][0]
        if abs(den) < 1e-9:
            raise FitError("The lines are parallel — they do not cross.")
        r = b[0] - a[0]
        t = (r[0] * b[1][1] - r[1] * b[1][0]) / den
        return flat_point(a[0] + a[1] * t)
    if mid == "flat-circle-centers":
        pts = [FC.ref_point(x) for x in fits]
        if any(p is None for p in pts):
            raise FitError("A circle through centers takes points, circles or arcs.")
        return fit_circle(np.array(pts))
    raise FitError(f"Unknown method {mid}.")
