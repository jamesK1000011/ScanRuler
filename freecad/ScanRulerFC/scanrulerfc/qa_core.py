# SPDX-License-Identifier: AGPL-3.0-only
# The scan checked before modelling: its open rims (the holes the scanner
# did not close), the way most of it faces, and its thickness through the
# part along an axis — two grids of rays, one from each side — with the
# main faces' trend, which tells a taper or a merge error from a part of
# one thickness. Ported from ScanRuler by CNC Kitchen:
# src/core/geometry/scanQa.ts (scanRims, dominantFacing, robustPlane,
# densifyEdgeFor) and src/commands/core/scan.ts (qa). The sheet reading
# (two skins close together) is not ported yet.

import math

import numpy as np

from .dev_field import nice_ceil
from .linalg import ortho_basis
from .mesh_core import boundary_loops
from .shapes import FitError, circle_from_points

RIM_CIRCLE_MIN = 8
RIM_ROUND = 0.08
SPARSE_SPACING = 1 / 150


def rims(V, F, keep=4, circles=12):
    """The open rims, longest first: count, total length, the `keep`
    longest, and up to `circles` more that a circle fits."""
    loops, _stray = boundary_loops(np.asarray(F, np.int64), len(V))
    out = []
    for verts, _opp in loops:
        P = V[list(verts)]
        length = float(np.linalg.norm(P - np.roll(P, -1, axis=0), axis=1).sum())
        out.append({"verts": list(verts), "at": P.mean(0).tolist(), "size": float(np.linalg.norm(P.max(0) - P.min(0))), "length": length})
    out.sort(key=lambda r: (-r["length"], r["verts"][0]))

    def circle(r):
        if len(r["verts"]) < RIM_CIRCLE_MIN:
            return None
        try:
            c = circle_from_points(V[r["verts"]])
        except FitError:
            return None
        if not c["sigma"] <= RIM_ROUND * c["radius"]:
            return None
        return {"center": c["center"], "axis": c["normal"], "radius": c["radius"], "rms": c["sigma"]}

    def placed(i):
        r = out[i]
        c = circle(r)
        return {"rim": i, "at": r["at"], "size": r["size"], "length": r["length"], **({"circle": c} if c else {})}

    largest = [placed(i) for i in range(min(keep, len(out)))]
    round_ = [x for x in (placed(i) for i in range(keep, len(out))) if "circle" in x]
    return {"count": len(out), "total": float(sum(r["length"] for r in out)), "largest": largest, "circles": round_[:circles], "moreCircles": max(0, len(round_) - circles)}


def dominant_facing(N):
    """The axis most of the normals lie along (a plate's face normal)."""
    N = np.asarray(N, float)
    if len(N) < 3:
        return None
    w, vec = np.linalg.eigh(N.T @ N)
    first = vec[:, 2]
    keep = np.abs(N @ first) >= math.cos(math.radians(20))
    if keep.sum() >= 3:
        w, vec = np.linalg.eigh(N[keep].T @ N[keep])
        return vec[:, 2]
    return first


def robust_plane(us, vs, zs):
    us, vs, zs = (np.asarray(x, float) for x in (us, vs, zs))
    keep = np.arange(len(zs))
    fit = None
    for _ in range(4):
        if len(keep) < 6:
            return None
        u, v, z = us[keep], vs[keep], zs[keep]
        mu, mv, mz = u.mean(), v.mean(), z.mean()
        du, dv, dz = u - mu, v - mv, z - mz
        suu, suv, svv, suz, svz = (du * du).sum(), (du * dv).sum(), (dv * dv).sum(), (du * dz).sum(), (dv * dz).sum()
        det = suu * svv - suv * suv
        if not abs(det) > 1e-12:
            return None
        b = (suz * svv - svz * suv) / det
        c = (svz * suu - suz * suv) / det
        fit = (mz - b * mu - c * mv, b, c)
        res = z - (fit[0] + b * u + c * v)
        sigma = max(1.4826 * float(np.sort(np.abs(res))[len(res) >> 1]), 1e-6)
        nxt = keep[np.abs(res) <= 2.5 * sigma]
        if len(nxt) == len(keep):
            break
        keep = nxt
    a, b, c = fit
    res = zs[keep] - (a + b * us[keep] + c * vs[keep])
    return {"a": float(a), "b": float(b), "c": float(c), "used": int(len(keep)), "rms": float(math.sqrt((res ** 2).mean()))}


