# SPDX-License-Identifier: AGPL-3.0-only
# The shadow of the scan on a plane, as ScanRuler's core/section/shadow.ts
# has it: the whole part seen along the plane's normal, kept as its outer
# boundary — the outline a straight-walled bin or a foam cutout needs, every
# indentation filled, where a cut is only what one plane passes through.
#
# The scan's triangles are projected onto the plane and rasterised into a
# mask (a cell is set when its centre lies inside a projected triangle; a
# triangle seen edge-on sets nothing). Holes inside the shadow are filled,
# and the boundary between set and unset cells is traced into closed loops
# (counter-clockwise, outside to the right). A traced loop lies within a
# cell's diagonal of the true silhouette; fam_sections offsets it outwards by
# the play and the tolerance with FreeCAD's exact 2D offset, so what is kept
# is never inside the part. Plain numpy, no FreeCAD.

import math

import numpy as np

# The finest cell and the most cells a side the mask is cut into.
MIN_CELL = 0.02
MAX_SIDE = 4000


def frame_uv(V, frame):
    d = np.asarray(V, dtype=float) - np.asarray(frame["origin"], dtype=float)
    return np.stack([d @ np.asarray(frame["basisU"], dtype=float), d @ np.asarray(frame["basisV"], dtype=float)], axis=1)


def cell_for(uv, tolerance):
    """Half the tolerance, opened so the mask keeps under MAX_SIDE a side."""
    span = float(np.ptp(uv, axis=0).max()) if len(uv) else 1.0
    return max(MIN_CELL, float(tolerance) / 2.0, span / (MAX_SIDE - 4))


def rasterise(uv, F, cell, batch=20000, small=24):
    """(mask, u0, v0): cells whose centres lie inside a projected triangle,
    with a cell of margin all round. Triangles a few cells across go in
    batches, each against the block of cells round it; larger ones alone."""
    uv = np.asarray(uv, dtype=float)
    F = np.asarray(F, dtype=np.int64)
    lo = uv.min(0) - 2 * cell
    hi = uv.max(0) + 2 * cell
    nu = int(math.ceil((hi[0] - lo[0]) / cell)) + 1
    nv = int(math.ceil((hi[1] - lo[1]) / cell)) + 1
    mask = np.zeros((nv, nu), dtype=bool)
    T = uv[F]  # (n, 3, 2)
    # Cell index of each corner, as a float: centres sit at k + 0.5.
    G = (T - lo) / cell - 0.5
    gmin = np.floor(G.min(1)).astype(np.int64)
    gmax = np.ceil(G.max(1)).astype(np.int64)
    ext = (gmax - gmin).max(1) + 1
    area2 = (G[:, 1, 0] - G[:, 0, 0]) * (G[:, 2, 1] - G[:, 0, 1]) - (G[:, 2, 0] - G[:, 0, 0]) * (G[:, 1, 1] - G[:, 0, 1])
    live = np.abs(area2) > 1e-12  # edge-on: no shadow
    # Each batch against a block just as large as its triangles need.
    lo_k = 0
    for k in (2, 4, 6, 8, 12, 16, small):
        idx = np.nonzero(live & (ext > lo_k) & (ext <= k))[0]
        step = max(1, int(batch * (small / k) ** 2 / 4))
        for i in range(0, len(idx), step):
            b = idx[i:i + step]
            _fill(mask, G[b], gmin[b], k)
        lo_k = k
    for t in np.nonzero(live & (ext > small))[0]:
        _fill(mask, G[t:t + 1], gmin[t:t + 1], int(ext[t]))
    return mask, float(lo[0]), float(lo[1])


def _fill(mask, G, gmin, k):
    """Set the cells in a k x k block from each triangle's corner cell whose
    centres it covers (either winding)."""
    nv, nu = mask.shape
    off = np.arange(k)
    ii, jj = np.meshgrid(off, off, indexing="xy")  # ii along u, jj along v
    cu = gmin[:, 0, None, None] + ii[None]
    cv = gmin[:, 1, None, None] + jj[None]
    x, y = cu.astype(float), cv.astype(float)
    a, b, c = G[:, 0], G[:, 1], G[:, 2]

    def side(p, q):
        return (q[:, 0, None, None] - p[:, 0, None, None]) * (y - p[:, 1, None, None]) - (q[:, 1, None, None] - p[:, 1, None, None]) * (x - p[:, 0, None, None])

    s1, s2, s3 = side(a, b), side(b, c), side(c, a)
    e = 1e-9
    inside = ((s1 >= -e) & (s2 >= -e) & (s3 >= -e)) | ((s1 <= e) & (s2 <= e) & (s3 <= e))
    inside &= (cu >= 0) & (cu < nu) & (cv >= 0) & (cv < nv)
    mask[cv[inside], cu[inside]] = True


