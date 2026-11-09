# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/thickness/thickness.ts,
# src/core/thickness/report.ts
#
# Wall thickness on the part alone, no reference. Ray: along the inward
# normal to the first surface ahead that faces back at it (a cone of rays
# about it takes the shortest, finding the narrow way across a chamfer).
# Sphere: a sphere put halfway across what the ray crossed and grown until it
# touches — never wider than the ray, and the block at a block's edge. Both
# sides of every triangle are tested: a scan is not reliably wound.

import math

import numpy as np

from .dev_field import field_percentiles, field_stats, nice_ceil, nice_floor

DEFAULT_CONE_ANGLE_DEG = 30
DEFAULT_NORMAL_DEVIATION_DEG = 60
FACING_ATTEMPTS = 4
GOLDEN = math.pi * (3 - math.sqrt(5))


def _shoot(surface, O, D, near, far, facing):
    """Distance to the first surface ahead that faces the ray, stepping over
    up to FACING_ATTEMPTS surfaces nearly edge-on to it; inf for none."""
    n = len(O)
    out = np.full(n, np.inf)
    start = np.full(n, float(near))
    far = np.broadcast_to(np.asarray(far, dtype=float), (n,)).copy()
    live = np.arange(n)
    for _ in range(FACING_ATTEMPTS):
        if len(live) == 0:
            break
        t, f = surface.raycast_first(O[live], D[live], start[live], far[live])
        hit = f >= 0
        if facing < 0:
            out[live[hit]] = t[hit]
            break
        square = np.abs(np.einsum("ij,ij->i", surface.face_normal[np.where(hit, f, 0)], D[live]))
        ok = hit & (square >= facing)
        out[live[ok]] = t[ok]
        again = hit & ~ok
        start[live[again]] = t[again] + near
        live = live[again]
    return out


def compute_thickness(surface, positions, normals, method="ray", cone_rays=0, cone_angle=math.radians(DEFAULT_CONE_ANGLE_DEG), max_normal_deviation=math.radians(DEFAULT_NORMAL_DEVIATION_DEG), max_thickness=10.0, epsilon=1e-6):
    """Wall thickness at every vertex, NaN where nothing lies behind it
    within max_thickness. `surface` is the scan itself (NominalSurface)."""
    P = np.asarray(positions, dtype=float).reshape(-1, 3)
    D = -np.asarray(normals, dtype=float).reshape(-1, 3)
    facing = -1.0 if max_normal_deviation is None else math.cos(min(math.pi / 2, max_normal_deviation))
    best = _shoot(surface, P, D, epsilon, max_thickness, facing)
    if method == "sphere":
        out = np.full(len(P), np.nan)
        ok = np.isfinite(best)
        if ok.any():
            half = best[ok] / 2
            centre = P[ok] + D[ok] * half[:, None]
            hit = surface.closest(centre)
            # Bounded by half the ray: nothing found nearer leaves the ray.
            dia = np.where(hit.found & (hit.distance <= half), 2 * hit.distance, best[ok])
            out[ok] = dia
        return out
    if cone_rays > 0:
        k = np.arange(cone_rays)
        theta = cone_angle * np.sqrt((k + 0.5) / cone_rays)
        phi = (k + 1) * GOLDEN
        ax = np.abs(D)
        hx = ((ax[:, 0] <= ax[:, 1]) & (ax[:, 0] <= ax[:, 2])).astype(float)
        hy = ((ax[:, 1] < ax[:, 0]) & (ax[:, 1] <= ax[:, 2])).astype(float)
        hz = np.where((hx + hy) > 0, 0.0, 1.0)
        H = np.stack([hx, hy, hz], axis=1)
        U = np.cross(D, H)
        ul = np.linalg.norm(U, axis=1)
        good = (best > epsilon) & (ul > 1e-12)
        idx = np.nonzero(good)[0]
        if len(idx):
            U = U[idx] / ul[idx, None]
            Dd = D[idx]
            W = np.cross(Dd, U)
            for j in range(cone_rays):
                su = math.sin(theta[j]) * math.cos(phi[j])
                sw = math.sin(theta[j]) * math.sin(phi[j])
                dirs = Dd * math.cos(theta[j]) + U * su + W * sw
                d = _shoot(surface, P[idx], dirs, epsilon, np.minimum(max_thickness, best[idx]), facing)
                best[idx] = np.minimum(best[idx], d)
    return np.where(np.isfinite(best), best, np.nan)


def thickness_stats(values, limit):
    v = np.asarray(values, dtype=float)
    with np.errstate(invalid="ignore"):
        below = int((v < limit).sum())
    return {**field_stats(v, 0, math.inf), "belowLimit": below, "limit": limit}


def suggest_thickness_scale(values):
    p2, p95 = field_percentiles(values, 0, math.inf, [0.02, 0.95])
    if not (math.isfinite(p2) and math.isfinite(p95)):
        return 0, 1
    low, high = nice_floor(p2), nice_ceil(p95)
    if high > low:
        return low, high
    return nice_floor(p95 * 0.5), nice_ceil(p95 * 1.5)


def default_max_thickness(bbox_diagonal):
    return nice_ceil(bbox_diagonal * 0.2)


def thickness_report(scan_name, stats, settings):
    pct = (stats["belowLimit"] / stats["measured"]) * 100 if stats["measured"] else 0
    if settings["method"] == "sphere":
        method = "sphere grown at the midpoint of the ray along the inward normal, measured across"
    elif settings["coneRays"] > 0:
        method = f"shortest of {settings['coneRays']} rays through a {settings['coneAngleDeg']:g}° cone about the inward normal"
    else:
        method = "ray along the inward surface normal"
    nd = settings["normalDeviationDeg"]
    return "\n".join(
        [
            "ScanRuler — wall thickness",
            f"Part: {scan_name}",
            "",
            f"Method: {method}",
            f"  max. thickness searched  {settings['maxThickness']:g} mm",
            f"  far surface must face back within  {'not checked' if nd is None else f'{nd:g}°'}",
            "",
            "Wall thickness at each scan point:",
            f"  min             {stats['min']:.4f} mm",
            f"  max             {stats['max']:.4f} mm",
            f"  mean            {stats['mean']:.4f} mm",
            f"  sigma           {stats['sigma']:.4f} mm",
            f"  under {stats['limit']:g} mm      {pct:.1f} %  ({stats['belowLimit']} points)",
            f"  measured        {stats['measured']} of {stats['total']} scan points",
            "",
            f"  colour scale         {settings['low']:g} … {settings['high']:g} mm",
            "",
        ]
    )
