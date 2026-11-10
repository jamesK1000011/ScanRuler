# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/commands/core/section.ts
# (section.cut, section.get), src/commands/state.ts (describeSection),
# plugins/reverse/app/reSectionCommands.ts (reverse.section.fit, as
# section_fit), plugins/reverse/core/chainOutline.ts (filterChains) and the
# profile road of plugins/reverse/guides/scan-to-cad.md (a slice to a sketch,
# here section_to_sketch writing a FreeCAD Sketcher sketch).
#
# Sections: the scan cut with a plane, kept with its frozen frame, read as
# polylines on the section's sheet, fitted into lines and arcs, and written
# as a sketch a PartDesign pad can stand on.

import math

import numpy as np

from agentlink.protocol import Tool, ToolError

from . import scanstate as S
from . import section_core as SC
from .geom2d import FitError
from .chainsegment import arcs_of_chain, place_segments, profile_curves, segment_chain

GROUP = "sections"
INFO = "Sections of the scan (ScanRuler, ported): cut it with a plane, read the polylines, fit lines and arcs, write the profile as a sketch."

GET_LIMIT = 4000
GET_MAX = 50000
FIT_MAX_CHAINS = 12
R4 = 4


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


def r4(v):
    return round(float(v), R4) + 0.0


def v4(p):
    return [r4(x) for x in p]


# ---- the section list, kept beside the scan ----------------------------------------------

def sec_state(session):
    st = S.state(session)
    mine = st.setdefault("sectionState", {"scan": None, "sections": [], "next": 1})
    if mine["scan"] is not st["scan"]:
        # Sections of another scan do not belong to this one.
        mine.update({"scan": st["scan"], "sections": [], "next": 1})
    return mine


def find_section(session, given):
    secs = sec_state(session)["sections"]
    if isinstance(given, int) and not isinstance(given, bool):
        for s in secs:
            if s["id"] == given:
                return s
        listed = ", ".join("%s (%s)" % (x["id"], x["name"]) for x in secs) or "none"
        raise ToolError("not_found", f"There is no section {given} — there are {listed}.")
    want = str(given).strip().lower()
    hits = [s for s in secs if s["name"].strip().lower() == want]
    if not hits:
        listed = ", ".join(repr(x["name"]) for x in secs) or "none"
        raise ToolError("not_found", f"There is no section named \"{given}\" — there are {listed}.")
    if len(hits) > 1:
        raise ToolError("invalid_input", f"{len(hits)} sections are named \"{given}\" — name it by its id.")
    return hits[0]


def describe_section(sec):
    return {
        "id": sec["id"],
        "name": sec["name"],
        "visible": True,
        "across": sec["across"],
        "offset": r4(sec["offset"]),
        "plane": SC.frame_out(sec["frame"]),
        "chains": len(sec["offsets"]) - 1,
        **({"kind": "shadow", "play": sec.get("play"), "tolerance": sec.get("tolerance")} if sec.get("kind") == "shadow" else {}),
    }


# ---- what a plane is cut across ----------------------------------------------------------

def _vec(x):
    try:
        a = np.asarray(x, dtype=float).reshape(-1)
        return a if len(a) == 3 and np.all(np.isfinite(a)) else None
    except (TypeError, ValueError):
        return None


def _get(o, *names):
    for n in names:
        if isinstance(o, dict) and n in o:
            return o[n]
        if hasattr(o, n):
            return getattr(o, n)
    return None


def element_named(session, ref):
    """An element of the session (fitted by the element tools) by id or name."""
    els = S.state(session).get("elements") or []
    hits = []
    for e in els:
        eid, name = _get(e, "id"), _get(e, "name")
        if isinstance(ref, int) and not isinstance(ref, bool):
            if eid == ref:
                hits.append(e)
        elif isinstance(name, str) and name.strip().lower() == str(ref).strip().lower():
            hits.append(e)
    if not hits:
        raise ToolError("not_found", f"There is no element {ref!r} — give a coordinate plane (\"XY\", \"YZ\", \"XZ\"), {{ axis, angleDeg }} or {{ origin, normal }}.")
    if len(hits) > 1:
        raise ToolError("invalid_input", f"{len(hits)} elements are named {ref!r} — name it by its id.")
    return hits[0]