def fill_holes(mask):
    """Every unset cell not reached from the border set: the shadow's
    holes filled, only its outer boundary left."""
    outside = np.zeros_like(mask)
    outside[0, :] = ~mask[0, :]
    outside[-1, :] |= ~mask[-1, :]
    outside[:, 0] |= ~mask[:, 0]
    outside[:, -1] |= ~mask[:, -1]
    free = ~mask
    while True:
        grown = outside.copy()
        grown[1:, :] |= outside[:-1, :]
        grown[:-1, :] |= outside[1:, :]
        grown[:, 1:] |= outside[:, :-1]
        grown[:, :-1] |= outside[:, 1:]
        grown &= free
        if np.array_equal(grown, outside):
            return ~outside
        outside = grown


def trace(mask, u0, v0, cell):
    """The boundary between set and unset cells as closed loops of [u, v]
    mm, each counter-clockwise round set cells (the shadow on its left),
    corners on the cell edges, collinear runs merged."""
    m = np.pad(mask, 1)
    nv, nu = m.shape
    # Directed edges with the set cell on the left, on the lattice of cell
    # corners (corner (i, j) is at u0 + (i - 1) * cell, v0 + (j - 1) * cell).
    nxt = {}
    sv, su = np.nonzero(m[1:-1, 1:-1])
    for j, i in zip(sv + 1, su + 1):
        if not m[j - 1, i]:   # below unset: edge along +u at the bottom
            nxt.setdefault((i, j), []).append((i + 1, j))
        if not m[j, i + 1]:   # right unset: up the right side
            nxt.setdefault((i + 1, j), []).append((i + 1, j + 1))
        if not m[j + 1, i]:   # above unset: along -u at the top
            nxt.setdefault((i + 1, j + 1), []).append((i, j + 1))
        if not m[j, i - 1]:   # left unset: down the left side
            nxt.setdefault((i, j + 1), []).append((i, j))
    loops = []
    while nxt:
        start = next(iter(nxt))
        loop = [start]
        cur = start
        prev_dir = None
        while True:
            outs = nxt.get(cur)
            if not outs:
                break
            if len(outs) > 1 and prev_dir is not None:
                # Two cells touching at a corner only: turn left first, so
                # each keeps its own loop.
                outs.sort(key=lambda q: _turn(prev_dir, (q[0] - cur[0], q[1] - cur[1])), reverse=True)
            q = outs.pop(0)
            if not outs:
                del nxt[cur]
            prev_dir = (q[0] - cur[0], q[1] - cur[1])
            cur = q
            if cur == start:
                break
            loop.append(cur)
        if len(loop) >= 4:
            loops.append(_merge(loop))
    out = []
    for lp in loops:
        P = np.array([(u0 + (i - 1 + 0.5) * cell - 0.5 * cell, v0 + (j - 1 + 0.5) * cell - 0.5 * cell) for i, j in lp], dtype=float)
        out.append(P)
    return out


def _turn(d0, d1):
    return d0[0] * d1[1] - d0[1] * d1[0]


def _merge(loop):
    """Corners only: points where the loop runs straight on are dropped."""
    n = len(loop)
    keep = []
    for k in range(n):
        a, b, c = loop[k - 1], loop[k], loop[(k + 1) % n]
        if (b[0] - a[0], b[1] - a[1]) != (c[0] - b[0], c[1] - b[1]):
            keep.append(b)
    return keep


def area(P):
    x, y = P[:, 0], P[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def shadow_loops(V, F, frame, tolerance=0.1):
    """The shadow's outer loops on the plane, [u, v] mm, largest first, and
    the cell they were traced at."""
    uv = frame_uv(V, frame)
    cell = cell_for(uv, tolerance)
    mask, u0, v0 = rasterise(uv, F, cell)
    mask = fill_holes(mask)
    loops = [p for p in trace(mask, u0, v0, cell) if area(p) > 0]
    loops.sort(key=lambda p: -abs(area(p)))
    return loops, cell
