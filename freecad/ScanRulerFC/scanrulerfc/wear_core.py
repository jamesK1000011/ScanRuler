# SPDX-License-Identifier: AGPL-3.0-only
# Wear read and repaired against what the part should be, and a model
# pre-warped against a print of it. Ported from ScanRuler by CNC Kitchen:
# plugins/wear-repair/core/geometry.ts (regions, mirror, topology),
# repair.ts (diff, scatter, the tolerance's floor, rebuild) and prewarp.ts
# (the pre-warp and the stop rule), to numpy over the port's reference
# surface (dev_surface.NominalSurface) in place of three-mesh-bvh.
#
# The mesh keeps its triangles: a worn or dented surface comes back; a piece
# broken off, with no scan surface left to move, does not.

import struct

import numpy as np

from .dev_surface import NominalSurface

SCATTER_SAMPLE = 20000


def outside(region, P):
    """How far each point is outside a region, mm: 0 inside."""
    P = np.asarray(P, float)
    if region["kind"] == "sphere":
        return np.maximum(0.0, np.linalg.norm(P - np.asarray(region["center"], float), axis=1) - region["radius"])
    lo, hi = np.asarray(region["min"], float), np.asarray(region["max"], float)
    d = np.maximum(np.maximum(lo - P, 0.0), P - hi)
    return np.linalg.norm(d, axis=1)


def weight(worn, keep, blend, P):
    """Each point's weight: 1 inside any worn region, falling to 0 over
    `blend` mm outside, 0 beyond — and 0 inside any region kept."""
    P = np.asarray(P, float)
    w = np.zeros(len(P))
    for r in worn:
        d = outside(r, P)
        w = np.maximum(w, np.where(d == 0, 1.0, np.where((blend > 0) & (d < blend), 1 - d / max(blend, 1e-12), 0.0)))
    for r in keep:
        w[outside(r, P) == 0] = 0.0
    return w


def mirror(V, F, point, normal):
    """A mesh mirrored across a plane, its triangles wound back so they still
    face out."""
    n = np.asarray(normal, float)
    n /= np.linalg.norm(n)
    V = np.asarray(V, float)
    d = (V - np.asarray(point, float)) @ n
    return V - 2 * np.outer(d, n), np.asarray(F)[:, [0, 2, 1]].copy()


def surface(V, F):
    return NominalSurface(np.asarray(V, float), np.asarray(F, np.int64))


def _near(ref, P, max_mm):
    h = ref.closest(P, max_mm)
    return h.found & (h.distance <= max_mm), h


def r3(v):
    return round(float(v), 3) + 0.0


def diff(V, ref, regions, tolerance, max_mm):
    """Per worn region: how far the scan stands in from the reference (lost,
    negative) and out (added), mean, RMS and points past the tolerance."""
    out = []
    for t in regions:
        inside = weight([t["region"]], [], 0, V) >= 1
        P = np.asarray(V, float)[inside]
        ok, h = _near(ref, P, max_mm) if len(P) else (np.zeros(0, bool), None)
        ds = h.signed[ok] if len(P) else np.zeros(0)
        if not len(ds):
            out.append({"name": t["name"], "points": 0, "lost": 0.0, "added": 0.0, "mean": 0.0, "rms": 0.0, "pointsLost": 0, "pointsAdded": 0})
            continue
        out.append({"name": t["name"], "points": int(len(ds)), "lost": r3(min(0.0, ds.min())), "added": r3(max(0.0, ds.max())),
                    "mean": r3(ds.mean()), "rms": r3(np.sqrt((ds ** 2).mean())),
                    "pointsLost": int((ds < -tolerance).sum()), "pointsAdded": int((ds > tolerance).sum())})
    return out


