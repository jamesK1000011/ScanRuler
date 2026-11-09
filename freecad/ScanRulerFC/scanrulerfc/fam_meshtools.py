# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen, the Mesh Tools plugin (Stefan
# Hermann's): plugins/mesh-tools/app/meshCommands.ts (mesh.inspect,
# mesh.remove_islands, mesh.delete_marked, mesh.flip_normals, mesh.cut,
# mesh.cut_preview, mesh.mirror, mesh.fill_holes, mesh.smooth, mesh.offset,
# mesh.reduce, mesh.apply_reduced, mesh.use_edited, mesh.discard_edited,
# mesh.export, mesh.discard), plugins/mesh-tools/core/cutPlane.ts and
# plugins/mesh-tools/guides/mesh-tools.md.
#
# Every edit goes onto an edited copy, made by the first edit; the measuring
# tools keep reading the scan until mesh_use_edited takes the copy into use.
# The arrays before each change are kept, so mesh_undo takes it back.

import math
import os

import numpy as np

from agentlink.protocol import Tool, ToolError

from . import mesh_core as M
from . import scanstate as S
from . import section_core as SC
from .fam_sections import cut_section, element_cut_axis, element_named

GROUP = "meshtools"
INFO = "Mesh Tools (ScanRuler's plugin, ported): inspect, clean, cut, mirror, fill, smooth, offset, reduce and export the scan — edits on a copy until mesh_use_edited."

LIST = 40
DEFAULT_TRIANGLE_LIMIT = 50_000
UNDO_DEPTH = 20


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


def r(v, nd=4):
    return None if v is None else round(float(v), nd)


def mt_state(session):
    st = S.state(session)
    mine = st.setdefault("meshToolsState", {"base": None, "copy": None, "edits": [], "pending": [], "reduced": None, "undo": []})
    if st["scan"] is not mine["base"] and not any(u["scan"] is st["scan"] for u in mine["undo"]):
        # Another scan was opened: its copy and edits went with the old one.
        mine.update({"base": st["scan"], "copy": None, "edits": [], "pending": [], "reduced": None, "undo": []})
    return mine


def working(session):
    scan = S.scan_of(session)
    ms = mt_state(session)
    if ms["copy"] is not None:
        return ms["copy"][0], ms["copy"][1], "edited copy"
    return scan.V, scan.F, "scan"


def push_undo(session, label):
    st, ms = S.state(session), mt_state(session)
    ms["undo"].append({"label": label, "scan": st["scan"], "copy": ms["copy"], "edits": list(ms["edits"]), "pending": list(ms["pending"]), "reduced": ms["reduced"]})
    del ms["undo"][:-UNDO_DEPTH]


def recut_sections(session):
    """The sections cut again on the scan now in use, as ScanRuler does when
    an edited copy is taken into use."""
    st = S.state(session)
    ss = st.setdefault("sectionState", {"scan": None, "sections": [], "next": 1})
    ss["scan"] = scan = st["scan"]
    for sec in ss["sections"]:
        pts, offs, nrm = cut_section(scan, sec["frame"])
        sec.update({"points": pts, "offsets": offs, "normals": nrm})


def mesh_out(session):
    V, F, which = working(session)
    ms = mt_state(session)
    d = M.describe(V, F)
    return {"working": which, **d, "volume": r(d["volume"], 3), "edits": list(ms["pending"] if ms["copy"] is not None else ms["edits"])}


def plane_at(session, plane, offset, keep, auto=False):
    """cutPlane.ts cutPlaneOf: across a coordinate axis through the origin
    (the offset its coordinate), or across an element with a direction; the
    normal turned to point to the side that goes."""
    scan = S.scan_of(session)
    axis_name = SC.parse_plane_name(plane) if isinstance(plane, str) else None
    if axis_name:
        axis = SC.world_cut_axis(axis_name)
        name = SC.PLANE_NAME[axis_name]
    else:
        e = element_named(session, plane)
        axis = element_cut_axis(e)
        name = e.get("name") if isinstance(e, dict) else getattr(e, "name", str(plane))
        if axis is None:
            raise ToolError("invalid_input", f"{name} has no direction to cut across — take a plane, a cylinder, a cone, a line or a circle.")
    d = axis["dir"] / np.linalg.norm(axis["dir"])
    if auto:
        centre = (scan.V.min(axis=0) + scan.V.max(axis=0)) / 2
        offset = M.middle_offset(float((centre - axis["origin"]) @ d), 2 * M.diagonal(scan.V))
    frame = SC.section_frame_along(axis, offset)
    label = f"{name}, {axis_name.upper()} {offset:g} mm" if axis_name else (name if offset == 0 else f"{name} {'+' if offset > 0 else '−'}{abs(offset):g} mm")
    normal = -frame["normal"] if keep == "plus" else frame["normal"]
    return frame["origin"], normal, offset, label


