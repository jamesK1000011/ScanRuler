# SPDX-License-Identifier: AGPL-3.0-only
# What ScanRuler for FreeCAD gives Agent Link's pictures (view_render): the
# scan and the reference part as layers, and the scan's maps — deviation
# from the reference (ScanRuler's colour map, ±range, grey past the max
# distance) and wall thickness (red thin, as ScanRuler shows it). So the
# agent sees what the numbers say, as ScanRuler's user does.

import numpy as np

from . import scanstate as S

SCAN_GREY = (0.72, 0.72, 0.70)
REFERENCE_BLUE = (0.45, 0.62, 0.85)


def _scan(session):
    st = S.state(session)
    return st["scan"]


def scan_layer(session, a):
    sc = _scan(session)
    if sc is None:
        return []
    return [{"name": "scan", "V": sc.V, "F": sc.F, "color": SCAN_GREY, "creases": False, "mapped": True}]


def reference_layer(session, a):
    # Drawn only when asked for: it lies on the scan once aligned.
    if "reference" not in (a.get("layers") or []):
        return []
    from .fam_deviation import dstate

    ref = dstate(session)["reference"]
    if ref is None:
        return []
    return [{"name": "reference", "V": ref["V"], "F": ref["F"], "color": REFERENCE_BLUE, "creases": True}]


def deviation_map(session, a):
    from agentlink.protocol import ToolError

    from .fam_deviation import dstate, map_values

    sc = _scan(session)
    if sc is None:
        raise ToolError("invalid_state", "No scan open: scan_open { path } first.")
    d = dstate(session)
    v = map_values(d)
    if v is None:
        raise ToolError("invalid_state", "No deviation map yet: deviation_open_reference, then deviation_align.")
    v = np.asarray(v, dtype=float).copy()
    with np.errstate(invalid="ignore"):
        v[np.abs(v) > d["maxDistance"]] = np.nan
    # ScanRuler's range, but never under the tolerance: a scan that sits
    # on the reference would otherwise spread its rounding over the colours.
    rng = max(float(d["range"] or 0), float(d["tolerance"] or 0), 1e-3)
    side = "against the element " + str(d["target"]["ref"]) if d["source"] == "element" and d["target"] else "against the reference"
    return {"layers": [{"name": "scan", "V": sc.V, "F": sc.F, "values": v, "creases": False}], "unit": "mm", "cmap": "jet", "worst": "abs",
            "range": [-rng, rng], "label": "DEVIATION",
            "note": f"The scan {side}: red (positive) stands proud of it — excess material —, blue (negative) below — material missing; grey past the max distance ({d['maxDistance']:g} mm) or unread. deviation_settings sets range and max distance."}


def deviation_reference_map(session, a):
    from .fam_deviation import dstate, reference_reading

    d = dstate(session)
    got = reference_reading(session)
    P = got["pieces"]
    V = P.reshape(-1, 3)
    F = np.arange(len(V), dtype=np.int64).reshape(-1, 3)
    v = np.repeat(np.asarray(got["values"], dtype=float), 3)
    rng = max(float(d["range"] or 0), float(d["tolerance"] or 0), 1e-3)
    return {"layers": [{"name": "reference", "V": V, "F": F, "values": v, "creases": True}], "unit": "mm", "cmap": "jet", "worst": "abs",
            "range": [-rng, rng], "label": "ON THE REFERENCE",
            "note": f"The reference read against the scan, signed as the scan's own map: red where the scan stands outside it (excess material), blue where the scan lies inside it (the part lacks material); grey where no scan lies under it within {d['maxDistance']:g} mm — unscanned, or missing."}


def thickness_map(session, a):
    from agentlink.protocol import ToolError

    from .fam_thickness import tstate

    sc = _scan(session)
    if sc is None:
        raise ToolError("invalid_state", "No scan open: scan_open { path } first.")
    t = tstate(session)
    if t["values"] is None:
        raise ToolError("invalid_state", "No thickness map yet: thickness_measure first.")
    return {"layers": [{"name": "scan", "V": sc.V, "F": sc.F, "values": np.asarray(t["values"], dtype=float), "creases": False}], "unit": "mm", "cmap": "jet_r", "worst": "min",
            "range": [float(t["low"]), float(t["high"])], "label": "THICKNESS",
            "note": f"The scan's wall at each vertex ({t['method']}): red thin; grey unread. Limit {t['limit']:g} mm."}


def register():
    try:
        from agentlink import render
    except ImportError:  # an Agent Link without pictures
        return
    # An older Agent Link may have pictures but not these hooks: register
    # what it takes and leave the rest.
    layer = getattr(render, "register_layer", None)
    add_map = getattr(render, "register_map", None)
    if layer is not None:
        layer("scan", scan_layer, "The open scan (grey).")
        layer("reference", reference_layer, "The deviation reference part (blue) — drawn when asked for by name, as it lies on the scan.")
    if add_map is None:
        return
    add_map("deviation", deviation_map, "The scan's deviation from the reference (ScanRuler), ±range: positive (red) excess material, negative (blue) material missing.")
    add_map("deviation-reference", deviation_reference_map, "The deviation read on the reference (ScanRuler's map on the reference), signed as the scan's map — positive (red) excess material, negative (blue) material missing — and what was not scanned (grey).")
    add_map("thickness", thickness_map, "The scan's wall thickness (ScanRuler), red thin.")
