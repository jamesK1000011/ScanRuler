# SPDX-License-Identifier: AGPL-3.0-only
# Where the scan is first met looking along an axis, over a grid of cells:
# pocket floors, ledges, a step's height, a face's tilt, a pad's tiers. The
# heights gathered into levels — the sloped cells (a fillet's ramp) left out
# first, a level a run of well-filled bins, each with the plane fitted to
# its cells. Ported from ScanRuler by CNC Kitchen: src/core/geometry/
# rayGrid.ts (gridOver), heightGrid.ts (cellNoise, slopedCells,
# heightLevels, reliefGrid, levelsThroughWarp, rampsOf) and
# src/commands/core/scan.ts (heightmap: rayGrid, sparseWords).

import math

import numpy as np

from .dev_field import nice_ceil

LEVEL_GAP_MIN = 0.02
LEVEL_SLOPE_DEG = 10
ACROSS = {0: (1, 2), 1: (0, 2), 2: (0, 1)}


def grid_over(lo, hi, k, cell, side, most):
    ua, va = ACROSS[k]
    du, dv = max(hi[ua] - lo[ua], 1e-6), max(hi[va] - lo[va], 1e-6)
    c = cell or nice_ceil(max(du, dv) / side)
    widened = False
    while math.ceil(du / c) * math.ceil(dv / c) > most:
        c = nice_ceil(c * 1.01)
        widened = True
    cols, rows = max(1, math.ceil(du / c)), max(1, math.ceil(dv / c))
    return {"ua": ua, "va": va, "cell": c, "cols": cols, "rows": rows, "u0": (lo[ua] + hi[ua]) / 2 - cols * c / 2, "v0": (lo[va] + hi[va]) / 2 - rows * c / 2, "widened": widened}


def cast(surface, start, d, du, dv, g, far):
    """Each cell's ray from start + (c + ½)·cell·du + (r + ½)·cell·dv along
    d: its distance to the first hit (NaN where none), the face hit and the
    hit point."""
    C, R = np.meshgrid(np.arange(g["cols"]), np.arange(g["rows"]))
    n = C.size
    O = np.asarray(start, float)[None, :] + ((C.ravel() + 0.5) * g["cell"])[:, None] * np.asarray(du, float)[None, :] + ((R.ravel() + 0.5) * g["cell"])[:, None] * np.asarray(dv, float)[None, :]
    D = np.repeat(np.asarray(d, float)[None, :], n, 0)
    t, f = surface.raycast_first(O, D, 0.0, far)
    t = np.asarray(t, float).copy()
    t[~np.isfinite(t)] = np.nan
    return t, np.asarray(f), O + np.nan_to_num(t)[:, None] * D


def corner_weights(V, F, faces, hits):
    """The barycentric weights of each hit on its triangle, and its corners."""
    ok = (faces >= 0)
    W = np.zeros((len(faces), 3))
    corners = np.zeros((len(faces), 3), np.int64)
    if not ok.any():
        return W, corners
    tri = F[faces[ok]]
    corners[ok] = tri
    a, b, c = V[tri[:, 0]], V[tri[:, 1]], V[tri[:, 2]]
    p = hits[ok]
    v0, v1, v2 = b - a, c - a, p - a
    d00, d01, d11 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1)
    d20, d21 = (v2 * v0).sum(1), (v2 * v1).sum(1)
    den = d00 * d11 - d01 * d01
    den = np.where(np.abs(den) < 1e-30, 1e-30, den)
    w1 = (d11 * d20 - d01 * d21) / den
    w2 = (d00 * d21 - d01 * d20) / den
    W[ok] = np.clip(np.stack([1 - w1 - w2, w1, w2], 1), 0, 1)
    return W, corners


def deviation_at(t, W, corners, readings, search):
    """The map's reading where each ray lands: its triangle's corners weighed
    as the hit lies between them, a corner with no reading within the
    search distance left out."""
    r = np.asarray(readings, float)[corners]
    good = np.isfinite(r) & (np.abs(r) <= search) & np.isfinite(t)[:, None]
    w = np.where(good, W, 0.0)
    s = (w * np.where(good, r, 0.0)).sum(1)
    tot = w.sum(1)
    out = np.full(len(t), np.nan)
    m = tot > 1e-6
    out[m] = s[m] / tot[m]
    return out