def region_vertices(session, region):
    V, F, which = working(session)
    if region == "marked":
        raise ToolError("invalid_input", "\"marked\" is the person's marking on screen, which FreeCAD has none of here — name the region with a box, a sphere or vertices.")
    try:
        vs = M.select_vertices(V, F, region)
    except M.MeshError as e:
        raise ToolError("invalid_input", str(e))
    if len(vs) == 0:
        raise ToolError("invalid_input", f"The region holds no vertex of the {which}{' facing that way' if region.get('facing') else ''} — scan_info gives the scan's bounds.")
    return vs


def tools(session):
    def edit(label, job):
        V, F, _ = working(session)
        try:
            V2, F2, _vmap, report = job(V, F)
        except M.MeshError as e:
            raise ToolError("failed", str(e))
        push_undo(session, label)
        ms = mt_state(session)
        ms["copy"] = (np.asarray(V2, dtype=float), np.asarray(F2, dtype=np.int64))
        ms["pending"].append(label)
        return {"edit": {"text": label}, "report": report, "mesh": mesh_out(session)}

    def sizes():
        V, F, _ = working(session)
        return M.diagonal(V), M.mean_edge_length(V, F)

    def mesh_parts(a):
        ms = mt_state(session)
        scan = S.scan_of(session)
        red = ms["reduced"]
        return {"scan": {"name": scan.name, "triangles": int(len(scan.F)), "edits": ms["edits"]}, "edited": None if ms["copy"] is None else {"triangles": int(len(ms["copy"][1])), "edits": ms["pending"]}, "reduced": None if red is None else red["report"], "undo": ms["undo"][-1]["label"] if ms["undo"] else None}

    def mesh_inspect(a):
        V, F, which = working(session)
        diag = M.diagonal(V)
        isl = a.get("pieceSize", M.default_min_piece(diag))
        hol = a.get("holeSize", M.default_hole_size(diag))
        survey, _mask, centres = M.survey_pieces(V, F, isl)
        hs, hc = M.survey_holes(V, F, hol)
        d = M.describe(V, F)
        return {"working": which, **d, "volume": r(d["volume"], 3),
                "islands": {"size": isl, **{k: r(v) if isinstance(v, float) else v for k, v in survey.items()}, "centres": [[r(x) for x in c] for c in centres[:LIST]]},
                "holes": {"size": hol, **{k: r(v) if isinstance(v, float) else v for k, v in hs.items()}, "centres": [[r(x) for x in c] for c in hc[:LIST]]}}

    def mesh_remove_islands(a):
        size = a.get("size", M.default_min_piece(sizes()[0]))

        def job(V, F):
            survey, mask, _ = M.survey_pieces(V, F, size)
            if survey["islands"] == 0:
                raise M.MeshError("No piece of the scan is smaller than that.")
            if survey["islands"] == survey["pieces"]:
                raise M.MeshError("Every piece of the scan is smaller than that — nothing would be left.")
            V2, F2, vm = M.without_triangles(V, F, mask)
            return V2, F2, vm, survey

        return edit("remove islands", job)

    def mesh_delete_marked(a):
        vs = region_vertices(session, a["region"])

        def job(V, F):
            mask = M.marked_triangles(F, vs, len(V))
            if not mask.any():
                raise M.MeshError("No triangle has all three corners in the region.")
            if mask.all():
                raise M.MeshError("The whole scan is marked — nothing would be left.")
            V2, F2, vm = M.without_triangles(V, F, mask)
            return V2, F2, vm, {"triangles": int(mask.sum())}

        return edit("delete surface", job)

    def mesh_flip_normals(a):
        vs = region_vertices(session, a["region"]) if a.get("region") is not None else None

        def job(V, F):
            mask = None
            if vs is not None:
                mask = M.marked_triangles(F, vs, len(V))
                if not mask.any():
                    raise M.MeshError("No triangle has all three corners in the region.")
            V2, F2, vm, n = M.flip_triangles(V, F, mask)
            return V2, F2, vm, {"triangles": n}

        return edit("flip the normals of a region" if vs is not None else "flip the normals", job)

    def mesh_cut(a):
        o, n, off, label = plane_at(session, a["plane"], float(a["offset"]), a["keep"])
        return edit(f"cut at {label}", lambda V, F: M.cut_mesh(V, F, o, n, a.get("cap", True)))

    def mesh_cut_preview(a):
        V, F, _ = working(session)
        o, n, off, label = plane_at(session, a["plane"], float(a["offset"]), a.get("keep", "plus"))
        p = M.cut_preview(V, F, o, n)
        return {"plane": label, **p}

    def mesh_mirror(a):
        auto = a.get("offset") is None
        o, n, off, label = plane_at(session, a["plane"], float(a.get("offset") or 0.0), a.get("keep", "plus"), auto=auto)
        mode = a.get("mode", "whole")
        return edit(f"{'make symmetric about' if mode == 'symmetric' else 'mirror across'} {label}", lambda V, F: M.mirror_mesh(V, F, o, n, mode))

    def mesh_fill_holes(a):
        size = a.get("size", M.default_hole_size(sizes()[0]))
        return edit("fill a hole" if a.get("at") else "fill holes", lambda V, F: M.fill_holes(V, F, size, a.get("patch", "curved"), a.get("at")))

    def mesh_smooth(a):
        diag, edge = sizes()
        size = a.get("size", M.default_smooth_size(diag, edge))
        limit = a.get("limit", M.default_smooth_limit(diag))
        vs = region_vertices(session, a["region"]) if a.get("region") is not None else None
        return edit("smooth a region" if vs is not None else "smooth", lambda V, F: M.smooth_mesh(V, F, size, limit, a.get("keepEdges", True), vs))

    def mesh_offset(a):
        if a.get("region") is not None:
            raise ToolError("invalid_input", "region: moving a marked region as a step is not ported to ScanRuler for FreeCAD yet — the whole mesh moves.")
        d = float(a["distance"]) * (1 if a["direction"] == "expand" else -1)
        return edit(f"{a['direction']} by {a['distance']} mm", lambda V, F: M.offset_mesh(V, F, d))

    def mesh_reduce(a):
        import Mesh

        V, F, which = working(session)
        tol = a.get("tolerance", M.default_tolerance(M.diagonal(V)))
        cap = a.get("maxTriangles", DEFAULT_TRIANGLE_LIMIT)
        # FreeCAD's own quadric decimation (Mesh.decimate) in place of the
        # meshoptimizer simplifier ScanRuler runs; measured afterwards as
        # ScanRuler measures it, both ways.
        m = Mesh.Mesh()
        m.addFacets([[tuple(V[i]) for i in t] for t in F.tolist()])
        m.decimate(float(tol), 1.0)
        capped = False
        if m.CountFacets > cap:
            m.decimate(int(cap))
            capped = True
        pts, tris = m.Topology
        RV = np.array([[p.x, p.y, p.z] for p in pts], dtype=float)
        RF = np.array(tris, dtype=np.int64)
        there = surface_distances(V, RV, RF)
        back = surface_distances(RV, V, F)
        report = {"settings": {"tolerance": tol, "maxTriangles": cap}, "inputTriangles": int(len(F)), "triangles": int(len(RF)), "vertices": int(len(RV)),
                  "measured": int(len(there)), "within": int((there <= tol).sum()), "p999": r(np.quantile(there, 0.999)), "max": r(there.max()), "rms": r(math.sqrt((there ** 2).mean())),
                  "backP999": r(np.quantile(back, 0.999)), "backMax": r(back.max()), "held": bool(np.quantile(there, 0.999) <= tol and np.quantile(back, 0.999) <= tol), "capped": capped, "method": "FreeCAD Mesh.decimate"}
        mt_state(session)["reduced"] = {"V": RV, "F": RF, "report": report, "from": which}
        return {"reduced": report}

    def mesh_apply_reduced(a):
        ms = mt_state(session)
        red = ms["reduced"]
        if red is None:
            raise ToolError("invalid_state", "There is no reduced mesh — mesh_reduce makes one.")
        out = edit("apply the reduction", lambda V, F: (red["V"], red["F"], None, red["report"]))
        ms["reduced"] = None
        return out

    def mesh_discard(a):
        ms = mt_state(session)
        if a["what"] != "reduced":
            raise ToolError("invalid_input", "what: \"reduced\" — the wrap is not ported.")
        if ms["reduced"] is None:
            raise ToolError("invalid_state", "There is no reduced mesh to discard.")
        ms["reduced"] = None
        return {"discarded": "reduced", "reduced": None}

    def mesh_use_edited(a):
        st, ms = S.state(session), mt_state(session)
        if ms["copy"] is None:
            raise ToolError("invalid_state", "There is no edited copy — the first edit makes one.")
        push_undo(session, "use the edited mesh for analysis")
        old = st["scan"]
        new = S.Scan(old.name, ms["copy"][0], ms["copy"][1], old.units, old.path)
        st["scan"] = new
        ms.update({"base": new, "copy": None, "edits": ms["edits"] + ms["pending"], "pending": []})
        recut_sections(session)
        return {"scan": {"name": new.name, "triangles": int(len(new.F)), "edits": ms["edits"]}, "note": "Every tool measures the edited mesh now; the sections were cut again on it. Elements fitted before keep their fits — fit them again where it matters."}

    def mesh_discard_edited(a):
        ms = mt_state(session)
        if ms["copy"] is None:
            raise ToolError("invalid_state", "There is no edited copy — the first edit makes one.")
        push_undo(session, "discard the edits")
        ms.update({"copy": None, "pending": []})
        return {"mesh": mesh_out(session)}

    def mesh_undo(a):
        st, ms = S.state(session), mt_state(session)
        if not ms["undo"]:
            raise ToolError("invalid_state", "No mesh edit to take back.")
        u = ms["undo"].pop()
        changed = st["scan"] is not u["scan"]
        st["scan"] = u["scan"]
        ms.update({"base": u["scan"], "copy": u["copy"], "edits": u["edits"], "pending": u["pending"], "reduced": u["reduced"]})
        if changed:
            recut_sections(session)
        return {"undone": u["label"], "mesh": mesh_out(session)}

    def mesh_export(a):
        import Mesh

        ms = mt_state(session)
        part = a["part"]
        if part == "edited":
            if ms["copy"] is None:
                raise ToolError("invalid_state", "There is no edited copy — the first edit makes one.")
            V, F = ms["copy"]
        elif part == "reduced":
            if ms["reduced"] is None:
                raise ToolError("invalid_state", "There is no reduced mesh — mesh_reduce makes one.")
            V, F = ms["reduced"]["V"], ms["reduced"]["F"]
        else:
            raise ToolError("invalid_input", "part: edited or reduced — the trimmed piece is not ported.")
        fmt = a.get("format", "stl")
        scan = S.scan_of(session)
        path = a.get("path") or os.path.join(session.out_dir, f"{os.path.splitext(scan.name)[0]}-{part}.{fmt}")
        if not path.lower().endswith("." + fmt):
            path += "." + fmt
        m = Mesh.Mesh()
        m.addFacets([[tuple(V[i]) for i in t] for t in F.tolist()])
        try:
            m.write(path)
        except Exception as e:
            raise ToolError("failed", f"{path}: could not be written — {e}")
        return {"file": {"path": path, "name": os.path.basename(path), "bytes": os.path.getsize(path)}, "triangles": int(len(F)), "status": f"{part} mesh written in millimetres"}

    def surface_distances(P, V, F):
        return point_mesh_distances(P, V, F)

    region = {"oneOf": [{"type": "string", "enum": ["marked"]}, {"type": "object", "description": "Exactly one of box { min, max }, sphere { center, radius } or vertices [..], narrowed with facing [x, y, z] and angleDeg (30 to start)."}]}
    plane = {"oneOf": [{"type": "string", "minLength": 1}, {"type": "integer", "minimum": 1}], "description": "A coordinate plane — \"XY\", \"YZ\" or \"XZ\" — or an element with a direction, by id or name."}
    keep = {"type": "string", "enum": ["plus", "minus"], "description": "plus: the side the plane's direction points to (above XY, +X of YZ, +Y of XZ, along an element's direction); minus the other."}
    size = {"type": "number", "exclusiveMinimum": 0}
    return [
        Tool("mesh_parts", "The scan, the edited copy and its edits, the reduced mesh, and the step mesh_undo would take back. Changes nothing.", obj({}), mesh_parts),
        Tool("mesh_inspect", "What the tools would find on the mesh worked on — the edited copy, or the scan while there is none: vertices, triangles, bounds; open edges and edges more than two triangles share; the volume it encloses when closed, mm³; its pieces and the islands smaller than pieceSize across (the middle of each); its rims and the holes smaller than holeSize across (the middle of each, for mesh_fill_holes { at }). Sizes default to a hundredth and a twentieth of the part. Changes nothing.",
             obj({"pieceSize": size, "holeSize": size}), mesh_inspect),
        Tool("mesh_remove_islands", "Delete every connected piece smaller across than size (its bounding box) — specks, a patch of turntable; every larger piece stays. size defaults to a hundredth of the part. Edits the copy.", obj({"size": size}), mesh_remove_islands),
        Tool("mesh_delete_marked", "Delete the surface a region holds (a triangle goes when all three corners are in it); the hole it leaves stays open. Edits the copy.", obj({"region": region}, ["region"]), mesh_delete_marked),
        Tool("mesh_flip_normals", "Turn triangles over — every one, or with region those with all three corners in it. A closed mesh flipped whole encloses a negative volume. Edits the copy.", obj({"region": region}), mesh_flip_normals),
        Tool("mesh_cut", "Cut the mesh with a plane and take one side off; cap (on to start) closes the part flat wherever the plane goes all the way round, bridging short gaps of a hole right at the cut. Edits the copy.",
             obj({"plane": plane, "offset": {"type": "number", "description": "mm: a coordinate plane's coordinate, or along an element's direction."}, "keep": keep, "cap": {"type": "boolean"}}, ["plane", "offset", "keep"]), mesh_cut),
        Tool("mesh_cut_preview", "What mesh_cut at this plane would do, without cutting: whether it cuts, faces it would close, gaps bridged, stretches left open. Changes nothing.", obj({"plane": plane, "offset": {"type": "number"}, "keep": keep}, ["plane", "offset"]), mesh_cut_preview),
        Tool("mesh_mirror", "Reflect the mesh across a plane. mode whole (to start) reflects all of it; symmetric keeps the side keep names (plus to start) and reflects it onto the other, which it replaces — joined along the plane, a closed part stays closed. offset left out: through the middle of the part. Edits the copy.",
             obj({"plane": plane, "offset": {"type": "number"}, "mode": {"type": "string", "enum": ["whole", "symmetric"]}, "keep": keep}, ["plane"]), mesh_mirror),
        Tool("mesh_fill_holes", "Close the holes smaller across than size (a twentieth of the part to start) — or, with at, only the one whose middle is nearest that point. Each patch is triangulated to bend least (Liepa), refined to the density round it and faired: curved continues the surface's bending, flat lays the tightest patch. The scan's own vertices do not move. Edits the copy; the answer's mesh says whether it is now closed.",
             obj({"size": size, "patch": {"type": "string", "enum": ["curved", "flat"]}, "at": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}}), mesh_fill_holes),
        Tool("mesh_smooth", "Smooth a scan's scatter out: each point moved along its normal onto a quadric fitted to the scan round it over a patch size across — bumps smaller than size go, the shape larger stays. No point moves further than limit. keepEdges (on) fits each side of an edge sharper than 30° alone and leaves the edge as scanned. With region only that surface moves, fading to its edge. Edits the copy.",
             obj({"size": size, "limit": size, "keepEdges": {"type": "boolean"}, "region": region}), mesh_smooth),
        Tool("mesh_offset", "Move the surface along its normal by distance: expand (the part grows) or shrink — not a scale; faces end the distance from where they were and edges stay sharp. Edits the copy.",
             obj({"direction": {"type": "string", "enum": ["expand", "shrink"]}, "distance": size, "region": region}, ["direction", "distance"]), mesh_offset),
        Tool("mesh_reduce", "Reduce the mesh worked on to a light one for CAD within tolerance of it, never more than maxTriangles (50,000) — FreeCAD's quadric decimation, measured both ways (p999, max, rms; held when both 99.9 % lie within). A preview beside the scan: mesh_export { part: \"reduced\" } writes it, mesh_apply_reduced makes it the edited copy.",
             obj({"tolerance": size, "maxTriangles": {"type": "integer", "minimum": 4}}), mesh_reduce),
        Tool("mesh_apply_reduced", "Make the reduced mesh the edited copy.", obj({}), mesh_apply_reduced),
        Tool("mesh_discard", "Throw the reduced mesh away (what: \"reduced\"); nothing is applied.", obj({"what": {"type": "string", "enum": ["reduced", "wrap"]}}, ["what"]), mesh_discard),
        Tool("mesh_use_edited", "Take the edited copy into use: it becomes the scan every tool measures, the sections cut again on it. mesh_undo goes back to the scan before.", obj({}), mesh_use_edited),
        Tool("mesh_discard_edited", "Throw the edited copy and its edits away: the tools work on the scan in use again. mesh_undo brings them back.", obj({}), mesh_discard_edited),
        Tool("mesh_undo", "Take the last mesh edit back (an edit, use_edited, discard_edited or apply_reduced) — the arrays before it are kept.", obj({}), mesh_undo),
        Tool("mesh_export", "Write the edited copy or the reduced mesh as a binary STL in millimetres (or format 3mf) to path (the session's folder by default). Returns the file.",
             obj({"part": {"type": "string", "enum": ["edited", "reduced", "piece"]}, "format": {"type": "string", "enum": ["stl", "3mf"]}, "path": {"type": "string", "minLength": 1}}, ["part"]), mesh_export),
    ]


