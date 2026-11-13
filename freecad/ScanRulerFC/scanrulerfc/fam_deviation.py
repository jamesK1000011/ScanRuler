# SPDX-License-Identifier: AGPL-3.0-only
# Surface deviation: the scan against a reference part — opened, best-fitted
# onto it, mapped — or against one of its own fitted elements; the map read
# as patches, as volumes, and written out. ScanRuler's deviation commands,
# for Agent Link.
# Ported from ScanRuler by CNC Kitchen: src/commands/core/deviation.ts,
# src/commands/core/volume.ts, src/commands/state.ts (describeDeviation),
# src/state/deviationStore.ts (the settings and their defaults)

import math
import os

import numpy as np
from agentlink.protocol import Tool, ToolError

from . import dev_rigid as R
from . import on_reference
from . import scanstate as S
from .dev_align import AlignError, align_from_pairs, align_local, auto_align, quality_warnings
from .dev_field import field_percentiles
from .dev_hotspots import FEATURE_DEPTH, FEATURE_MIN_AREA, FEATURE_MIN_SPACINGS, hotspots
from .dev_map import (
    DEFAULT_FACING_DEG,
    DEFAULT_MAP_FACING_DEG,
    compute_deviation,
    compute_element_deviation,
    csv_bytes,
    default_max_distance,
    detect_material_side,
    deviation_report,
    deviation_stats,
    element_report,
    is_measured,
    map_colours,
    npy_bytes,
    ply_bytes,
    suggest_range,
    vertex_normals,
)
from .dev_surface import NominalSurface, signed_volume, weld
from .dev_volume import KINDS, MAX_REGIONS, VOLUME_REGIONS, volume_deviation, volume_out

GROUP = "deviation"
INFO = "The scan against a reference part (ScanRuler, ported): open the reference, best-fit the scan onto it, map, read patches and volumes, export."

KEY = "deviation"
CAD = (".step", ".stp", ".iges", ".igs", ".brep", ".brp")
MESH = (".stl", ".ply", ".obj", ".3mf", ".off")
HOTSPOT_PATCHES = 8
HOTSPOT_VERTICES = 12
FEATURES_NOTE = "each feature patch is material missing or misplaced: model it or name it"
# Scan and reference sizes further apart than this are not one part in one
# unit; the factors a wrong unit gives, to name the likely one.
SIZE_RATIO_LIMIT = 2.0
UNIT_FACTORS = ((10.0, "centimetres read as millimetres, or the other way round"), (25.4, "inches read as millimetres, or the other way round"), (1000.0, "metres read as millimetres, or the other way round"))
MEASURED_SHARE_WARN = 0.8
SIGN_WORDS = "Sign: positive where the scan stands outside the reference (excess material on the part), negative inside it (material missing)."


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


def vec3(desc):
    return {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, "description": desc}


def r3(v):
    return round(float(v), 3)


def dstate(session):
    st = S.state(session)
    if KEY not in st:
        st[KEY] = {
            "reference": None,
            "align": None,
            "scan": None,  # the scan the alignment and map belong to
            "version": None,  # its pose (Scan.version) when they were made
            "values": None,
            "source": "reference",
            "target": None,
            "range": 1.0,
            "rangeAuto": True,
            "maxDistance": 3.0,
            "maxDistanceAuto": True,
            "bands": None,
            "tolerance": 0.1,
            "facingDeg": DEFAULT_MAP_FACING_DEG,
        }
    d = st[KEY]
    # A scan opened since the alignment: the fit and the map were of the old
    # one. The same scan moved since (align_clear, align_datum, align_auto,
    # align_symmetry, scan_scale): the alignment no longer holds and the map
    # was of the part where it stood — both go.
    moved = d.get("version") is not None and getattr(st["scan"], "version", None) != d["version"]
    if d["scan"] is not None and (d["scan"] is not st["scan"] or moved):
        d.update(align=None, scan=None, version=None, values=None, source="reference", target=None)
        d.pop("onReference", None)
    return d


# ---- the reference ----


def tessellate(shape, diag=None):
    """A CAD shape as a fine, closed triangle mesh, outward."""
    import MeshPart

    bb = shape.BoundBox
    diag = diag or math.sqrt(bb.XLength**2 + bb.YLength**2 + bb.ZLength**2)
    lin = max(0.002, min(0.01, diag * 5e-5))
    m = MeshPart.meshFromShape(Shape=shape, LinearDeflection=lin, AngularDeflection=0.08, Relative=False)
    pts, tris = m.Topology
    return S.points_array(pts), np.array(tris, dtype=np.int64)