def scatter(V, ref, worn, max_mm):
    """The scan's own spread against the reference off the worn regions
    (1.4826 × MAD of the signed distance); None under 50 points."""
    V = np.asarray(V, float)
    P = V[:: max(1, len(V) // SCATTER_SAMPLE)]
    if worn:
        P = P[weight(worn, [], 0, P) == 0]
    if not len(P):
        return None
    ok, h = _near(ref, P, max_mm)
    ds = h.signed[ok]
    if len(ds) < 50:
        return None
    m = np.sort(ds)[len(ds) >> 1]
    mad = np.sort(np.abs(ds - m))[len(ds) >> 1]
    return {"mm": round(1.4826 * float(mad), 4) + 0.0, "points": int(len(ds))}


def tolerance_floor(s, noise=None):
    """The least tolerance this scan supports: twice the scatter or three
    times the noise to plan with, the larger; None with neither."""
    by_scatter = 2 * s["mm"] if s else 0.0
    by_noise = 3 * noise["sigmaMm"] if noise else 0.0
    if not by_scatter > 0 and not by_noise > 0:
        return None
    return {"mm": round(by_noise, 4), "by": "noise"} if by_noise > by_scatter else {"mm": round(by_scatter, 4), "by": "scatter"}


def scatter_note(s, tolerance, noise=None, noise_from=None):
    floor = tolerance_floor(s, noise)
    if not floor or tolerance >= floor["mm"]:
        return None
    import math

    raise_to = math.ceil(floor["mm"] * 100 - 1e-9) / 100
    if floor["by"] == "scatter":
        return (f"the tolerance ({tolerance:g} mm) is under twice the scan's scatter off the worn regions ({s['mm']:g} mm): points past it may be scatter, "
                f"not wear — raise it to about {raise_to:g} mm, or rescan finer")
    return (f"the tolerance ({tolerance:g} mm) is under three times the scan noise ({noise['sigmaMm']:g} mm, {noise_from}): nothing finer is trustworthy on "
            f"this scan, so points past it may be noise, not wear — raise it to about {raise_to:g} mm, or rescan finer")


def rebuild(V, ref, worn, keep, blend_mm, max_mm, mode="add"):
    """Each worn vertex moved onto the reference, weighed down over the blend
    band, never inside keep, never where the reference is past max_mm; in
    add mode only lost material comes back."""
    out = np.array(V, float)
    w = weight(worn, keep, blend_mm, out)
    idx = np.nonzero(w > 0)[0]
    if not len(idx):
        return out, 0, 0.0
    ok, h = _near(ref, out[idx], max_mm)
    ok &= h.distance > 1e-6
    if mode == "add":
        ok &= ~(h.signed > 0)
    i, ww = idx[ok], w[idx][ok]
    out[i] += ww[:, None] * (h.point[ok] - out[i])
    largest = float((ww * h.distance[ok]).max()) if len(i) else 0.0
    return out, int(len(i)), r3(largest)


def vertex_normals(V, F):
    V, F = np.asarray(V, float), np.asarray(F, np.int64)
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    N = np.zeros_like(V)
    for k in range(3):
        np.add.at(N, F[:, k], n)
    ln = np.linalg.norm(N, axis=1)
    ln[ln == 0] = 1
    return N / ln[:, None]


def _neighbours(F, n):
    e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    e = np.unique(np.sort(e, axis=1), axis=0)
    return np.concatenate([e, e[:, ::-1]])


def prewarp(TV, TF, printed, gain=1.0, smooth=2, max_mm=2.0):
    """The target moved back along its normals by the error the print shows,
    smoothed over `smooth` neighbour rings, times gain."""
    TV, TF = np.asarray(TV, float), np.asarray(TF, np.int64)
    N = vertex_normals(TV, TF)
    n = len(TV)
    h = printed.closest(TV, max_mm)
    known = h.found & (h.distance <= max_mm)
    e = np.zeros(n)
    e[known] = ((h.point - TV) * N).sum(axis=1)[known]
    rms = float(np.sqrt((e[known] ** 2).mean())) if known.any() else 0.0
    largest = float(np.abs(e[known]).max()) if known.any() else 0.0
    E = _neighbours(TF, n)
    E = E[known[E[:, 0]] & known[E[:, 1]]]
    for _k in range(int(smooth)):
        s = e.copy()
        w = known.astype(float)
        np.add.at(s, E[:, 0], e[E[:, 1]])
        np.add.at(w, E[:, 0], 1.0)
        e = np.where(known, s / np.maximum(w, 1), 0.0)
    out = TV - gain * e[:, None] * N
    return out, {"rms": r3(rms), "largest": r3(largest), "unread": int(n - known.sum())}


def stop_rule(runs, tolerance, max_runs=3):
    """Whether to run the pre-warp again."""
    if not runs:
        return {"stop": False, "why": "no run yet"}
    last = runs[-1]
    if last["rms"] <= tolerance:
        return {"stop": True, "why": f"the print is within {tolerance:g} mm RMS of the target"}
    prev = runs[-2] if len(runs) > 1 else None
    if prev and last["rms"] > 0.8 * prev["rms"]:
        return {"stop": True, "why": f"run {last['n']} gained less than a fifth on run {prev['n']} ({prev['rms']:g} → {last['rms']:g} mm RMS): what is left is not a shape error a pre-warp undoes — look at the print itself"}
    if len(runs) >= max_runs:
        return {"stop": True, "why": f"{max_runs} runs made"}
    return {"stop": False, "why": f"{last['rms']:g} mm RMS — print the pre-warped model, scan it, and run again"}


def write_stl(path, V, F):
    V, F = np.asarray(V, np.float32), np.asarray(F, np.int64)
    tri = V[F]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    ln = np.linalg.norm(n, axis=1)
    ln[ln == 0] = 1
    rec = np.zeros(len(F), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"], rec["v"] = n / ln[:, None], tri
    with open(path, "wb") as f:
        f.write(b"ScanRuler for FreeCAD".ljust(80, b" "))
        f.write(struct.pack("<I", len(F)))
        f.write(rec.tobytes())
    return path