def point_mesh_distances(P, V, F, sample=4000):
    """Each point's distance to the nearest triangle (a sample of at most
    `sample` points), by a grid over the triangles' boxes."""
    P = np.asarray(P, dtype=float)
    if len(P) > sample:
        P = P[np.linspace(0, len(P) - 1, sample).astype(int)]
    T = V[F]
    lo, hi = T.min(axis=1), T.max(axis=1)
    cell = max(float(np.median(np.linalg.norm(hi - lo, axis=1))) * 2, 1e-6)
    grid = {}
    a = np.floor(lo / cell).astype(int)
    b = np.floor(hi / cell).astype(int)
    for t in range(len(T)):
        for i in range(a[t, 0], b[t, 0] + 1):
            for j in range(a[t, 1], b[t, 1] + 1):
                for k in range(a[t, 2], b[t, 2] + 1):
                    grid.setdefault((i, j, k), []).append(t)
    out = np.empty(len(P))
    for n, p in enumerate(P):
        c = np.floor(p / cell).astype(int)
        cand = []
        ring = 1
        while not cand and ring < 64:
            for i in range(c[0] - ring, c[0] + ring + 1):
                for j in range(c[1] - ring, c[1] + ring + 1):
                    for k in range(c[2] - ring, c[2] + ring + 1):
                        cand += grid.get((i, j, k), [])
            ring *= 2
        out[n] = _point_triangles(p, T[np.unique(cand)]).min() if cand else math.inf
    return out


def _point_triangles(p, T):
    """Distance from p to each triangle (Eberly's closest point, vectorised
    over regions by projecting and clamping)."""
    A, B, C = T[:, 0], T[:, 1], T[:, 2]
    ab, ac, ap = B - A, C - A, p - A
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = p - B
    d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = p - C
    d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va = d3 * d6 - d5 * d4
    vb = d5 * d2 - d1 * d6
    vc = d1 * d4 - d3 * d2
    den = va + vb + vc
    with np.errstate(divide="ignore", invalid="ignore"):
        v = np.where(den != 0, vb / den, 0)
        w = np.where(den != 0, vc / den, 0)
    Q = A + ab * v[:, None] + ac * w[:, None]

    def seg(X, Y):
        d = Y - X
        L = (d * d).sum(1)
        t = np.clip(np.where(L > 0, ((p - X) * d).sum(1) / np.where(L > 0, L, 1), 0), 0, 1)
        return X + d * t[:, None]

    inside = (va >= 0) & (vb >= 0) & (vc >= 0) & (den > 0)
    cands = [np.where(inside[:, None], Q, A), seg(A, B), seg(B, C), seg(C, A)]
    return np.min([np.linalg.norm(c - p, axis=1) for c in cands], axis=0)