def read_reference(session, a):
    path, body, units = a.get("path"), a.get("body"), a.get("units", "mm")
    if units not in S.UNITS:
        raise ToolError("invalid_input", f"units: one of {', '.join(S.UNITS)}.")
    if bool(path) == bool(body):
        raise ToolError("invalid_input", "Give path (a STEP, IGES, BREP, STL, PLY, OBJ or 3MF file) or body (a shape in the document), one of them.")
    note = None
    if body:
        doc = session.doc
        o = doc.getObject(body) or next((x for x in doc.Objects if x.Label == body), None)
        if o is None or not hasattr(o, "Shape") or o.Shape.isNull():
            names = [x.Label for x in doc.Objects if hasattr(x, "Shape") and not x.Shape.isNull() and x.Shape.Volume > 0]
            raise ToolError("not_found", f"body {body!r}: no solid of that name here — the solids: {', '.join(names) or 'none'}.")
        V, F = tessellate(o.Shape)
        name = o.Label
        kind = "body"
    else:
        if not os.path.isfile(path):
            raise ToolError("not_found", f"path {path!r}: no such file — give the reference's path on this computer.")
        ext = os.path.splitext(path)[1].lower()
        name = os.path.basename(path)
        if ext in CAD:
            import Part

            shape = Part.Shape()
            shape.read(path)
            if shape.isNull():
                raise ToolError("failed", f"{name}: no shape read.")
            V, F = tessellate(shape)
            kind = "cad"
            if units != "mm":
                note = "A STEP, IGES or BREP file carries its own units: units is for mesh files."
        elif ext in MESH:
            import Mesh

            m = Mesh.Mesh(path)
            pts, tris = m.Topology
            V = S.points_array(pts) * S.UNITS[units]
            F = np.array(tris, dtype=np.int64)
            kind = "mesh"
        elif S.more_formats() and ext.lstrip(".") in S.more_formats().FORMATS:
            V, F, _info = S.more_formats().read(path, units if "units" in a else None)
            kind = "mesh"
        else:
            raise ToolError("invalid_input", f"{name}: a STEP, IGES, BREP, STL, PLY, OBJ, OFF, 3MF, glTF/GLB, Collada, VRML or 3DS file.")
    V, F = weld(V, F, 1e-6)
    if len(F) == 0:
        raise ToolError("failed", f"{name}: no triangles.")
    vol = signed_volume(V, F)
    if vol < 0:
        F = F[:, ::-1].copy()
    e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    _, counts = np.unique(e, axis=0, return_counts=True)
    open_edges = int((counts != 2).sum())
    return {"name": name, "kind": kind, "V": V, "F": F, "surface": NominalSurface(V, F), "volume": abs(vol), "openEdges": open_edges, "note": note}


def require_reference(session):
    S.scan_of(session)
    d = dstate(session)
    if d["reference"] is None:
        raise ToolError("invalid_state", "No reference part is open — open one with deviation_open_reference.")
    return d


# ---- the readout ----


def reference_reading(session):
    """The map read on the reference (on_reference), worked out once per
    alignment and settings: {centres, normals, pieces, area, values, spacing}."""
    from agentlink.protocol import ToolError

    d = dstate(session)
    ref = d["reference"]
    scan = S.scan_of(session)
    if ref is None or d["values"] is None:
        raise ToolError("invalid_state", "No map against the reference to read on it: deviation_open_reference, then deviation_align.")
    key = (len(scan.V), float(np.asarray(scan.V, dtype=float).sum()), float(d["maxDistance"]), float(d["tolerance"]), len(ref["V"]), float(np.asarray(ref["V"], dtype=float).sum()))
    got = d.get("onReference")
    if got and got["key"] == key:
        return got
    V, F = np.asarray(ref["V"], dtype=float), np.asarray(ref["F"], dtype=np.int64)
    area = 0.5 * float(np.linalg.norm(np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]), axis=1).sum())
    spacing = on_reference.wanted_spacing(d["tolerance"], area)
    centres, normals, pieces, areas = on_reference.cut(V, F, spacing)
    values = on_reference.read(centres, normals, scan.V, scan.F, float(d["maxDistance"]))
    got = {"key": key, "centres": centres, "normals": normals, "pieces": pieces, "area": areas, "values": values, "spacing": spacing}
    d["onReference"] = got
    return got


def map_values(d):
    if d["source"] == "element":
        return d["target"]["values"] if d["target"] else None
    return d["values"]


def figures(d):
    v = map_values(d)
    if v is None:
        return None
    s = deviation_stats(v, d["maxDistance"], d["tolerance"])
    p = field_percentiles(v, -d["maxDistance"], d["maxDistance"], [0.05, 0.25, 0.5, 0.75, 0.95])
    out = {k: (r3(x) if isinstance(x, float) else x) for k, x in s.items()}
    out["sigma"] = round(s["sigma"], 4)
    out["rms"] = round(s["rms"], 4)
    out["mean"] = round(s["mean"], 4)
    # Over every scan point: an unmeasured point is not one shown in tolerance.
    out["withinTolerancePct"] = round(100 * s["withinTolerance"] / s["total"], 1) if s["total"] else 0
    out["withinToleranceOfMeasuredPct"] = round(100 * s["withinTolerance"] / s["measured"], 1) if s["measured"] else 0
    out["measuredPct"] = round(100 * s["measured"] / s["total"], 1) if s["total"] else 0
    out["percentiles"] = {k: (r3(x) if math.isfinite(x) else None) for k, x in zip(("p5", "p25", "p50", "p75", "p95"), p)}
    return out


