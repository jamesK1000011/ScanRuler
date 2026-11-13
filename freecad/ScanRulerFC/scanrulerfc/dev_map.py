# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/deviation/deviation.ts,
# src/core/deviation/elementField.ts, src/core/deviation/report.ts,
# src/core/deviation/exportDeviation.ts, src/core/geometry/normals.ts
#
# The deviation map: the signed distance from every scan vertex to the
# reference surface, positive outside it, read under a facing limit that
# measures a point whose nearest surface faces away from it (the far side of
# a thin wall) against the nearest surface that faces its way. Its
# statistics, its colour range, the map against a fitted element instead,
# the plain-text report and the files the readings are written to.

import math
import struct

import numpy as np

from .dev_align import scan_normals_sign
from .dev_field import field_percentiles, field_stats, nice_ceil, paint

FACING_REACH = 0.1
DEFAULT_MAP_FACING_DEG = 90
MAX_AUTO_RANGE = 1


def vertex_normals(V, F):
    """Area-weighted vertex normals, +Z where none."""
    V = np.asarray(V, dtype=float)
    F = np.asarray(F, dtype=np.int64)
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    out = np.zeros_like(V)
    for k in range(3):
        np.add.at(out, F[:, k], n)
    length = np.linalg.norm(out, axis=1)
    ok = length > 1e-20
    out[ok] /= length[ok, None]
    out[~ok] = (0.0, 0.0, 1.0)
    return out


def closest_facing_way(surface, P, S, min_facing, max_distance=math.inf, facing_reach=None):
    """Per row: the nearest surface when it faces the point's normal S
    within min_facing (a cosine) — 'nearest' — else the nearest within
    facing_reach that does — 'refaced' — else 'unfacing' (the plain hit kept)
    or 'none'. Returns (hits, read) with read coded 0 none, 1 nearest,
    2 refaced, 3 unfacing."""
    facing_reach = max_distance if facing_reach is None else facing_reach
    hit = surface.closest(P, max_distance)
    read = np.where(hit.found, 1, 0).astype(np.int8)
    if min_facing is None:
        return hit, read
    bad = hit.found & (np.einsum("ij,ij->i", S, hit.normal) < min_facing)
    if bad.any():
        idx = np.nonzero(bad)[0]
        h2 = surface.closest(P[idx], facing_reach, facing=S[idx], min_dot=min_facing)
        good = h2.found & (np.einsum("ij,ij->i", S[idx], h2.normal) >= min_facing)
        read[idx] = np.where(good, 2, 3)
        g = idx[good]
        for name in ("found", "distance", "signed", "point", "normal", "face"):
            getattr(hit, name)[g] = getattr(h2, name)[good]
    return hit, read


def compute_deviation(surface, positions, transform, normals=None, max_normal_deviation=None):
    """Signed distance from every scan vertex to the reference, NaN where a
    facing limit leaves it unmeasured. Unbounded, so the search distance
    stays a reading control that moves either way without measuring again."""
    P = transform.apply(np.asarray(positions, dtype=float).reshape(-1, 3))
    min_facing = math.cos(max_normal_deviation) if normals is not None and max_normal_deviation is not None else None
    if min_facing is None:
        hit = surface.closest(P)
        return np.where(hit.found, hit.signed, np.nan)
    outward = scan_normals_sign(surface, positions, normals, transform)
    S = transform.rotate(outward * np.asarray(normals, dtype=float))
    hit, read = closest_facing_way(surface, P, S, min_facing, math.inf, surface.bbox_diagonal * FACING_REACH)
    return np.where((read == 1) | (read == 2), hit.signed, np.nan)


def deviation_stats(values, max_distance, tolerance):
    v = np.asarray(values, dtype=float)
    with np.errstate(invalid="ignore"):
        within = int(((np.abs(v) <= max_distance) & (np.abs(v) <= tolerance)).sum())
    return {**field_stats(v, -max_distance, max_distance), "withinTolerance": within, "tolerance": tolerance}


def suggest_range(values, max_distance):
    p95 = field_percentiles(values, -max_distance, max_distance, [0.95], True)[0]
    return min(MAX_AUTO_RANGE, nice_ceil(p95)) if math.isfinite(p95) and p95 > 0 else 0.1


def default_max_distance(bbox_diagonal):
    return nice_ceil(bbox_diagonal * 0.02)


# ---- against a fitted element (elementField.ts) ----

DEFAULT_FACING_DEG = 60