def densify_edge_for(diagonal):
    raw = max(diagonal / 100, 0.05)
    p = 10 ** math.floor(math.log10(raw))
    m = raw / p
    return (1 if m < 1.5 else 2 if m < 3.5 else 5 if m < 7.5 else 10) * p


def thickness_grid(surface, P, d, side=60):
    """Rays square to the axis d, a grid over the part's box across it, from
    each side: per cell through the part, (u, v, thickness, top, bottom)."""
    d = np.asarray(d, float)
    u, v = (np.asarray(x) for x in ortho_basis(d))
    S = np.column_stack([P @ u, P @ v, P @ d])
    lo, hi = S.min(0), S.max(0)
    cell = nice_ceil(max(hi[0] - lo[0], hi[1] - lo[1], 1e-6) / side)
    cols = max(1, math.ceil((hi[0] - lo[0]) / cell))
    rows = max(1, math.ceil((hi[1] - lo[1]) / cell))
    u0 = (lo[0] + hi[0]) / 2 - cols * cell / 2
    v0 = (lo[1] + hi[1]) / 2 - rows * cell / 2
    pad = 0.01 * (hi[2] - lo[2]) + 0.1
    far = hi[2] - lo[2] + 2 * pad
    C, R = np.meshgrid(np.arange(cols), np.arange(rows))
    cu, cv = u0 + (C.ravel() + 0.5) * cell, v0 + (R.ravel() + 0.5) * cell
    base = np.outer(cu, u) + np.outer(cv, v)
    top_o = base + (hi[2] + pad) * d
    bot_o = base + (lo[2] - pad) * d
    tt, _f1 = surface.raycast_first(top_o, np.tile(-d, (len(base), 1)), 0.0, far)
    tb, _f2 = surface.raycast_first(bot_o, np.tile(d, (len(base), 1)), 0.0, far)
    t_top = hi[2] + pad - tt
    t_bot = lo[2] - pad + tb
    t = t_top - t_bot
    ok = np.isfinite(t) & (t > 0)
    return cu[ok], cv[ok], t[ok], t_top[ok], t_bot[ok], u, v


# ---- sheet: two skins close together (src/core/geometry/sheet.ts) --------------

SHEET_SHARE = 0.5
WALL_SHARE, WALLS_COVER, WALL_DEG, WALL_SAMPLE, WALL_TRIES, WALLS_MAX = 0.02, 0.6, 10, 3000, 150, 24
APART_MAX, APART_LEAST = 6, 6
ATTEMPTS = 6
FACING = math.cos(math.pi / 6)
SHEET_SAMPLE, APART_SAMPLE, SHEET_EVEN, SHEET_GAUGE = 6000, 30_000, 1.5, 3


def _face_normals(V, F):
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    ln = np.linalg.norm(n, axis=1)
    ln[ln == 0] = 1
    return n / ln[:, None]