def element_cut_axis(e):
    """frame.ts cutAxisOf: a plane's normal (with its own in-plane X), a
    cylinder's, cone's or line's axis, a circle's normal. None for the kinds
    with no direction."""
    fit = _get(e, "fit") or e
    kind = _get(e, "kind") or _get(fit, "kind")
    centre = _vec(_get(fit, "center", "centre", "origin"))
    if centre is None:
        return None
    if kind == "plane":
        d = _get(fit, "normal")
        bu = _vec(_get(fit, "basisU"))
    elif kind in ("cylinder", "cone"):
        d, bu = _get(fit, "axis"), None
    elif kind == "line":
        d, bu = _get(fit, "dir", "direction", "axis"), None
    elif kind == "circle":
        d, bu = _get(fit, "normal", "axis"), None
    else:
        return None
    d = _vec(d)
    if d is None:
        return None
    return {"origin": centre, "dir": d, **({"basisU": bu} if bu is not None else {})}


def element_axis_line(e):
    fit = _get(e, "fit") or e
    kind = _get(e, "kind") or _get(fit, "kind")
    if kind not in ("cylinder", "cone", "line", "circle"):
        return None
    ax = element_cut_axis(e)
    return ax and {"origin": ax["origin"], "dir": ax["dir"]}


def model_center(scan):
    return (scan.V.min(axis=0) + scan.V.max(axis=0)) / 2


def plane_of(session, scan, across, offset):
    """(frame, offset, across as the section keeps it) for section_cut's
    input: a coordinate plane through the part's centre (offset its
    coordinate), an element with a direction, { axis, angleDeg }, or
    { origin, normal }."""
    if isinstance(across, str):
        axis = SC.parse_plane_name(across)
        if axis:
            c = model_center(scan)
            cut = SC.world_cut_axis(axis, c)
            off = float(c @ cut["dir"]) if offset is None else float(offset)
            return SC.section_frame_along(cut, off), off, SC.PLANE_NAME[axis]
    if isinstance(across, dict):
        if "axis" in across or "angleDeg" in across:
            if "axis" not in across or "angleDeg" not in across:
                raise ToolError("invalid_input", "across: { axis, angleDeg } — both.")
            ang = across["angleDeg"]
            if not isinstance(ang, (int, float)) or not math.isfinite(ang):
                raise ToolError("invalid_input", "across.angleDeg: give the angle about the axis in degrees.")
            a = across["axis"]
            if isinstance(a, str) and a.strip().lower() in "xyz" and len(a.strip()) == 1:
                line = {"origin": np.zeros(3), "dir": SC.AXIS_DIR[a.strip().lower()]}
                name = a.strip().lower()
            else:
                e = element_named(session, a)
                line = element_axis_line(e)
                if line is None:
                    raise ToolError("invalid_input", f"{_get(e, 'name')} has no axis to lay a plane through — choose a cylinder, cone, line or circle.")
                name = _get(e, "id")
            f = SC.radial_frame(line, float(ang))
            off = float(offset or 0.0)
            f = SC.section_frame_along({"origin": f["origin"], "dir": f["normal"], "basisU": f["basisU"]}, off)
            return f, off, {"axis": name, "angleDeg": float(ang)}
        if "origin" in across or "normal" in across:
            o, n = _vec(across.get("origin")), _vec(across.get("normal"))
            if o is None or n is None or not np.linalg.norm(n) > 0:
                raise ToolError("invalid_input", "across: { origin: [x, y, z], normal: [x, y, z] } with a normal that is not zero.")
            off = float(offset or 0.0)
            f = SC.section_frame_along({"origin": o, "dir": n}, off)
            return f, off, {"origin": v4(o), "normal": v4(f["normal"])}
        raise ToolError("invalid_input", "across: a coordinate plane, an element, { axis, angleDeg } or { origin, normal }.")
    e = element_named(session, across)
    ax = element_cut_axis(e)
    if ax is None:
        raise ToolError("invalid_input", f"{_get(e, 'name')} has no direction to cut across — choose a plane, cylinder, cone, line or circle.")
    off = float(offset or 0.0)
    return SC.section_frame_along(ax, off), off, _get(e, "id")


def cut_section(scan, frame):
    return SC.slice_mesh(scan.V, scan.F, frame["origin"], frame["normal"], SC.EDGE_MIN_FEATURE_MM)