def probe_element(fit, P):
    """offset along the element's outward direction, that direction, and
    whether the point lies within the element as drawn."""
    P = np.asarray(P, dtype=float)
    kind = fit["kind"]
    c = np.asarray(fit["center"], dtype=float)
    d = P - c
    o = np.zeros_like(P)
    if kind == "plane":
        nrm = np.asarray(fit["normal"], dtype=float)
        u = d @ np.asarray(fit["basisU"], dtype=float)
        v = d @ np.asarray(fit["basisV"], dtype=float)
        o[:] = nrm
        return d @ nrm, o, (np.abs(u) <= fit["extentU"]) & (np.abs(v) <= fit["extentV"])
    if kind in ("cylinder", "torus"):
        ax = np.asarray(fit["axis"], dtype=float)
        t = d @ ax
        w = d - t[:, None] * ax
        rho = np.linalg.norm(w, axis=1)
        on_axis = rho <= 1e-12
        safe = np.where(on_axis, 1, rho)
        if kind == "cylinder":
            o = np.where(on_axis[:, None], 0, w / safe[:, None])
            return rho - fit["radius"], o, ~on_axis & (np.abs(t) <= fit["length"] / 2)
        s = d - fit["majorRadius"] * w / safe[:, None]
        dist = np.linalg.norm(s, axis=1)
        offset = np.where(on_axis, np.hypot(fit["majorRadius"], t) - fit["minorRadius"], dist - fit["minorRadius"])
        bad = on_axis | (dist <= 1e-12)
        o = np.where(bad[:, None], 0, s / np.where(dist > 1e-12, dist, 1)[:, None])
        return offset, o, ~bad
    if kind == "sphere":
        dist = np.linalg.norm(d, axis=1)
        bad = dist <= 1e-12
        o = np.where(bad[:, None], 0, d / np.where(bad, 1, dist)[:, None])
        return dist - fit["radius"], o, ~bad
    raise ValueError(f"A {kind} has no surface to measure against.")


def detect_material_side(fit, positions, normals, max_distance):
    off, o, inside = probe_element(fit, positions)
    near = inside & (np.abs(off) <= max_distance)
    agree = float(np.einsum("ij,ij->i", np.asarray(normals)[near], o[near]).sum())
    return -1 if agree < 0 else 1


def compute_element_deviation(fit, positions, normals, side, max_normal_deviation):
    off, o, inside = probe_element(fit, positions)
    min_facing = -math.inf if max_normal_deviation is None else math.cos(max_normal_deviation)
    facing = side * np.einsum("ij,ij->i", np.asarray(normals, dtype=float), o)
    ok = inside & (facing >= min_facing)
    return np.where(ok, side * off, np.nan)


def describe_target(fit):
    k = fit["kind"]
    if k == "plane":
        return f"plane, {2 * fit['extentU']:.1f} × {2 * fit['extentV']:.1f} mm as drawn"
    if k == "cylinder":
        return f"cylinder, ⌀{2 * fit['radius']:.3f} × {fit['length']:.1f} mm as drawn"
    if k == "torus":
        return f"torus, tube R {fit['minorRadius']:.3f} mm on a ring ⌀{2 * fit['majorRadius']:.3f} mm"
    return f"sphere, ⌀{2 * fit['radius']:.3f} mm"


# ---- the report (report.ts), in millimetres ----

SOURCE = {"auto": "automatic", "points": "from picked points", "local": "local fine fit on marked surface", "built": "none"}


def _len(v):
    return f"{v:.4f} mm"


def _signed(v):
    return f"{'+' if v >= 0 else '−'}{abs(v):.4f} mm"


def _setting(v):
    return f"{v:g} mm"


def _stat_lines(stats):
    # Within tolerance over every scan point: a point with no reading is not
    # a point shown to be in tolerance.
    pct = (stats["withinTolerance"] / stats["total"]) * 100 if stats["total"] else 0
    of_measured = (stats["withinTolerance"] / stats["measured"]) * 100 if stats["measured"] else 0
    return [
        f"  min             {_signed(stats['min'])}",
        f"  max             {_signed(stats['max'])}",
        f"  mean            {_signed(stats['mean'])}",
        f"  RMS             {_len(stats['rms'])}",
        f"  sigma           {_len(stats['sigma'])}",
        f"  within ±{_setting(stats['tolerance'])}   {pct:.1f} % of all scan points ({of_measured:.1f} % of those measured)",
        f"  matched         {stats['measured']} of {stats['total']} scan points",
    ]


def deviation_report(scan_name, nominal_name, align, stats, rng, max_distance, facing_deg):
    lines = ["ScanRuler — deviation from nominal", f"Scan:      {scan_name}", f"Reference: {nominal_name}", ""]
    if align["source"] == "built":
        lines += ["Alignment: none — the reference was modelled on this scan and is", "  compared in the scan’s own frame"]
    else:
        lines += [
            f"Alignment: rigid best fit (6 DOF, no scale), {SOURCE[align['source']]}",
            f"  fit RMS         {_len(align['rms'])} over {align['matched']} of {align['sampled']} sampled points",
            f"  passes          {align['iterations']}{'  (a second starting pose fitted almost as well)' if align.get('ambiguous') else ''}",
        ]
        if align.get("converged") is False:
            lines.append("  NOTE: the fit had not settled when the passes ran out — treat the pose with care")
        if align.get("matchedShare") is not None and align["matchedShare"] < 0.5:
            lines.append(f"  NOTE: only {align['matchedShare'] * 100:.0f} % of the sampled points found the reference — check it is the same part")
    if align["source"] == "local":
        lines += [f"  marked surface  {align.get('selected', 0)} scan points, hand-marked", f"  search limit    {_setting(align.get('searchDistance', 0))}"]
        if align.get("underconstrained"):
            lines.append("  NOTE: the marked surface faces one way — the fit is free to slide along it")
    if align["source"] == "points" and align.get("selected") is not None:
        lines.append(f"  fitted on       {align['selected']} scan points, selected by hand")
    lines += ["", "Deviation, scan to reference surface, signed outwards:", "  positive = outside the reference (excess material), negative = inside it (material missing)"]
    lines += _stat_lines(stats)
    lines += [
        "",
        f"  max search distance  {_setting(max_distance)}",
        f"  facing limit         {'off — the nearest surface counts, whatever it faces' if facing_deg is None else f'{facing_deg:g}°'}",
        f"  colour scale         ±{_setting(rng)}",
        "",
    ]
    return "\n".join(lines)