def sheet_reading(g, surface, noise, sample=SHEET_SAMPLE, apart_sample=APART_SAMPLE):
    """Each sampled point looks along its inward normal for the other skin
    facing back; the gauge is how far it found it."""
    P, N, F = g.P, g.N, g.F
    areas = g.vertex_areas()
    reach = min(6.0, max(1.0, 0.05 * g.bbox_diag))
    near = max(1e-6, g.bbox_diag * 1e-5)
    idx = np.arange(0, len(P), max(1, len(P) // sample))
    nl = np.linalg.norm(N[idx], axis=1)
    idx = idx[nl > 0]
    O = P[idx]
    D = -N[idx] / np.linalg.norm(N[idx], axis=1)[:, None]
    FN = _face_normals(P, F)
    gauge = np.full(len(idx), np.nan)
    start = np.full(len(idx), near)
    live = np.arange(len(idx))
    for _ in range(ATTEMPTS):
        if not len(live):
            break
        t, face = surface.raycast_first(O[live], D[live], start[live], reach)
        hit = np.isfinite(t) & (face >= 0)
        back = np.zeros(len(live), bool)
        back[hit] = (FN[face[hit]] * D[live[hit]]).sum(1) >= FACING
        gauge[live[back]] = t[back]
        again = hit & ~back
        start[live[again]] = t[again] + near
        live = live[again]
    all_area = float(areas[idx].sum())
    found = np.isfinite(gauge)
    two = float(areas[idx][found].sum()) / all_area if all_area > 0 else 0.0
    gs = np.sort(gauge[found])

    def pct(q):
        return float(gs[min(len(gs) - 1, int(q * len(gs)))])

    out = {"sampled": int(len(idx)), "reach": reach, "twoSkins": two, "gauge": {"p5": pct(0.05), "p50": pct(0.5), "p95": pct(0.95)} if len(gs) >= 12 else None}
    if two < SHEET_SHARE or not out["gauge"]:
        return out
    apart = _apart(g, areas, apart_sample, max(1.5, 5 * out["gauge"]["p50"], 0.01 * g.bbox_diag), max(0.05, 3 * noise))
    if apart:
        out["apart"] = apart
    return out


def _walls(P, N, W, tol):
    n = len(W)
    free = np.ones(n, bool)
    total = W.sum()
    cos = math.cos(math.radians(WALL_DEG))
    walls, covered = [], 0.0

    def on(sel, nn, d):
        return (np.abs(N[sel] @ nn) >= cos) & (np.abs(P[sel] @ nn - d) <= tol)

    while len(walls) < WALLS_MAX:
        left = np.nonzero(free)[0]
        if len(left) < 3:
            break
        best, best_plane = 0.0, None
        for c in left[:: max(1, len(left) // WALL_TRIES)]:
            nn = N[c]
            d = float(P[c] @ nn)
            s = float(W[left][on(left, nn, d)].sum())
            if s > best:
                best, best_plane = s, (nn, d)
        if best_plane is None or best < WALL_SHARE * total:
            break
        held = left[on(left, *best_plane)]
        nn, d = best_plane
        if len(held) >= 3:
            X = P[held] - P[held].mean(0)
            w, vec = np.linalg.eigh(X.T @ X)
            nn = vec[:, 0]
            d = float(P[held].mean(0) @ nn)
        m = left[on(left, nn, d)]
        share = float(W[m].sum())
        if share < WALL_SHARE * total:
            break
        free[m] = False
        u, v = (np.asarray(x) for x in ortho_basis(nn))
        a, b = P[m] @ u, P[m] @ v
        walls.append({"normal": nn, "d": d, "u": u, "v": v, "lo": (a.min(), b.min()), "hi": (a.max(), b.max())})
        covered += share / total
    return walls, covered


def _apart(g, areas, sample, reach, tol):
    step = max(1, len(g.P) // sample)
    P = g.P[::step]
    N = g.N[::step] / np.maximum(np.linalg.norm(g.N[::step], axis=1), 1e-12)[:, None]
    W = areas[::step]
    every = max(1, len(P) // WALL_SAMPLE)
    walls, covered = _walls(P[::every], N[::every], W[::every], tol)
    if covered < WALLS_COVER:
        return None
    total = float(areas.sum())
    weight = total / W.sum()
    kept = np.zeros(len(P), bool)
    for w in walls:
        a, b = P @ w["u"], P @ w["v"]
        kept |= (np.abs(P @ w["normal"] - w["d"]) <= reach) & (a >= w["lo"][0] - reach) & (a <= w["hi"][0] + reach) & (b >= w["lo"][1] - reach) & (b <= w["hi"][1] + reach)
    off = np.nonzero(~kept)[0]
    link = 3 * math.sqrt(total / len(P))
    from .dev_hotspots import components, neighbour_pairs

    regions = []
    if len(off):
        Q = P[off]
        q, p = neighbour_pairs(Q, Q, link)
        ok = (q < p) & (((Q[q] - Q[p]) ** 2).sum(1) <= link * link)
        lab = components(len(off), q[ok], p[ok])
        least = 2 * reach * reach
        for c in np.unique(lab):
            m = off[lab == c]
            if len(m) < APART_LEAST:
                continue
            w_ = W[m] * weight
            area = float(w_.sum())
            if not area >= least:
                continue
            regions.append({"center": (P[m] * w_[:, None]).sum(0) / area, "min": P[m].min(0), "max": P[m].max(0), "area": area})
    regions.sort(key=lambda r: -r["area"])
    return {"reach": reach, "walls": len(walls), "regions": regions[:APART_MAX], "more": max(0, len(regions) - APART_MAX)}