def shadow_section(scan, frame, tolerance, play):
    """A shadow's loops as a section: (points, offsets, normals, what it is),
    each traced loop offset outwards by play + tolerance with FreeCAD's
    exact 2D offset (corners kept sharp) and read at a quarter of the
    tolerance."""
    import FreeCAD
    import Part

    from . import shadow_core as SH

    if not tolerance > 0:
        raise ToolError("invalid_input", "tolerance: mm, over 0 (0.1 by default).")
    loops, cell = SH.shadow_loops(scan.V, scan.F, frame, tolerance)
    # The simplification may cut a cell inside the traced loop: it goes back out.
    by = play + tolerance + cell
    pts, offsets, normals, areas = [], [0], [], []
    for lp in loops:
        if abs(SH.area(lp)) < (4 * cell) ** 2:
            continue  # a speck of a few cells
        w = Part.makePolygon([FreeCAD.Vector(float(u), float(v), 0) for u, v in lp] + [FreeCAD.Vector(float(lp[0][0]), float(lp[0][1]), 0)])
        face = Part.Face(w)
        if abs(by) > 1e-9:
            try:
                # Sharp joins, as ScanRuler keeps a corner turning more than
                # its smoothing angle: a box's shadow is four lines.
                face = face.makeOffset2D(by, 2, False, False, False)
            except Exception as e:
                raise ToolError("failed", f"The shadow could not be offset {by:g} mm: {e} — a smaller play.")
        for f in (face.Faces or [face]):
            outer = f.OuterWire
            q = outer.discretize(Deflection=tolerance / 4)
            uv = np.array([(p.x, p.y) for p in q], dtype=float)
            if SH.area(uv) < 0:
                uv = uv[::-1]
            if not np.allclose(uv[0], uv[-1]):
                uv = np.vstack([uv, uv[:1]])
            # Outward: right of a counter-clockwise run.
            t = np.gradient(uv, axis=0)
            nrm = np.stack([t[:, 1], -t[:, 0]], axis=1)
            nrm /= np.maximum(np.linalg.norm(nrm, axis=1), 1e-12)[:, None]
            o, bu, bv = (np.asarray(frame[k], dtype=float) for k in ("origin", "basisU", "basisV"))
            pts.append(o + uv[:, :1] * bu + uv[:, 1:] * bv)
            normals.append(nrm[:, :1] * bu + nrm[:, 1:] * bv)
            offsets.append(offsets[-1] + len(uv))
            areas.append(round(float(f.Area), 2))
    if not pts:
        return np.zeros((0, 3)), np.array([0]), np.zeros((0, 3)), {"play": play, "tolerance": tolerance, "cell": cell, "areas": []}
    return np.vstack(pts), np.array(offsets), np.vstack(normals), {"play": play, "tolerance": tolerance, "cell": round(cell, 4), "areas": areas}


def flat_chains(sec):
    flat = SC.project_cut(sec["points"], sec["frame"])
    return SC.chains_of(flat, sec["offsets"])


def chain_length(c):
    return float(np.hypot(*np.diff(c, axis=0).T).sum()) if len(c) > 1 else 0.0


def chain_closed(c):
    return len(c) > 2 and np.array_equal(c[0], c[-1])


def sketch_counting(frame):
    """How a sketch on the section counts against the section's sheet: its
    [u, v] is the sheet's plus `add` where the axes agree."""
    sk = SC.sketch_frame_on(frame["origin"], frame["normal"])
    d = np.asarray(frame["origin"]) - sk["origin"]
    if sk["basisU"] @ frame["basisU"] > 1 - 1e-9 and sk["basisV"] @ frame["basisV"] > 1 - 1e-9:
        return {"add": [round(float(d @ sk["basisU"]), 6) + 0.0, round(float(d @ sk["basisV"]), 6) + 0.0]}
    return {"origin": v4(sk["origin"]), "basisU": v4(sk["basisU"]), "basisV": v4(sk["basisV"])}