def element_report(scan_name, element_name, fit, side, stats, rng, max_distance, facing_deg):
    lines = [
        "ScanRuler — deviation from a fitted element",
        f"Scan:    {scan_name}",
        f"Element: {element_name} — {describe_target(fit)}",
        "",
        "Measured in scan coordinates — the element was fitted on this scan, so",
        "there is no alignment between the two and none has been applied.",
    ]
    if fit.get("sigma") is not None:
        lines.append(f"  form deviation of the element itself   {_len(fit['sigma'])} sigma")
    if fit.get("formError") is not None:
        lines.append(f"  form error (peak-to-peak)               {_len(fit['formError'])}")
    lines += [
        f"  material side                          {'the element' + chr(39) + 's outward side' if side == 1 else 'the inner side — a bore or a shell'}",
        "",
        "Deviation, scan to element, signed towards the material:",
        "  positive = too much material, negative = too little",
    ]
    lines += _stat_lines(stats)
    lines += [
        "",
        "  region               the element as drawn",
        f"  max search distance  {_setting(max_distance)}",
        f"  facing limit         {'off — any surface within the element counts' if facing_deg is None else f'{facing_deg:g}°'}",
        f"  colour scale         ±{_setting(rng)}",
        "",
    ]
    return "\n".join(lines)


# ---- files (exportDeviation.ts) ----


def is_measured(values, search):
    with np.errstate(invalid="ignore"):
        return np.abs(values) <= search


def ply_bytes(positions, values, search, what, rgb=None):
    """Binary little-endian PLY, a vertex per reading: float x, y, z, float
    deviation, uchar measured — and, with rgb, the map's colour (uchar red,
    green, blue) so a viewer shows the map as painted."""
    n = len(values)
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"comment ScanRuler deviation: {what}, mm\n"
        "comment deviation is NaN where there is no reading\n"
        f"comment measured is 1 within the search distance ({search:g} mm), as the statistics count\n"
        f"element vertex {n}\nproperty float x\nproperty float y\nproperty float z\nproperty float deviation\nproperty uchar measured\n"
        + ("property uchar red\nproperty uchar green\nproperty uchar blue\n" if rgb is not None else "")
        + "end_header\n"
    )
    fields = [("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("d", "<f4"), ("m", "u1")]
    if rgb is not None:
        fields += [("r", "u1"), ("g", "u1"), ("b", "u1")]
    rec = np.empty(n, dtype=np.dtype(fields))
    P = np.asarray(positions, dtype=np.float32).reshape(-1, 3)
    rec["x"], rec["y"], rec["z"] = P[:, 0], P[:, 1], P[:, 2]
    rec["d"] = np.asarray(values, dtype=np.float32)
    rec["m"] = is_measured(np.asarray(values), search).astype(np.uint8)
    if rgb is not None:
        rec["r"], rec["g"], rec["b"] = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    return header.encode() + rec.tobytes()


def npy_bytes(positions, values):
    n = len(values)
    d = f"{{'descr': '<f4', 'fortran_order': False, 'shape': ({n}, 4), }}"
    total = -(-(10 + len(d) + 1) // 64) * 64
    d = d.ljust(total - 10 - 1) + "\n"
    arr = np.hstack([np.asarray(positions, dtype=np.float32).reshape(-1, 3), np.asarray(values, dtype=np.float32)[:, None]])
    return b"\x93NUMPY\x01\x00" + struct.pack("<H", len(d)) + d.encode() + arr.astype("<f4").tobytes()


def csv_bytes(positions, values):
    P = np.asarray(positions, dtype=float).reshape(-1, 3)
    lines = ["x,y,z,d"]
    for p, v in zip(P, np.asarray(values, dtype=float)):
        lines.append(f"{p[0]:.4f},{p[1]:.4f},{p[2]:.4f},{'nan' if math.isnan(v) else f'{v:.5f}'}")
    return ("\n".join(lines) + "\n").encode()


def map_colours(values, rng, max_distance, bands=None):
    return paint(values, -rng, rng, -max_distance, max_distance, bands)