def describe(d):
    ref = d["reference"]
    a = d["align"]
    out = {
        "source": d["source"],
        "reference": {"fileName": ref["name"], "triangles": int(len(ref["F"])), "volume": round(ref["volume"], 1), **({"openEdges": ref["openEdges"]} if ref["openEdges"] else {})} if ref else None,
        "align": {
            "source": a["source"],
            "rms": round(a["rms"], 5),
            "meanDistance": round(a["meanDistance"], 5),
            "matched": a["matched"],
            "sampled": a["sampled"],
            "iterations": a["iterations"],
            **({"converged": a["converged"]} if "converged" in a else {}),
            **({"matchedShare": round(a["matchedShare"], 3)} if "matchedShare" in a else {}),
            **({"ambiguous": True} if a.get("ambiguous") else {}),
            **({"pairRms": round(a["pairRms"], 4)} if "pairRms" in a else {}),
            **({"underconstrained": True} if a.get("underconstrained") else {}),
            "transform": a["total"].to_json(),
        }
        if a
        else None,
        "map": "ready" if map_values(d) is not None else "none",
        "sign": SIGN_WORDS if d["source"] == "reference" else "Sign: positive on the element's material side past its surface (too much material), negative short of it (too little).",
        "stats": figures(d),
        "target": {"element": d["target"]["ref"], "side": "outward" if d["target"]["side"] == 1 else "inward", "facingDeg": d["target"]["facingDeg"]} if d["target"] else None,
        "settings": {
            "range": d["range"],
            "maxDistance": d["maxDistance"],
            "maxDistanceAuto": d["maxDistanceAuto"],
            "bands": d["bands"],
            "tolerance": d["tolerance"],
            "facingDeg": d["facingDeg"],
            "colormap": {"id": "jet", "low": {"mm": -d["range"], "rgb": [0, 0, 255]}, "zero": {"mm": 0, "rgb": [0, 200, 0]}, "high": {"mm": d["range"], "rgb": [255, 0, 0]}, "under": {"mm": f"< {-d['range']}", "rgb": [0, 0, 110]}, "over": {"mm": f"> {d['range']}", "rgb": [130, 0, 0]}, "unmeasured": {"rgb": [126, 131, 138]}},
        },
    }
    return out


def scan_diag(scan):
    return float(np.linalg.norm(scan.V.max(axis=0) - scan.V.min(axis=0)))


def size_mismatch(scan_d, ref_d):
    """None when the scan and the reference are about one size; else the
    refusal, naming the unit mix-up the ratio looks like."""
    if not (scan_d > 0 and ref_d > 0):
        return None
    ratio = max(scan_d, ref_d) / min(scan_d, ref_d)
    if ratio <= SIZE_RATIO_LIMIT:
        return None
    bigger = "scan" if scan_d > ref_d else "reference"
    factor, why = min(UNIT_FACTORS, key=lambda f: abs(math.log(ratio / f[0])))
    likely = f" That is close to ×{factor:g}: most likely {why}." if abs(math.log(ratio / factor)) < math.log(1.35) else ""
    return (f"The scan is {scan_d:.4g} mm across and the reference {ref_d:.4g} mm — the {bigger} is {ratio:.3g}× the other, so they are not one part in one unit "
            f"(a rigid best fit cannot scale, and would report a near-perfect fit of the small one on a patch of the big one).{likely} "
            f"Open the scan again with units (scan_open units: mm, cm, m or in), or the reference with units, or scan_scale the scan. "
            f"If the scan is truly a small piece of a larger reference, pass allowSizeMismatch: true.")


def map_warnings(d):
    """What the map's figures need said beside them."""
    v = map_values(d)
    if v is None:
        return []
    s = deviation_stats(v, d["maxDistance"], d["tolerance"])
    if not s["total"]:
        return []
    share = s["measured"] / s["total"]
    if share < MEASURED_SHARE_WARN:
        return [f"Only {share * 100:.0f} % of the scan's points have a reading within the search distance ({d['maxDistance']:g} mm); withinTolerancePct counts every point, so the rest count against it. A low share means the scan and the reference differ widely (wrong part, wrong units, a poor fit) or the search distance is too short (deviation_settings maxDistance)."]
    return []


def measure_map(d, scan):
    """The map against the reference under the alignment in hand: the scan
    has been moved onto the reference, so in its own frame."""
    ref = d["reference"]["surface"]
    facing = d["facingDeg"]
    v = compute_deviation(ref, scan.V, R.identity(), vertex_normals(scan.V, scan.F), None if facing is None else math.radians(facing))
    d["values"] = v
    d.pop("onReference", None)
    if d["maxDistanceAuto"]:
        # From the reference, the nominal part: a scan in the wrong units
        # would otherwise set a search distance in its own wrong scale.
        d["maxDistance"] = default_max_distance(float(d["reference"]["surface"].bbox_diagonal))
    if d["rangeAuto"]:
        d["range"] = suggest_range(v, d["maxDistance"])