def chosen_chains(sec, a):
    """The chains section_fit and section_to_sketch take: named, or the
    filters' (filterChains) with the longest maxChains kept."""
    allc = flat_chains(sec)
    which = a.get("chains")
    if which is not None:
        for c in which:
            if c >= len(allc):
                raise ToolError("not_found", f"{sec['name']} has no chain {c} — it has {len(allc)}{f' (0 to {len(allc) - 1})' if allc else ''}.")
        return [(c, allc[c]) for c in dict.fromkeys(which)], {}
    lengths = [chain_length(c) for c in allc]
    kept = list(range(len(allc)))
    left = {}

    def drop(key, keep):
        nonlocal kept
        before = len(kept)
        kept = [i for i in kept if keep(i)]
        if len(kept) < before:
            left[key] = before - len(kept)

    if a.get("minLength") is not None:
        drop("minLength", lambda i: lengths[i] >= a["minLength"])
    if a.get("maxLength") is not None:
        drop("maxLength", lambda i: lengths[i] <= a["maxLength"])
    if a.get("closedOnly"):
        drop("closedOnly", lambda i: chain_closed(allc[i]))
    mx = a.get("maxChains", FIT_MAX_CHAINS)
    if len(kept) > mx:
        left["maxChains"] = len(kept) - mx
        longest = set(sorted(kept, key=lambda i: -lengths[i])[:mx])
        kept = [i for i in kept if i in longest]
    return [(i, allc[i]) for i in kept], ({"leftOut": left} if left else {})


def segmented(chain, a):
    if a.get("arcs"):
        return arcs_of_chain(chain, a["arcs"], a.get("tolerance"))
    return segment_chain(chain, tolerance=a.get("tolerance"), detail=a.get("detail"))


def residual(seg):
    p, f = seg["points"], seg["fit"]
    if seg["kind"] == "line":
        e = (p[:, 0] - f["center"][0]) * -f["dir"][1] + (p[:, 1] - f["center"][1]) * f["dir"][0]
    else:
        e = np.hypot(p[:, 0] - f["center"][0], p[:, 1] - f["center"][1]) - f["radius"]
    return {"rms": r4(math.sqrt((e * e).mean())), "max": r4(np.abs(e).max()), "points": int(len(p))}


def pieces_out(cut, frame):
    out = []
    for k, e in enumerate(place_segments(cut), start=1):
        seg = e["seg"]
        if e["kind"] == "line":
            a, b = e["a"], e["b"]
            ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180
            lean = min(ang % 90, 90 - ang % 90)
            out.append({"id": k, "kind": "line", "a": v4(a), "b": v4(b), "length": r4(np.linalg.norm(b - a)), "angleDeg": r4(ang), "leanDeg": r4(lean), "points": len(seg["points"]), "residual": residual(seg), "world": {"a": v4(SC.lift(frame, a)), "b": v4(SC.lift(frame, b))}})
        else:
            c, r = e["c"], e["r"]

            def at(t):
                return c + r * np.array([math.cos(t), math.sin(t)])

            pa, pb = at(e["start"]), at(e["start"] + e["sweep"])
            out.append({"id": k, "kind": "arc", "center": v4(c), "radius": r4(r), "diameter": r4(2 * r), "start": r4(e["start"]), "sweep": r4(e["sweep"]), "sweepDeg": r4(math.degrees(e["sweep"])), "a": v4(pa), "b": v4(pb), "points": len(seg["points"]), "residual": residual(seg), "world": {"center": v4(SC.lift(frame, c)), "a": v4(SC.lift(frame, pa)), "b": v4(SC.lift(frame, pb))}})
    return out


def brief(p):
    return {"id": p["id"], "kind": p["kind"], **({"radius": p["radius"]} if p["kind"] == "arc" else {}), "world": p["world"], "rms": p["residual"]["rms"]}


# ---- the tools ---------------------------------------------------------------------------

