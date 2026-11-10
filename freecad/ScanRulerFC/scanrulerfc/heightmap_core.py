# SPDX-License-Identifier: AGPL-3.0-only
# Where the scan is first met looking along an axis, over a grid of cells:
# pocket floors, ledges, a step's height, a face's tilt, a pad's tiers. The
# heights gathered into levels — the sloped cells (a fillet's ramp) left out
# first, a level a run of well-filled bins, each with the plane fitted to
# its cells. Ported from ScanRuler by CNC Kitchen: src/core/geometry/
# rayGrid.ts (gridOver), heightGrid.ts (cellNoise, slopedCells,
# heightLevels) and src/commands/core/scan.ts (heightmap). The warp taken
# out before levels, relief and the deviation map are not ported yet.

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