def bake(scan, m, st=None):
    """Move the scan onto the reference — through its pose, with every
    element measured on it, when the measuring tools' state is there, so
    elements fitted before a best fit follow the scan."""
    if st is not None and hasattr(scan, "set_pose"):
        from . import model

        model.transform_all(st, (m.r, m.t))
        return
    scan.V = m.apply(scan.V)
    scan._normals = None
    scan._areas = None


def find_element(session, ref):
    els = S.state(session).get("elements") or []
    for e in els:
        get = e.get if isinstance(e, dict) else (lambda k, e=e: getattr(e, k, None))
        if (isinstance(ref, int) and get("id") == ref) or (isinstance(ref, str) and (get("name") == ref or str(get("id")) == ref)):
            fit = get("fit") or e
            if not isinstance(fit, dict):
                fit = {k: getattr(fit, k) for k in dir(fit) if not k.startswith("_")}
            return get("name") or str(ref), get("kind") or fit.get("kind"), fit
    names = [str((e.get("name") if isinstance(e, dict) else getattr(e, "name", None)) or "") for e in els]
    raise ToolError("not_found", f"element {ref!r}: not on the scan — the elements: {', '.join(n for n in names if n) or 'none'}.")


# ---- the tools ----


def tools(session):
    def open_reference(a):
        S.scan_of(session)
        d = dstate(session)
        try:
            ref = read_reference(session, a)
        except ToolError:
            raise
        except Exception as e:
            raise ToolError("failed", f"The reference could not be read: {e}")
        d.update(reference=ref, align=None, scan=None, values=None, source="reference", target=None)
        out = {"deviation": describe(d)}
        warn = []
        if ref["openEdges"]:
            warn.append(f"The reference is not closed ({ref['openEdges']} open edges): the sign of a reading near a hole in it cannot be trusted.")
        if ref["note"]:
            warn.append(ref["note"])
        if warn:
            out["warnings"] = warn
        return out

    def align(a):
        d = require_reference(session)
        scan = S.scan_of(session)
        mode = a.get("mode", "auto")
        surface = d["reference"]["surface"]
        if not np.isfinite(scan.V).all():
            raise ToolError("invalid_input", "The scan has vertices that are not numbers (NaN or infinite): open it again — scan_open drops them and the triangles on them.")
        if not np.isfinite(np.asarray(d["reference"]["V"], dtype=float)).all():
            raise ToolError("invalid_input", "The reference has vertices that are not numbers (NaN or infinite): repair it and open it again.")
        if not a.get("allowSizeMismatch"):
            no = size_mismatch(scan_diag(scan), float(surface.bbox_diagonal))
            if no:
                raise ToolError("invalid_input", no)
        N = vertex_normals(scan.V, scan.F)
        try:
            if mode == "points":
                pairs = a.get("pairs")
                if not pairs:
                    raise ToolError("invalid_input", "points needs pairs.")
                res = align_from_pairs(surface, scan.V, N, [(np.array(p["scan"], float), np.array(p["reference"], float)) for p in pairs])
            elif mode == "local":
                if not d["align"]:
                    raise ToolError("invalid_state", "There is no alignment to refine — run deviation_align first.")
                verts = a.get("vertices")
                if not verts:
                    raise ToolError("invalid_input", "local needs vertices — the surface to refine on.")
                if max(verts) >= len(scan.V):
                    raise ToolError("invalid_input", f"The scan has {len(scan.V)} vertices.")
                dist = a.get("searchDistance", d["maxDistance"])
                res = align_local(surface, scan.V, N, verts, R.identity(), dist)
            elif mode == "auto":
                res = auto_align(surface, scan.V, N)
            else:
                raise ToolError("invalid_input", "mode: auto, points or local.")
        except AlignError as e:
            raise ToolError("failed", str(e))
        except (np.linalg.LinAlgError, FloatingPointError, ValueError) as e:
            raise ToolError("failed", f"The best fit could not be solved ({e}): the scan or the reference is degenerate here — check both are whole, finite meshes of the same part, or start from point pairs (mode points).")
        m = res["transform"]
        bake(scan, m, S.state(session))
        prev = d["align"]["total"] if (mode == "local" and d["align"]) else R.identity()
        res["total"] = R.compose(m, prev) if mode == "local" else m
        d.update(align=res, scan=scan, version=getattr(scan, "version", None), source="reference", target=None)
        measure_map(d, scan)
        out = {"deviation": describe(d), "moved": "The scan's vertices were moved onto the reference by transform: every place on the scan now reads in the reference's frame. Moving the part again (align_*, scan_scale) drops this alignment and its map."}
        warn = quality_warnings(res) + map_warnings(d)
        if warn:
            out["warnings"] = warn
        return out

    def measure(a):
        d = require_reference(session)
        if not d["align"]:
            raise ToolError("invalid_state", "The scan is not aligned to the reference — never aligned, or moved since (align_clear, align_datum, align_auto, align_symmetry and scan_scale drop the alignment and its map): run deviation_align.")
        d["source"] = "reference"
        measure_map(d, S.scan_of(session))
        out = {"deviation": describe(d)}
        warn = map_warnings(d)
        if warn:
            out["warnings"] = warn
        return out

    def set_target(a):
        scan = S.scan_of(session)
        d = dstate(session)
        if "element" not in a:
            raise ToolError("invalid_input", "element: the element, or null for the reference part.")
        ref = a["element"]
        if ref is None:
            d["target"] = None
            d["source"] = "reference"
            return {"deviation": describe(d)}
        name, kind, fit = find_element(session, ref)
        fit = dict(fit)
        fit.setdefault("kind", kind)
        if fit.get("kind") not in ("plane", "cylinder", "sphere", "torus"):
            raise ToolError("invalid_input", f"A {fit.get('kind')} has no surface to measure against.")
        N = vertex_normals(scan.V, scan.F)
        try:
            side = {"outward": 1, "inward": -1}[a["side"]] if a.get("side") else detect_material_side(fit, scan.V, N, d["maxDistance"])
            facing = a.get("facingDeg", DEFAULT_FACING_DEG)
            v = compute_element_deviation(fit, scan.V, N, side, None if facing is None else math.radians(facing))
        except (KeyError, TypeError, ValueError) as e:
            raise ToolError("invalid_input", f"element {ref!r}: its fit cannot be read ({e}).")
        d["target"] = {"ref": ref, "name": name, "fit": fit, "side": side, "facingDeg": facing, "values": v}
        d["source"] = "element"
        if d["rangeAuto"]:
            d["range"] = suggest_range(v, d["maxDistance"])
        return {"deviation": describe(d)}

    def settings(a):
        d = dstate(session)
        if "range" in a:
            d["range"] = max(1e-4, a["range"])
            d["rangeAuto"] = False
        if "maxDistance" in a:
            d["maxDistance"] = max(1e-4, a["maxDistance"])
            d["maxDistanceAuto"] = False
        if "tolerance" in a:
            d["tolerance"] = max(1e-4, a["tolerance"])
        if "bands" in a:
            d["bands"] = a["bands"]
        if "facingDeg" in a:
            f = a["facingDeg"]
            d["facingDeg"] = None if f is None else min(90, max(1, f))
            if d["align"] and d["reference"] and d["source"] == "reference":
                measure_map(d, S.scan_of(session))
        return {"deviation": describe(d)}

    def patch_figures(p):
        return {
            "centroid": [r3(x) for x in p["centroid"]],
            "box": {"min": [r3(x) for x in p["min"]], "max": [r3(x) for x in p["max"]]},
            "area": r3(p["area"]),
            "count": p["count"],
            "mean": r3(p["mean"]),
            "extreme": r3(p["extreme"]),
            "depth": r3(p["depth"]),
            "volume": r3(p["volume"]),
            "kind": p["kind"],
        }

    def patch_out(p):
        mem = p["members"]
        stride = max(1, len(mem) // HOTSPOT_VERTICES)
        return {**patch_figures(p), "side": "outside" if p["extreme"] > 0 else "inside", "at": [r3(x) for x in p["at"]], "vertex": p["index"], "vertices": [int(x) for x in mem[::stride][:HOTSPOT_VERTICES]]}

    def features_out(f):
        return {"count": f["count"], "shareOfExcess": r3(f["shareOfExcess"]), **({"note": FEATURES_NOTE} if f["count"] > 0 else {})}

    def hot(a):
        scan = S.scan_of(session)
        d = dstate(session)
        if a.get("on", "scan") == "reference":
            got = reference_reading(session)
            return {"on": "reference", "tolerance": d["tolerance"], "searchDistance": d["maxDistance"], "spacing": r3(got["spacing"]), "readings": int(len(got["values"])),
                    **on_reference.summary(got["values"], got["area"], got["centres"], a.get("tolerance", d["tolerance"])),
                    "note": "Read on the reference, signed as the map on the scan is: positive where the scan stands outside the reference (excess material on the part), negative where the scan lies inside it (the part lacks material there); unscanned where no scan surface facing its way lies under it within the search distance. view_render { map: \"deviation-reference\" } shows it."}
        values = map_values(d)
        if values is None:
            raise ToolError("invalid_state", "There is no deviation map to read — deviation_align measures one against the reference part, deviation_set_target one against an element.")
        tol = a.get("tolerance", d["tolerance"])
        limit = a.get("patches", HOTSPOT_PATCHES)
        grain = a.get("grain")
        search = d["maxDistance"]
        measured = is_measured(values, search)
        rep = hotspots(scan.V, values, tol, grain=grain, limit=limit, only=measured)
        fin = np.isfinite(values)
        with np.errstate(invalid="ignore"):
            far_in = fin & (values < -search)
            far_out = fin & (values > search)

        def far_side(mask):
            c = int(mask.sum())
            if c == 0:
                return {"count": 0, "found": 0, "patches": []}
            r = hotspots(scan.V, values, search, grain=grain, limit=limit, feature_depth=FEATURE_DEPTH * tol, only=mask)
            return {"count": c, "found": r["found"], "patches": [patch_out(p) for p in r["patches"]]}

        return {
            "source": d["source"],
            "tolerance": tol,
            "over": rep["over"],
            "found": rep["found"],
            "features": features_out(rep["features"]),
            "spacing": r3(rep["spacing"]),
            "grain": r3(rep["grain"]),
            "patches": [patch_out(p) for p in rep["patches"]],
            "far": {"searchDistance": search, "count": int(far_in.sum() + far_out.sum()), "inside": far_side(far_in), "outside": far_side(far_out)},
            "unmeasured": int((~fin).sum()),
        }

    def export(a):
        scan = S.scan_of(session)
        d = dstate(session)
        side = a.get("side", "scan")
        if side == "reference":
            return export_reference(a, scan, d)
        values = map_values(d)
        if values is None:
            raise ToolError("invalid_state", "There is no deviation map to export — deviation_align measures one against the reference part, deviation_set_target one against an element.")
        fmt = a.get("format", "ply")
        search, tol = d["maxDistance"], d["tolerance"]
        meas = is_measured(values, search)
        with np.errstate(invalid="ignore"):
            within = int((meas & (np.abs(values) <= tol)).sum())
        measured = int(meas.sum())
        what = "the scan by its distance to an element, a reading per vertex" if d["source"] == "element" else "the scan by its distance to the reference, a reading per vertex"
        stem = os.path.splitext(scan.name)[0] or "scan"
        path = a.get("path") or os.path.join(session.out_dir, f"{stem}-deviation-scan.{'txt' if fmt == 'report' else fmt}")
        if not os.path.isabs(path):
            path = os.path.join(session.out_dir, path)
        out = {}
        if fmt == "ply":
            data = ply_bytes(scan.V, values, search, what, map_colours(values, d["range"], search, d["bands"]))
        elif fmt == "csv":
            data = csv_bytes(scan.V, values)
        elif fmt == "npy":
            data = npy_bytes(scan.V, values)
        elif fmt == "report":
            stats = deviation_stats(values, search, tol)
            if d["source"] == "element":
                t = d["target"]
                text = element_report(scan.name, t["name"], t["fit"], t["side"], stats, d["range"], search, t["facingDeg"])
            else:
                text = deviation_report(scan.name, d["reference"]["name"], d["align"], stats, d["range"], search, d["facingDeg"])
            data = text.encode()
            out["report"] = text
        else:
            raise ToolError("invalid_input", "format: ply, csv, npy or report.")
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return {
            "side": "scan",
            "format": fmt,
            "readings": int(len(values)),
            "measured": measured,
            "withinTolerance": within,
            "withinTolerancePct": round(100 * within / len(values), 1) if len(values) else 0,
            "withinToleranceOfMeasuredPct": round(100 * within / measured, 1) if measured else 0,
            "measuredPct": round(100 * measured / len(values), 1) if len(values) else 0,
            "tolerance": tol,
            "searchDistance": search,
            "file": path,
            **out,
        }

    def export_reference(a, scan, d):
        # The map read on the reference: a reading per small piece of it, at
        # the piece's middle (on_reference), the same formats.
        got = reference_reading(session)
        values, P = got["values"], got["centres"]
        fmt = a.get("format", "ply")
        search, tol = d["maxDistance"], d["tolerance"]
        what = "the reference by its distance to the scan, a reading per small piece of it (positive: the scan outside the reference, excess material; negative: material missing)"
        stem = os.path.splitext(scan.name)[0] or "scan"
        path = a.get("path") or os.path.join(session.out_dir, f"{stem}-deviation-reference.{'txt' if fmt == 'report' else fmt}")
        if not os.path.isabs(path):
            path = os.path.join(session.out_dir, path)
        if fmt == "ply":
            data = ply_bytes(P, values, search, what, map_colours(values, d["range"], search, d["bands"]))
        elif fmt == "csv":
            data = csv_bytes(P, values)
        elif fmt == "npy":
            data = npy_bytes(P, values)
        else:
            raise ToolError("invalid_input", "format on the reference: ply, csv or npy (the report is the scan's).")
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        summ = on_reference.summary(values, got["area"], P, tol)
        return {"side": "reference", "format": fmt, "readings": int(len(values)), "spacing": r3(got["spacing"]), "coveredPct": summ["coveredPct"],
                "withinTolerancePct": summ.get("withinTolerancePct", 0), "tolerance": tol, "searchDistance": search, "file": path}

    def volume(a):
        d = require_reference(session)
        scan = S.scan_of(session)
        if not d["align"]:
            raise ToolError("invalid_state", "The scan is not aligned to the reference — never aligned, or moved since (align_clear, align_datum, align_auto, align_symmetry and scan_scale drop the alignment and its map): run deviation_align.")
        within = a.get("within")
        if within and not all(within["min"][k] < within["max"][k] for k in range(3)):
            raise ToolError("invalid_input", "within: min must lie below max on every axis.")
        tol = a.get("tolerance", d["tolerance"])
        ref = d["reference"]
        v = volume_deviation(ref["V"], ref["F"], scan.V, scan.F, R.identity(), tol, cell=a.get("cell"), within=within)
        out = volume_out(v, tol, a.get("regions", VOLUME_REGIONS), a.get("kinds") or KINDS)
        if v["scanOpenColumns"]:
            out["scanOpen"] = f"The scan is open: {v['scanOpenColumns']} columns of cells read through its holes by the winding number, unsure where it does not say. ScanRuler closes such holes with the reference first; this port does not."
        return out

    reading = {
        "range": {"type": "number", "exclusiveMinimum": 0, "description": "Colour scale, ± mm."},
        "maxDistance": {"type": "number", "exclusiveMinimum": 0, "description": "Search distance, mm."},
        "tolerance": {"type": "number", "exclusiveMinimum": 0, "description": "Tolerance, ± mm."},
    }
    facing = {"oneOf": [{"type": "number", "minimum": 1, "maximum": 90}, {"type": "null"}], "description": "Facing limit, degrees, or null."}
    patch_words = f"depth, the median |deviation| over the patch; volume, mm³ past the tolerance (the ranking key); kind, \"feature\" when the patch is at least {FEATURE_MIN_AREA} mm² and {FEATURE_MIN_SPACINGS} point spacings² across and its depth at least {FEATURE_DEPTH}× the tolerance — material missing or misplaced, to model or to name — else \"texture\""
    return [
        Tool(
            "deviation_open_reference",
            "Open the nominal part the scan is compared with — path to a STEP, IGES or BREP from CAD (tessellated finely) or an STL, PLY, OBJ, OFF or 3MF mesh (units for those: mm by default), or body, a solid in the FreeCAD document by name or label — in place of the one there is; any alignment and map against the old one go. Returns the deviation state.",
            obj({"path": {"type": "string"}, "body": {"type": "string"}, "units": {"type": "string", "enum": list(S.UNITS)}}),
            open_reference,
        ),
        Tool(
            "deviation_align",
            "Rigid best fit (no scale) of the scan onto the reference, then the deviation map under it. mode auto (the default) finds the pose on its own; points starts from three or more pairs of corresponding points (scan and reference, mm) then refines; local refines the fit in hand on a marked surface only (vertices), within searchDistance mm. The scan's vertices are moved onto the reference. Refuses (invalid_input) when the scan and the reference differ in size by more than 2× — a unit mix-up (×10, ×25.4, ×1000, named when near one) that would read as a near-perfect match on a patch of the big part; allowSizeMismatch: true fits anyway, for a scan that truly is a small piece of the reference. Refuses a scan with non-finite vertices. Returns the alignment (RMS, points matched, matchedShare — the share of sampled scan points that drove the pose —, converged, transform), the map's statistics (withinTolerancePct over every scan point, measured or not; withinToleranceOfMeasuredPct; measuredPct) and warnings: read them — a matchedShare under 50 %, a fit that did not converge, or under 80 % of the points measured each mean the map is not to be trusted as it stands. Sign: positive where the scan stands outside the reference (excess material), negative inside it (material missing). The auto search distance is 2 % of the reference's diagonal. Moving the part afterwards (align_clear, align_datum, align_auto, align_symmetry, scan_scale) drops this alignment and its map.",
            obj(
                {
                    "mode": {"type": "string", "enum": ["auto", "points", "local"]},
                    "pairs": {"type": "array", "minItems": 3, "items": obj({"scan": vec3("On the scan, mm."), "reference": vec3("The same point on the reference, mm.")}, ["scan", "reference"])},
                    "vertices": {"type": "array", "minItems": 3, "items": {"type": "integer", "minimum": 0}},
                    "searchDistance": {"type": "number", "exclusiveMinimum": 0},
                    "allowSizeMismatch": {"type": "boolean", "description": "Fit even when the scan and the reference differ in size by more than 2× — only for a scan that truly is a small piece of a larger reference, never to get past a unit mix-up."},
                }
            ),
            align,
        ),
        Tool(
            "deviation_measure",
            "Measure the deviation map again under the alignment in hand — after a change of facing limit, say. deviation_align measures it already. Refuses (invalid_state) when there is no alignment, including when the part was moved since it was made (align_clear, align_datum, align_auto, align_symmetry, scan_scale drop it): run deviation_align again. Returns the map's statistics (min, max, mean, RMS, sigma, percentiles; withinTolerancePct over every scan point, withinToleranceOfMeasuredPct, measuredPct, points matched) and warnings when under 80 % of the points have a reading. Sign: positive where the scan stands outside the reference (excess material), negative inside it (material missing).",
            obj({}),
            measure,
        ),
        Tool(
            "deviation_set_target",
            "Map how far the scan strays from one of its own fitted elements — a plane, cylinder, sphere or torus — instead of from a reference part; null goes back to the reference. side is the material side, read off the scan when the element is chosen (outward: the element's outer side; inward: a bore or shell) — give it to override. facingDeg limits which surface counts to what faces the element within that many degrees (60 by default), null for any. Returns the map's statistics.",
            obj(
                {
                    "element": {"oneOf": [{"type": "integer", "minimum": 1}, {"type": "string", "minLength": 1}, {"type": "null"}], "description": "The element (id or name), or null."},
                    "side": {"type": "string", "enum": ["outward", "inward"]},
                    "facingDeg": facing,
                },
                ["element"],
            ),
            set_target,
        ),
        Tool(
            "deviation_settings",
            "The deviation map's reading: range (colour scale, ± mm), maxDistance (search distance, mm: readings past it count as unmeasured), bands, tolerance (± mm the statistics count within), facingDeg (the map is measured again), colormap (jet). Returns the deviation state.",
            obj({**reading, "bands": {"oneOf": [{"type": "integer", "minimum": 2, "maximum": 256}, {"type": "null"}]}, "facingDeg": facing, "colormap": {"type": "string", "enum": ["jet"]}}),
            settings,
        ),
        Tool(
            "deviation_hotspots",
            f"The deviation map read as patches: the vertices past the tolerance gathered into connected regions, the largest and farthest first. Needs a map (deviation_align or deviation_set_target). Returns each patch's centroid, box, area, count, mean, extreme, depth, volume, kind, side, the extreme's point and vertex, a few vertices; features, found, over and unmeasured. {patch_words}. Trap: read far every time — the vertices past the search distance: far.inside is scan deep inside the reference (a hole, pocket or slot the model lacks), far.outside scan standing off it. Sign: a patch's mean and extreme are positive (side outside) where the scan stands outside the reference — excess material — and negative (side inside) where material is missing. on: reference reads the map on the reference instead (coveredPct, withinTolerancePct over the reference's area, mostExcess, mostMissing, unscanned), signed the same way. Changes nothing.",
            obj(
                {
                    "tolerance": {"type": "number", "exclusiveMinimum": 0},
                    "patches": {"type": "integer", "minimum": 1, "maximum": 50},
                    "grain": {"type": "number", "exclusiveMinimum": 0},
                    "on": {"type": "string", "enum": ["scan", "reference"]},
                }
            ),
            hot,
        ),
        Tool(
            "deviation_volume",
            "The scan and the reference part compared as solids, on a grid of small cells: each cell inside one and not the other is an error, touching cells a region. excess is material the reference has and the part has not, missing the other way round, unsure where the scan does not say (never an error). Needs deviation_align. Returns totals (mm³ and % of the reference) and the regions largest first, each with kind, volume, maxDepth, thickness, shape (layer or lump), centroid, deepest, box, evidence and confidence. Trap: nothing thinner than smallestSeen (two cells) is seen. Changes nothing.",
            obj(
                {
                    "tolerance": {"type": "number", "exclusiveMinimum": 0},
                    "cell": {"type": "number", "exclusiveMinimum": 0},
                    "regions": {"type": "integer", "minimum": 1, "maximum": MAX_REGIONS},
                    "within": obj({"min": vec3("Lowest corner, mm."), "max": vec3("Highest corner, mm.")}, ["min", "max"]),
                    "kinds": {"type": "array", "items": {"type": "string", "enum": list(KINDS)}},
                }
            ),
            volume,
        ),
        Tool(
            "deviation_export",
            "The deviation map as a file — side scan (the default) or reference (the map read on the reference, a reading per small piece of it; ply, csv or npy): format ply (the default: binary, a vertex per scan vertex with x, y, z, deviation, measured and the map's jet colour), csv (x,y,z,d), npy (N × 4 float32) or report (ScanRuler's plain-text report, also in the answer). path, else in the session's folder. Returns the file with readings, measured, measuredPct, withinTolerance, withinTolerancePct (over every reading, measured or not), withinToleranceOfMeasuredPct, tolerance and searchDistance. Sign, both sides: positive where the scan stands outside the reference (excess material), negative inside it (material missing). Trap: the distance is NaN where there is no reading, and a reading past the search distance is kept as it is. Changes nothing.",
            obj({"side": {"type": "string", "enum": ["scan", "reference"]}, "format": {"type": "string", "enum": ["ply", "csv", "npy", "report"]}, "path": {"type": "string"}}),
            export,
        ),
    ]