def heights(surface, lo, hi, k, sign, g):
    """Heights along axis k where each cell's ray, looking the way `sign`
    says (−1 down from above), first meets the scan; NaN where none."""
    ua, va = g["ua"], g["va"]
    C, R = np.meshgrid(np.arange(g["cols"]), np.arange(g["rows"]))
    n = C.size
    O = np.zeros((n, 3))
    O[:, ua] = g["u0"] + (C.ravel() + 0.5) * g["cell"]
    O[:, va] = g["v0"] + (R.ravel() + 0.5) * g["cell"]
    start = hi[k] + 1e-3 if sign < 0 else lo[k] - 1e-3
    O[:, k] = start
    D = np.zeros((n, 3))
    D[:, k] = sign
    t, _f = surface.raycast_first(O, D, 0.0, hi[k] - lo[k] + 2e-3)
    h = start + sign * t
    h[~np.isfinite(t)] = np.nan
    return h


def cell_noise(v, cols, rows):
    G = v.reshape(rows, cols)
    steps = np.concatenate([np.abs(np.diff(G, axis=1)).ravel(), np.abs(np.diff(G, axis=0)).ravel()])
    steps = steps[np.isfinite(steps)]
    return float(1.4826 * np.sort(steps)[len(steps) // 2] / math.sqrt(2)) if len(steps) else 0.0


def sloped_cells(v, cols, rows, cell, max_deg):
    G = v.reshape(rows, cols)
    limit = math.tan(math.radians(max_deg)) * cell

    def gentler(a, b):
        da = np.where(np.isnan(a), np.inf, np.abs(a - G))
        db = np.where(np.isnan(b), np.inf, np.abs(b - G))
        d = np.minimum(da, db)
        return np.where(np.isinf(d), 0, d)

    pad = np.full((rows, 1), np.nan)
    left, right = np.hstack([pad, G[:, :-1]]), np.hstack([G[:, 1:], pad])
    padr = np.full((1, cols), np.nan)
    down, up = np.vstack([padr, G[:-1]]), np.vstack([G[1:], padr])
    out = (np.hypot(gentler(left, right), gentler(down, up)) > limit) & ~np.isnan(G)
    return out.ravel()


def _plane_over(hs, cells, g):
    cols, cell, u0, v0 = g["cols"], g["cell"], g["u0"], g["v0"]
    c = cells % cols
    r = cells // cols
    u, v, h = u0 + (c + 0.5) * cell, v0 + (r + 0.5) * cell, hs[cells]
    ok = np.isfinite(h)
    u, v, h = u[ok], v[ok], h[ok]
    if not len(h):
        return {"at": [u0, v0, 0.0], "slope": [0.0, 0.0]}
    mu, mv, mh = u.mean(), v.mean(), h.mean()
    du, dv, dh = u - mu, v - mv, h - mh
    uu, uv, vv, uh, vh = (du * du).sum(), (du * dv).sum(), (dv * dv).sum(), (du * dh).sum(), (dv * dh).sum()
    det = uu * vv - uv * uv
    if det > 1e-9 * uu * vv:
        return {"at": [mu, mv, mh], "slope": [(uh * vv - vh * uv) / det, (vh * uu - uh * uv) / det]}
    return {"at": [mu, mv, mh], "slope": [uh / uu if uu > 0 else 0.0, 0.0] if uu >= vv else [0.0, vh / vv]}


def levels(values, g, gap, raw=None):
    raw = values if raw is None else raw
    fin = np.isfinite(values)
    count = int(fin.sum())
    if not count:
        return {"levels": [], "gap": gap, "unassigned": 0}
    lo, hi = float(values[fin].min()), float(values[fin].max())
    w = max(gap, 1e-6)
    while (hi - lo) / w > 4 * count + 100:
        w *= 2
    bins = int((hi - lo) // w) + 1
    b_of = np.minimum(bins - 1, ((values[fin] - lo) // w).astype(np.int64))
    counts = np.bincount(b_of, minlength=bins)
    dense = max(3, math.ceil(count / 200))
    runs = []
    for b in range(bins):
        if counts[b] < dense:
            continue
        if runs and runs[-1][1] == b - 1:
            runs[-1][1] = b
        else:
            runs.append([b, b])
    core = np.full(bins, -1)
    for k, (a, b) in enumerate(runs):
        core[a:b + 1] = k
    run_of = core.copy()
    for b in range(bins):
        if core[b] >= 0:
            continue
        below = core[b - 1] if b > 0 else -1
        above = core[b + 1] if b + 1 < bins else -1
        run_of[b] = (below if counts[b - 1] >= counts[b + 1] else above) if below >= 0 and above >= 0 else (below if below >= 0 else above)
    idx = np.nonzero(fin)[0]
    lab = run_of[b_of]
    out = []
    for k in range(len(runs)):
        m = idx[lab == k]
        if not len(m):
            continue
        vs = np.sort(values[m])
        c, r = m % g["cols"], m // g["cols"]
        out.append({"height": float(vs[len(vs) // 2]), "sigma": float(vs.std()), "range": [float(vs[0]), float(vs[-1])], "cells": int(len(m)),
                    "area": len(m) * g["cell"] ** 2, "share": len(m) / count,
                    "box": {"min": [g["u0"] + c.min() * g["cell"], g["v0"] + r.min() * g["cell"]], "max": [g["u0"] + (c.max() + 1) * g["cell"], g["v0"] + (r.max() + 1) * g["cell"]]},
                    "plane": _plane_over(raw, m, g)})
    out.sort(key=lambda x: -x["cells"])
    return {"levels": out, "gap": w, "unassigned": int((lab < 0).sum())}


# ---- relief ----


def _convolve(values, cols, rows, ku, kv):
    G = values.reshape(rows, cols)
    reach = (len(ku) - 1) // 2
    P = np.pad(G, ((0, 0), (reach, reach)))
    along = sum(ku[i] * P[:, i:i + cols] for i in range(len(ku)))
    P = np.pad(along, ((reach, reach), (0, 0)))
    return sum(kv[j] * P[j:j + rows, :] for j in range(len(kv))).ravel()


def relief_grid(values, cols, rows, sigma):
    """The height less the surface round it: at each cell a plane fitted to
    its neighbours by least squares, each weighed by a Gaussian of `sigma`
    cells, the empty ones left out — what stands proud (positive) or sinks
    (negative) at about that width stands out, a lean leaves nothing. Where
    the neighbours give no plane their mean stands in."""
    reach = max(1, math.ceil(3 * sigma))
    i = np.arange(-reach, reach + 1, dtype=float)
    k0 = np.exp(-(i * i) / (2 * sigma * sigma))
    k1, k2 = i * k0, i * i * k0
    v = np.asarray(values, float)
    mask = np.isfinite(v).astype(float)
    h = np.where(mask > 0, v, 0.0)
    cv = lambda x, a, b: _convolve(x, cols, rows, a, b)
    A, B, C = cv(mask, k0, k0), cv(mask, k1, k0), cv(mask, k0, k1)
    D, E, F = cv(mask, k2, k0), cv(mask, k1, k1), cv(mask, k0, k2)
    h00, h10, h01 = cv(h, k0, k0), cv(h, k1, k0), cv(h, k0, k1)
    det = A * (D * F - E * E) - B * (B * F - E * C) + C * (B * E - D * C)
    scale = A * D * F
    with np.errstate(divide="ignore", invalid="ignore"):
        plane = (h00 * (D * F - E * E) - B * (h10 * F - E * h01) + C * (h10 * E - D * h01)) / det
        mean = h00 / A
    a = np.where((scale > 0) & (np.abs(det) > 1e-9 * scale), plane, mean)
    out = np.full(len(v), np.nan)
    m = mask > 0
    out[m] = v[m] - a[m]
    return out


# ---- a warp taken out before the levels ----

WARP_MAX_DEG = 5
WARP_LEVEL_SHARE = 0.05
WARP_LEAST_CELLS = 30


def _terms(cells, cols, rows):
    c = cells % cols
    r = cells // cols
    x = (c + 0.5 - cols / 2) / (cols / 2)
    y = (r + 0.5 - rows / 2) / (rows / 2)
    return np.stack([np.ones_like(x, dtype=float), x, y, x * x, x * y, y * y], 1)


def _poly_fit(hs, cells, cols, rows, terms):
    if len(cells) < 2 * terms:
        return None
    T = _terms(cells, cols, rows)[:, :terms]
    try:
        k, *_ = np.linalg.lstsq(T, hs[cells], rcond=None)
    except np.linalg.LinAlgError:
        return None
    return k if np.all(np.isfinite(k)) else None


def levels_through_warp(counted, values, g, gap):
    """levels gathered as the values are, and again with a smooth quadratic
    surface taken out — fitted to the largest level's cells, the cells off
    it by more than 2.5 times their spread (or gap) dropped till it
    settles. The second reading is kept when it holds more levels of a
    twentieth of the map or more; a surface leaning past WARP_MAX_DEG, or
    rising less than gap, changes nothing. A kept warp comes back as
    {rise, bow, base, flat}."""
    plain = levels(counted, g, gap, values)
    if not plain["levels"]:
        return plain
    top = plain["levels"][0]
    cols, rows, cell = g["cols"], g["rows"], g["cell"]
    fin = np.isfinite(counted)
    valued = np.nonzero(fin)[0]
    start = valued[(counted[valued] >= top["range"][0]) & (counted[valued] <= top["range"][1])]
    if len(start) < WARP_LEAST_CELLS:
        return plain
    Ts = _terms(start, cols, rows)
    use = start
    k = _poly_fit(counted, use, cols, rows, 6)
    for _ in range(10):
        if k is None:
            break
        res = counted[start] - Ts @ k
        mid = float(np.median(res))
        spread = 1.4826 * float(np.median(np.abs(res - mid)))
        nxt = start[np.abs(res - mid) <= max(2.5 * spread, gap)]
        if len(nxt) < WARP_LEAST_CELLS or len(nxt) == len(use):
            break
        use = nxt
        k = _poly_fit(counted, use, cols, rows, 6)
    if k is None:
        return plain
    all_cells = np.arange(len(counted))
    T = _terms(all_cells, cols, rows)
    surface = T @ k
    sv = surface[valued]
    lo, hi = float(sv.min()), float(sv.max())
    tv = T[valued]
    gu = (k[1] + 2 * k[3] * tv[:, 1] + k[4] * tv[:, 2]) * (2 / (cols * cell))
    gv = (k[2] + k[4] * tv[:, 1] + 2 * k[5] * tv[:, 2]) * (2 / (rows * cell))
    steepest = float(np.hypot(gu, gv).max())
    if hi - lo < gap or steepest > math.tan(math.radians(WARP_MAX_DEG)):
        return plain
    base = float(np.sort(sv)[len(sv) // 2])
    flatten = lambda v: np.where(np.isfinite(v), v - surface + base, np.nan)
    warped = levels(flatten(counted), g, gap, counted)
    substantial = lambda r: sum(1 for l in r["levels"] if l["share"] >= WARP_LEVEL_SHARE)
    if substantial(warped) <= substantial(plain):
        return plain
    p = _poly_fit(surface, valued, cols, rows, 3)
    bow = hi - lo
    if p is not None:
        r = sv - tv[:, :3] @ p
        bow = float(r.max() - r.min())
    warped["warp"] = {"rise": hi - lo, "bow": bow, "base": base, "flat": flatten(values)}
    return warped


# ---- ramps ----

RAMP_SHARE = 0.2
RAMPS_NAMED = 3


def ramps_of(values, steep, g, lvls):
    """The runs of sloped cells side by side, the smallest left out (under
    a two-hundredth of the cells with a value, eight at least), largest
    first, each with the heights of the lowest and highest level it
    borders."""
    cols, rows, cell, u0, v0 = g["cols"], g["rows"], g["cell"], g["u0"], g["v0"]
    fin = np.isfinite(values)
    valued = int(fin.sum())
    sloped = int((steep & fin).sum())

    def level_at(i):
        v = values[i]
        if not np.isfinite(v) or steep[i]:
            return -1
        for j, l in enumerate(lvls):
            if l["range"][0] <= v <= l["range"][1]:
                return j
        return -1

    least = max(8, math.ceil(valued / 200))
    seen = np.zeros(len(values), bool)
    ramps = []
    for s0 in np.nonzero(steep & fin)[0]:
        if seen[s0]:
            continue
        stack = [int(s0)]
        seen[s0] = True
        n, c0, c1, r0, r1 = 0, cols, -1, rows, -1
        borders = set()
        while stack:
            i = stack.pop()
            n += 1
            c, r = i % cols, i // cols
            c0, c1, r0, r1 = min(c0, c), max(c1, c), min(r0, r), max(r1, r)
            for dc, dr in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                cc, rr = c + dc, r + dr
                if not (0 <= cc < cols and 0 <= rr < rows):
                    continue
                j = rr * cols + cc
                if steep[j] and fin[j]:
                    if not seen[j]:
                        seen[j] = True
                        stack.append(j)
                else:
                    l = level_at(j)
                    if l >= 0:
                        borders.add(l)
        if n < least:
            continue
        hs = [lvls[l]["height"] for l in borders]
        ramps.append({"cells": n, "box": {"min": [u0 + c0 * cell, v0 + r0 * cell], "max": [u0 + (c1 + 1) * cell, v0 + (r1 + 1) * cell]},
                      "joins": sorted(set([min(hs), max(hs)])) if hs else []})
    ramps.sort(key=lambda x: -x["cells"])
    return {"sloped": sloped, "valued": valued, "ramps": ramps}


# ---- where the scan lies, when few cells met it ----

SPARSE_SHARE = 0.2


def sparse_words(hit, g, scan_lo, scan_hi, on_plane, along):
    r = lambda x: round(float(x), 2)
    cells = g["cols"] * g["rows"]
    if cells == 0 or hit / cells >= SPARSE_SHARE:
        return None
    pct = round(100 * hit / cells, 1)
    u1, v1 = g["u0"] + g["cols"] * g["cell"], g["v0"] + g["rows"] * g["cell"]
    third = f"height {r(scan_lo[2])}…{r(scan_hi[2])}" if on_plane else f"{along} {r(scan_lo[2])}…{r(scan_hi[2])}"
    tail = " A box in world coordinates goes as box: { world: { min, max } }." if on_plane else ""
    return {"hitPct": pct, "min": [r(x) for x in scan_lo], "max": [r(x) for x in scan_hi],
            "note": f"Only {pct} % of the cells met the scan. In this map's frame the scan lies at u {r(scan_lo[0])}…{r(scan_hi[0])}, v {r(scan_lo[1])}…{r(scan_hi[1])}, {third}; the grid spans u {r(g['u0'])}…{r(u1)}, v {r(g['v0'])}…{r(v1)}.{tail}"}


# ---- which cells the scan covers, without a ray each ----


def covered(V, F, R_, chunk=2_000_000):
    """Which cells' rays would meet the scan within the grid's height
    range: each triangle laid flat on the grid and the cell centres inside
    it marked, the height there checked against the range. Many times
    quicker than casting the rays when only hit-or-miss is wanted."""
    g = R_["g"]
    cols, rows, cell = g["cols"], g["rows"], g["cell"]
    start, du, dv, ray = (np.asarray(R_[k], float) for k in ("start", "du", "dv", "ray"))
    rel = np.asarray(V, float) - start
    u = (rel @ du) / cell - 0.5
    v = (rel @ dv) / cell - 0.5
    d = rel @ ray
    T = np.asarray(F, np.int64)
    tu, tv, td = u[T], v[T], d[T]
    far = R_["far"]
    keep = (td.max(1) >= -1e-6) & (td.min(1) <= far + 1e-6)
    c0 = np.maximum(np.ceil(tu.min(1)), 0).astype(np.int64)
    c1 = np.minimum(np.floor(tu.max(1)), cols - 1).astype(np.int64)
    r0 = np.maximum(np.ceil(tv.min(1)), 0).astype(np.int64)
    r1 = np.minimum(np.floor(tv.max(1)), rows - 1).astype(np.int64)
    keep &= (c1 >= c0) & (r1 >= r0)
    idx = np.nonzero(keep)[0]
    mask = np.zeros(cols * rows, bool)
    nc, nr = (c1 - c0 + 1)[idx], (r1 - r0 + 1)[idx]
    counts = nc * nr
    bounds = np.concatenate([[0], np.cumsum(counts)])
    lo = 0
    while lo < len(idx):
        hi = int(np.searchsorted(bounds, bounds[lo] + chunk, side="right")) - 1
        hi = max(hi, lo + 1)
        sel = idx[lo:hi]
        cnt = counts[lo:hi]
        tri = np.repeat(sel, cnt)
        off = np.arange(cnt.sum()) - np.repeat(bounds[lo:hi] - bounds[lo], cnt)
        w = np.repeat(nc[lo:hi], cnt)
        cc = c0[tri] + off % w
        rr = r0[tri] + off // w
        a_u, a_v = tu[tri, 0], tv[tri, 0]
        e1u, e1v = tu[tri, 1] - a_u, tv[tri, 1] - a_v
        e2u, e2v = tu[tri, 2] - a_u, tv[tri, 2] - a_v
        den = e1u * e2v - e1v * e2u
        pu, pv = cc - a_u, rr - a_v
        with np.errstate(divide="ignore", invalid="ignore"):
            s = (pu * e2v - pv * e2u) / den
            t = (e1u * pv - e1v * pu) / den
        eps = 1e-9
        ok = (np.abs(den) > 1e-12) & (s >= -eps) & (t >= -eps) & (s + t <= 1 + eps)
        h = td[tri, 0] + s * (td[tri, 1] - td[tri, 0]) + t * (td[tri, 2] - td[tri, 0])
        ok &= (h >= -1e-6) & (h <= far + 1e-6)
        mask[(rr * cols + cc)[ok]] = True
        lo = hi
    return mask