def tools(session):
    def section_cut(a):
        scan = S.scan_of(session)
        kind = a.get("kind", "cut")
        frame, off, across = plane_of(session, scan, a["across"], a.get("offset"))
        if frame is None:
            raise ToolError("invalid_input", "That cannot be cut across.")
        extra = {}
        if kind == "shadow":
            pts, offsets, normals, extra = shadow_section(scan, frame, float(a.get("tolerance", 0.1)), float(a.get("play", 0.0)))
            if len(offsets) <= 1:
                raise ToolError("failed", "The scan casts no shadow on that plane — it is seen edge on.")
        else:
            pts, offsets, normals = cut_section(scan, frame)
        if len(offsets) <= 1:
            raise ToolError("failed", "The plane misses the scan — there is nothing to cut there.")
        ss = sec_state(session)
        sid = ss["next"]
        ss["next"] += 1
        sec = {"id": sid, "name": a.get("name") or (f"Shadow {sid}" if kind == "shadow" else f"Section {sid}"), "kind": kind, "across": across, "offset": off, "frame": frame, "points": pts, "offsets": offsets, "normals": normals, **extra}
        ss["sections"].append(sec)
        # What Create does: the new section goes on the 2D sheet.
        S.state(session)["flatSubject"] = {"kind": "section", "id": sid}
        out = {"section": describe_section(sec)}
        if kind == "shadow":
            out["shadow"] = {k: extra[k] for k in ("play", "tolerance", "cell", "areas")}
            out["note"] = "The whole scan seen along the plane's normal, its outer boundary: holes and indentations filled, never inside the part — between the play and the play plus twice the tolerance outside it. section_to_sketch makes it a sketch to pad into a cutout or pocket."
        return out

    def section_list(a):
        return {"sections": [describe_section(s) for s in sec_state(session)["sections"]]}

    def section_remove(a):
        ss = sec_state(session)
        sec = find_section(session, a["section"])
        ss["sections"].remove(sec)
        return {"removed": sec["id"], "sections": [describe_section(s) for s in ss["sections"]]}

    def section_get(a):
        S.scan_of(session)
        sec = find_section(session, a["section"])
        space = a.get("space", "sheet")
        limit = a.get("limit", GET_LIMIT)
        flat = SC.project_cut(sec["points"], sec["frame"])
        off = sec["offsets"]
        count = len(off) - 1
        picked = a.get("chains") or list(range(count))
        for c in picked:
            if c >= count:
                raise ToolError("not_found", f"{sec['name']} has no chain {c} — it has {count}{f' (0 to {count - 1})' if count else ''}.")
        total = sum(int(off[c + 1] - off[c]) for c in picked)
        step = math.ceil(total / limit) if total > limit else 1
        chains = []
        for c in picked:
            idx = np.arange(off[c], off[c + 1])
            p3, p2 = sec["points"][idx], flat[idx]
            closed = len(idx) > 2 and np.array_equal(p3[0], p3[-1])
            keep = list(range(0, len(idx), step))
            if keep[-1] != len(idx) - 1:
                keep.append(len(idx) - 1)
            ch = {"index": c, "closed": bool(closed), "points": int(len(idx)), "kept": len(keep), "length": r4(np.linalg.norm(np.diff(p3, axis=0), axis=1).sum()), "bounds": {"min": v4(p2.min(axis=0)), "max": v4(p2.max(axis=0))}}
            if space != "world":
                ch["sheet"] = [v4(p2[k]) for k in keep]
            if space != "sheet":
                ch["world"] = [v4(p3[k]) for k in keep]
            chains.append(ch)
        return {"section": describe_section(sec), "plane": SC.frame_out(sec["frame"]), "step": step, "chains": chains}

    def section_fit(a):
        S.scan_of(session)
        sec = find_section(session, a["section"])
        picked, said = chosen_chains(sec, a)
        out = []
        for idx, chain in picked:
            try:
                cut = segmented(chain, a)
                pieces = pieces_out(cut, sec["frame"])
                out.append({"index": idx, "closed": bool(cut["closed"]), "points": int(len(cut["points"])), "scatter": r4(cut["scatter"]), "spacing": r4(cut["spacing"]), "tolerance": r4(cut["tolerance"]), "pieces": [brief(p) for p in pieces] if a.get("brief") else pieces})
            except FitError as e:
                out.append({"index": idx, "points": int(len(chain)), "error": str(e)})
        allc = flat_chains(sec)
        pts = np.vstack(allc) if allc else np.zeros((0, 2))
        bounds = {"min": v4(pts.min(axis=0)), "max": v4(pts.max(axis=0))} if len(pts) else None
        return {"section": {"id": sec["id"], "name": sec["name"]}, "plane": SC.frame_out(sec["frame"]), "sketch": sketch_counting(sec["frame"]), "bounds": bounds, "chains": out, **said}

    def section_to_sketch(a):
        import FreeCAD
        import Part
        import Sketcher

        S.scan_of(session)
        sec = find_section(session, a["section"])
        picked, said = chosen_chains(sec, {**a, **({} if a.get("chains") is not None else {"closedOnly": a.get("closedOnly", True)})})
        if not picked:
            raise ToolError("not_found", f"{sec['name']} has no closed chain to sketch — give chains, or closedOnly: false.")
        doc = session.doc
        body = None
        if a.get("body"):
            for o in doc.Objects:
                if o.TypeId == "PartDesign::Body" and (o.Label == a["body"] or o.Name == a["body"]):
                    body = o
            if body is None:
                raise ToolError("not_found", f"There is no body {a['body']!r} in the document.")
        else:
            body = doc.addObject("PartDesign::Body", "Body")
        sk = body.newObject("Sketcher::SketchObject", "Sketch")
        sk.Label = a.get("name") or f"{sec['name']} sketch"
        sk.MapMode = "Deactivated"
        f = SC.sketch_frame_on(sec["frame"]["origin"], sec["frame"]["normal"])
        V = FreeCAD.Vector
        sk.Placement = FreeCAD.Placement(V(*f["origin"]), FreeCAD.Rotation(V(*f["basisU"]), V(*f["basisV"]), V(*f["normal"]), "ZXY"))

        def to_sketch(uv):
            w = SC.lift(sec["frame"], uv) - f["origin"]
            return V(float(w @ f["basisU"]), float(w @ f["basisV"]), 0)

        fitted = []
        for idx, chain in picked:
            try:
                cut = segmented(chain, a)
            except FitError as e:
                fitted.append({"index": idx, "error": str(e)})
                continue
            curves, closed = profile_curves(cut)
            ids = []
            for cv in curves:
                if cv["kind"] == "circle":
                    gi = sk.addGeometry(Part.Circle(to_sketch(cv["c"]), V(0, 0, 1), float(cv["r"])), False)
                    ids.append((gi, None, None))
                elif cv["kind"] == "line":
                    gi = sk.addGeometry(Part.LineSegment(to_sketch(cv["s"]), to_sketch(cv["t"])), False)
                    ids.append((gi, 1, 2))
                else:
                    c0 = to_sketch(cv["c"])
                    # The sketch's own in-plane angles: the sheet's turned
                    # into the sketch frame.
                    pa, pb = to_sketch(cv["c"] + cv["r"] * np.array([math.cos(cv["a0"]), math.sin(cv["a0"])])), to_sketch(cv["c"] + cv["r"] * np.array([math.cos(cv["a1"]), math.sin(cv["a1"])]))
                    b0 = math.atan2(pa.y - c0.y, pa.x - c0.x)
                    b1 = b0 + (cv["a1"] - cv["a0"])
                    gi = sk.addGeometry(Part.ArcOfCircle(Part.Circle(c0, V(0, 0, 1), float(cv["r"])), b0, b1), False)
                    del pb
                    ids.append((gi, 1, 2) if cv["ccw"] else (gi, 2, 1))
            joins = range(len(ids)) if closed else range(len(ids) - 1)
            if len(ids) > 1:
                for i in joins:
                    g1, _, e1 = ids[i]
                    g2, s2, _ = ids[(i + 1) % len(ids)]
                    sk.addConstraint(Sketcher.Constraint("Coincident", g1, e1, g2, s2))
            fitted.append({"index": idx, "closed": bool(closed), "lines": sum(1 for c in curves if c["kind"] == "line" and not c.get("bridge")), "arcs": sum(1 for c in curves if c["kind"] == "arc"), "circles": sum(1 for c in curves if c["kind"] == "circle"), "bridges": sum(1 for c in curves if c.get("bridge")), "tolerance": r4(cut["tolerance"]), "scatter": r4(cut["scatter"])})
        doc.recompute()
        wires = []
        try:
            wires = [{"closed": w.isClosed(), "edges": len(w.Edges)} for w in sk.Shape.Wires]
        except Exception:
            pass
        return {"sketch": sk.Label, "body": body.Label, "section": sec["id"], "frame": {"origin": v4(f["origin"]), "xAxis": v4(f["basisU"]), "yAxis": v4(f["basisV"]), "normal": v4(f["normal"])}, "fitted": fitted, "wires": wires, "next": "pd_pad { body, sketch, length } stands it up.", **said}

    section_ref = {"oneOf": [{"type": "integer", "minimum": 1}, {"type": "string", "minLength": 1}], "description": "The section, by id or name."}
    across = {"oneOf": [
        {"type": "integer", "minimum": 1, "description": "An element's id."},
        {"type": "string", "minLength": 1, "description": "An element's name, or \"XY\", \"YZ\", \"XZ\"."},
        {"type": "object", "description": "{ axis, angleDeg }: a plane through an axis (\"X\", \"Y\", \"Z\" or an element); or { origin, normal }: a plane given outright."},
    ]}
    filters = {
        "chains": {"type": "array", "items": {"type": "integer", "minimum": 0}, "minItems": 1, "description": "Which chains, whatever the filters say."},
        "detail": {"type": "number", "minimum": 0, "maximum": 1, "description": "0 to 1; 0.5 by default."},
        "tolerance": {"type": "number", "exclusiveMinimum": 0, "description": "mm"},
        "arcs": {"type": "integer", "minimum": 1, "maximum": 8, "description": "Each chain as this many arcs end to end."},
        "minLength": {"type": "number", "minimum": 0},
        "maxLength": {"type": "number", "exclusiveMinimum": 0},
        "closedOnly": {"type": "boolean"},
        "maxChains": {"type": "integer", "minimum": 1},
    }
    return [
        Tool("section_cut", "Cut the scan with a plane and keep the cut as a section, put on the 2D sheet. across: an element with a direction (plane, cylinder, cone, line, circle) by id or name; \"XY\", \"YZ\" or \"XZ\" through the part's centre; { axis, angleDeg }, a plane through an axis turned angleDeg about it — a half section of a turned part; or { origin, normal }. offset slides the plane along its normal, mm (a coordinate plane: the coordinate itself). kind \"shadow\": not a cut but the whole scan seen along the plane's normal, its outer boundary — holes filled, never inside the part, play mm more round it (negative: a press fit) to tolerance mm (0.1) — the outline for a foam cutout, a bin insert or a holder; then section_to_sketch. Returns the section: its plane and chain count.",
             obj({"across": across, "offset": {"type": "number"}, "name": {"type": "string", "minLength": 1}, "kind": {"type": "string", "enum": ["cut", "shadow"]}, "play": {"type": "number"}, "tolerance": {"type": "number", "exclusiveMinimum": 0}}, ["across"]), section_cut),
        Tool("section_get", "A section's cut as polylines: each chain's points in order — [u, v] mm on the sheet, or with space \"world\" or \"both\" [x, y, z] — with the plane (origin, normal, basisU, basisV) and per chain closed, length, points, bounds. At most limit points over all chains (4000 by default, 50000 at most); past it every k-th point is kept and step says k. Changes nothing.",
             obj({"section": section_ref, "chains": filters["chains"], "space": {"type": "string", "enum": ["sheet", "world", "both"]}, "limit": {"type": "integer", "minimum": 2, "maximum": GET_MAX}}, ["section"]), section_get),
        Tool("section_list", "The sections kept: id, name, plane, chains. Changes nothing.", obj({}), section_list),
        Tool("section_remove", "Take a section away.", obj({"section": section_ref}, ["section"]), section_remove),
        Tool("section_fit", "A section's chains cut into the lines and arcs they are, without making a sketch: per chain its pieces in order — a line by its ends, length, angleDeg (from +u) and leanDeg, an arc by centre, radius, start and sweep (radians CCW from +u) — each with its residual and in world [x, y, z]. [u, v] are the section's sheet, from the part's centre; a sketch on the section counts from the world origin's foot: its [u, v] is the sheet's plus sketch.add. Without chains the longest are fitted (maxChains 12); arcs: n fits each chain as n arcs; brief: true gives each piece short. Changes nothing.",
             obj({"section": section_ref, **filters, "brief": {"type": "boolean"}}, ["section"]), section_fit),
        Tool("section_to_sketch", "The profile road's last step: a section's chains fitted into lines and arcs (as section_fit) and written as a FreeCAD Sketcher sketch in a PartDesign body (body by label, or a new one), lying on the section's plane — its frame the sketch rule's (zero at the world origin's foot, x along the coordinate axis next round). Neighbouring pieces meet at their carriers' crossing, joined coincident; closed chains only unless closedOnly: false or chains. Then pd_pad { body, sketch, length }.",
             obj({"section": section_ref, **filters, "body": {"type": "string", "minLength": 1}, "name": {"type": "string", "minLength": 1}}, ["section"]), section_to_sketch, changes=True),
    ]
