# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/deviation/volume.ts,
# src/core/deviation/winding.ts, src/commands/volumeAnswer.ts
#
# The deviation as volumes: on a grid over the part each cell is asked
# whether it lies inside the reference and whether inside the scan; cells
# where the answers differ, grouped into 6-connected regions, are material
# the reference has and the part has not (excess) or the other way round
# (missing) — so many mm^3, so deep, wherever they sit. A cell within the
# tolerance of the scan's surface is the scan's noise, never an error.
#
# Inside the reference: each column of cells along Z counts the crossings
# below each cell, in through down-facing triangles and out through up-facing
# ones; a column whose crossings do not cancel runs through a hole in the
# reference and is read from the closed columns beside it. Inside the scan:
# the same count where the scan's column is closed, which is its winding
# number exactly; where it is not (a scan with holes) the generalized winding
# number (Jacobson 2013) on a Barnes-Hut tree (Barill 2018), read on a coarse
# grid and cell by cell where the scan crosses or the value is near 1/2 —
# about 1 inside, 0 outside, easing to 1/2 near the holes: unsure.

import math
import time

import numpy as np

from .dev_hotspots import components
from .dev_surface import NominalSurface, _morton

COARSE = 4
MAX_CELLS = 16_000_000
CELLS_ALONG = 250
MIN_REGION_CELLS = 8
NEAR_HALF = 0.4
DEFAULT_UNSURE = (0.3, 0.7)
PAD_TOLERANCES = 10
SCAN_REACH = 0.25
DEFAULT_BETA = 2.0
VOLUME_REGIONS = 8
MAX_REGIONS = 50
KINDS = ("excess", "missing", "unsure")


def default_cell(tolerance, longest):
    return max(tolerance / 2, longest / CELLS_ALONG)


# ---- the generalized winding number ----


class WindingTree:
    """Triangles in leaves along a Morton curve, leaves in nodes: a node or
    leaf far from the point (beyond beta of its radii) counts as one dipole at
    its centroid (the area-weighted normal sum); near leaves are summed
    exactly. ScanRuler's tree also adds the second moment;
    this one reads the dipole and the first moment (Barill's order 2) — the
    answer is held against 0.3, 1/2 and 0.7."""

    def __init__(self, V, F, beta=DEFAULT_BETA, leaf=8, fan=32):
        V = np.asarray(V, dtype=float)
        F = np.asarray(F, dtype=np.int64)
        A, B, C = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
        an = np.cross(B - A, C - A) / 2
        keep = np.linalg.norm(an, axis=1) > 0
        A, B, C, an = A[keep], B[keep], C[keep], an[keep]
        self.A, self.B, self.C = A, B, C
        self.beta2 = beta * beta
        n = len(A)
        self.count = n
        if n == 0:
            return
        g = (A + B + C) / 3
        lo, hi = g.min(axis=0), g.max(axis=0)
        order = np.argsort(_morton(np.clip((g - lo) / np.maximum(hi - lo, 1e-12) * 1023, 0, 1023)), kind="stable")
        self.leaf_tris = self._chunk(order, leaf)
        self.leaf = self._summary(self.leaf_tris, g, an)
        self.node_leaves = self._chunk(np.arange(len(self.leaf_tris)), fan)
        self.node = self._summary_nodes()

    @staticmethod
    def _chunk(items, size):
        k = -(-len(items) // size)
        t = np.full(k * size, -1, dtype=np.int64)
        t[: len(items)] = items
        return t.reshape(k, size)

    def _summary(self, table, g, an):
        valid = table >= 0
        safe = np.where(valid, table, 0)
        a = np.linalg.norm(an[safe], axis=2) * valid
        area = a.sum(axis=1)
        c = (g[safe] * a[..., None]).sum(axis=1) / np.maximum(area, 1e-300)[:, None]
        corners = np.stack([self.A[safe], self.B[safe], self.C[safe]], axis=2)
        r = np.where(valid[..., None], np.linalg.norm(corners - c[:, None, None, :], axis=3), 0).max(axis=(1, 2))
        dip = (an[safe] * valid[..., None]).sum(axis=1)
        # First moment M_jk = sum over triangles of (g - c)_j (a n)_k: exact,
        # the centroid being the mean of x over a triangle.
        M = np.einsum("lsj,lsk->ljk", (g[safe] - c[:, None]) * valid[..., None], an[safe] * valid[..., None])
        return {"c": c, "r": r, "dip": dip, "area": area, "valid": valid, "M": M}

    def _summary_nodes(self):
        L = self.leaf
        t = self.node_leaves
        valid = t >= 0
        safe = np.where(valid, t, 0)
        area = (L["area"][safe] * valid).sum(axis=1)
        c = (L["c"][safe] * (L["area"][safe] * valid)[..., None]).sum(axis=1) / np.maximum(area, 1e-300)[:, None]
        r = np.where(valid, np.linalg.norm(L["c"][safe] - c[:, None], axis=2) + L["r"][safe], 0).max(axis=1)
        dip = (L["dip"][safe] * valid[..., None]).sum(axis=1)
        M = (L["M"][safe] * valid[..., None, None]).sum(axis=1) + np.einsum("nlj,nlk->njk", (L["c"][safe] - c[:, None]) * valid[..., None], L["dip"][safe] * valid[..., None])
        return {"c": c, "r": r, "dip": dip, "valid": valid, "M": M}

    @staticmethod
    def _dipole(q, c, dip):
        d = c - q
        r2 = (d * d).sum(axis=-1)
        return (d * dip).sum(axis=-1) / (r2 * np.sqrt(r2))

    def at(self, Q, block=2000):
        Q = np.asarray(Q, dtype=float).reshape(-1, 3)
        out = np.zeros(len(Q))
        if self.count == 0:
            return out
        for s in range(0, len(Q), block):
            out[s : s + block] = self._at(Q[s : s + block])
        return out / (4 * math.pi)

    def _at(self, Q):
        m = len(Q)
        total = np.zeros(m)
        N = self.node
        d2 = ((N["c"][None] - Q[:, None]) ** 2).sum(axis=2)
        far = d2 > self.beta2 * N["r"][None] ** 2
        d = N["c"][None] - Q[:, None]
        with np.errstate(divide="ignore", invalid="ignore"):
            r3 = d2 * np.sqrt(d2)
            contrib = (d * N["dip"][None]).sum(axis=2) / r3
            trM = np.trace(N["M"], axis1=1, axis2=2)[None]
            rMr = np.einsum("qnj,njk,qnk->qn", d, N["M"], d)
            contrib += trM / r3 - 3 * rMr / (r3 * d2)
        total += np.where(far, contrib, 0).sum(axis=1)
        qi, ni = np.nonzero(~far)
        leaves = self.node_leaves[ni]  # (p, fan)
        ok = leaves >= 0
        lq = np.repeat(qi, leaves.shape[1])[ok.ravel()]
        ll = leaves.ravel()[ok.ravel()]
        L = self.leaf
        dl = L["c"][ll] - Q[lq]
        dl2 = (dl * dl).sum(axis=1)
        lfar = dl2 > self.beta2 * L["r"][ll] ** 2
        with np.errstate(divide="ignore", invalid="ignore"):
            r3l = dl2 * np.sqrt(dl2)
            Ml = L["M"][ll]
            lc = (dl * L["dip"][ll]).sum(axis=1) / r3l + np.trace(Ml, axis1=1, axis2=2) / r3l - 3 * np.einsum("pj,pjk,pk->p", dl, Ml, dl) / (r3l * dl2)
        np.add.at(total, lq[lfar], lc[lfar])
        nq, nl = lq[~lfar], ll[~lfar]
        tris = self.leaf_tris[nl]
        tv = (tris >= 0).ravel()
        tq = np.repeat(nq, tris.shape[1])[tv]
        tt = tris.ravel()[tv]
        if len(tt):
            a = self.A[tt] - Q[tq]
            b = self.B[tt] - Q[tq]
            c = self.C[tt] - Q[tq]
            la, lb, lc_ = np.linalg.norm(a, axis=1), np.linalg.norm(b, axis=1), np.linalg.norm(c, axis=1)
            num = np.einsum("ij,ij->i", a, np.cross(b, c))
            den = la * lb * lc_ + np.einsum("ij,ij->i", a, b) * lc_ + np.einsum("ij,ij->i", b, c) * la + np.einsum("ij,ij->i", c, a) * lb
            np.add.at(total, tq, 2 * np.arctan2(num, den))
        return total


# ---- columns ----


def column_crossings(V, F, ox, oy, h, nx, ny):
    """Where each triangle crosses each column of cells along Z: (column,
    z, sign), +1 where it faces down (the column enters), -1 up. The columns
    stand a hair off the cell centres so one through a shared edge is not
    counted twice."""
    V = np.asarray(V, dtype=float)
    F = np.asarray(F, dtype=np.int64)
    ex, ey = h * 1.37e-5, h * 2.71e-5
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    area = (b[:, 0] - a[:, 0]) * (c[:, 1] - a[:, 1]) - (b[:, 1] - a[:, 1]) * (c[:, 0] - a[:, 0])
    xs = np.stack([a[:, 0], b[:, 0], c[:, 0]], 1)
    ys = np.stack([a[:, 1], b[:, 1], c[:, 1]], 1)
    i0 = np.maximum(0, np.ceil((xs.min(1) - ox - ex) / h - 0.5)).astype(np.int64)
    i1 = np.minimum(nx - 1, np.floor((xs.max(1) - ox - ex) / h - 0.5)).astype(np.int64)
    j0 = np.maximum(0, np.ceil((ys.min(1) - oy - ey) / h - 0.5)).astype(np.int64)
    j1 = np.minimum(ny - 1, np.floor((ys.max(1) - oy - ey) / h - 0.5)).astype(np.int64)
    ni, nj = i1 - i0 + 1, j1 - j0 + 1
    use = (area != 0) & (ni > 0) & (nj > 0)
    t = np.nonzero(use)[0]
    cnt = ni[t] * nj[t]
    if cnt.sum() == 0:
        return np.zeros(0, np.int64), np.zeros(0), np.zeros(0, np.int8)
    tt = np.repeat(t, cnt)
    k = np.arange(int(cnt.sum())) - np.repeat(np.concatenate([[0], np.cumsum(cnt)[:-1]]), cnt)
    ii = i0[tt] + k % ni[tt]
    jj = j0[tt] + k // ni[tt]
    x = ox + (ii + 0.5) * h + ex
    y = oy + (jj + 0.5) * h + ey
    A_, B_, C_ = a[tt], b[tt], c[tt]
    inv = 1 / area[tt]
    wa = ((B_[:, 0] - x) * (C_[:, 1] - y) - (B_[:, 1] - y) * (C_[:, 0] - x)) * inv
    wb = ((C_[:, 0] - x) * (A_[:, 1] - y) - (C_[:, 1] - y) * (A_[:, 0] - x)) * inv
    wc = 1 - wa - wb
    inside = (wa >= 0) & (wb >= 0) & (wc >= 0)
    z = wa * A_[:, 2] + wb * B_[:, 2] + wc * C_[:, 2]
    sign = np.where(area[tt] > 0, -1, 1).astype(np.int8)
    return (ii + jj * nx)[inside], z[inside], sign[inside]


def column_counts(col, z, sign, oz, h, nx, ny, nz):
    """The crossing sum below each cell's centre, (columns, nz) int16, and
    each column's total (0 where it closes)."""
    columns = nx * ny
    total = np.zeros(columns, dtype=np.int64)
    np.add.at(total, col, sign)
    # A crossing at z counts for every cell whose centre lies above it.
    k = np.clip(np.floor((z - oz) / h - 0.5).astype(np.int64) + 1, 0, nz)
    delta = np.zeros((columns, nz + 1), dtype=np.int32)
    np.add.at(delta, (col, k), sign.astype(np.int32))
    sums = np.cumsum(delta[:, :nz], axis=1)
    return sums, total


def model_inside(V, F, ox, oy, oz, h, nx, ny, nz):
    """1 for each cell whose centre lies inside the reference, as (k, j, i)
    flattened i + nx (j + ny k); and the open columns' report or None."""
    col, z, sign = column_crossings(V, F, ox, oy, h, nx, ny)
    sums, total = column_counts(col, z, sign, oz, h, nx, ny, nz)
    base = np.where(total < 0, -total, 0)
    inside = (sums + base[:, None]) > 0  # (columns, nz)
    has = np.zeros(nx * ny, dtype=bool)
    has[col] = True
    open_ = has & (total != 0)
    report = None
    if open_.any():
        open_cols = np.nonzero(open_)[0]
        zs = z[open_[col]]
        _open_columns(inside, open_, has, open_cols, nx, ny)
        i, j = open_cols % nx, open_cols // nx
        report = {
            "columns": int(len(open_cols)),
            "box": {"min": [ox + i.min() * h, oy + j.min() * h, float(zs.min())], "max": [ox + (i.max() + 1) * h, oy + (j.max() + 1) * h, float(zs.max())]},
        }
    return inside.T.reshape(-1).astype(np.uint8), report


def _open_columns(inside, open_, has, cols, nx, ny):
    """A column through a hole in the reference read from the closed columns
    with material in the nearest ring round it that has any."""
    closed = has & ~open_
    for c in cols:
        i, j = c % nx, c // nx
        ring = []
        r = 1
        while not ring and r < max(nx, ny):
            ii, jj = np.meshgrid(np.arange(i - r, i + r + 1), np.arange(j - r, j + r + 1), indexing="ij")
            on = (np.maximum(np.abs(ii - i), np.abs(jj - j)) == r) & (ii >= 0) & (jj >= 0) & (ii < nx) & (jj < ny)
            cand = (ii[on] + jj[on] * nx)
            ring = cand[closed[cand]]
            r += 1
        if len(ring) == 0:
            inside[c] = False
            continue
        says = inside[ring].sum(axis=0)
        inside[c] &= ~(2 * says <= len(ring))


# ---- the measurement ----


def _settle_sign(model, nx, ny, nz, value_at):
    m = model.reshape(nz, ny, nx).astype(bool)
    deep = m.copy()
    for ax, n in ((2, nx), (1, ny), (0, nz)):
        for s in (-2, 2):
            sh = np.roll(m, s, axis=ax)
            idx = [slice(None)] * 3
            idx[ax] = slice(0, 2) if s > 0 else slice(n - 2, n)
            sh[tuple(idx)] = False
            deep &= sh
    cells = np.nonzero(deep.reshape(-1))[0]
    if len(cells) == 0:
        cells = np.nonzero(model)[0]
    if len(cells) == 0:
        return 1
    step = max(1, len(cells) // 64)
    return -1 if value_at(cells[::step]).sum() < 0 else 1


def volume_deviation(ref_V, ref_F, scan_V, scan_F, to_reference, tolerance, cell=None, unsure=DEFAULT_UNSURE, within=None, beta=DEFAULT_BETA):
    t0 = time.time()
    T = tolerance
    lo_u, hi_u = unsure
    ref_V = np.asarray(ref_V, dtype=float)
    scan_V = np.asarray(scan_V, dtype=float)
    scan_F = np.asarray(scan_F, dtype=np.int64)
    sV = to_reference.apply(scan_V)  # the scan in the reference's frame
    rlo, rhi = ref_V[np.unique(ref_F)].min(0), ref_V[np.unique(ref_F)].max(0)
    longest = float((rhi - rlo).max())
    slo, shi = sV.min(0), sV.max(0)
    reach = SCAN_REACH * longest
    lo = np.minimum(rlo - PAD_TOLERANCES * T, np.maximum(slo, rlo - reach))
    hi = np.maximum(rhi + PAD_TOLERANCES * T, np.minimum(shi, rhi + reach))
    if within is not None:
        lo = np.maximum(lo, within["min"])
        hi = np.minimum(hi, within["max"])
    h = cell if cell is not None else default_cell(T, longest)
    cells_at = lambda s: int(np.prod([max(1, math.ceil((hi[k] - lo[k]) / s)) for k in range(3)]))  # noqa: E731
    while cells_at(h) > MAX_CELLS:
        h *= 1.05
    nx, ny, nz = (max(1, math.ceil((hi[k] - lo[k]) / h)) for k in range(3))
    ox, oy, oz = lo
    n = nx * ny * nz
    nxy = nx * ny

    model, ref_open = model_inside(ref_V, ref_F, ox, oy, oz, h, nx, ny, nz)

    # The scan by its columns, where they close.
    col, z, sign = column_crossings(sV, scan_F, ox, oy, h, nx, ny)
    sums, total = column_counts(col, z, sign, oz, h, nx, ny, nz)
    w = sums.T.reshape(-1).astype(float)  # (k, j, i) order, as model
    open_col = total != 0
    open_cell = np.tile(open_col, nz)
    tree = None
    queries = {"winding": 0}
    centre = lambda c: np.stack([ox + (c % nx + 0.5) * h, oy + ((c // nx) % ny + 0.5) * h, oz + (c // nxy + 0.5) * h], axis=1)  # noqa: E731
    if open_cell.any():
        # The generalized winding number, coarse then cell by cell where the
        # scan crosses a coarse cell or the value is near 1/2.
        tree = WindingTree(sV, scan_F, beta)
        cx, cy, cz = -(-nx // COARSE), -(-ny // COARSE), -(-nz // COARSE)
        cells = np.nonzero(open_cell)[0]
        ci, cj, ck = (cells % nx) // COARSE, ((cells // nx) % ny) // COARSE, (cells // nxy) // COARSE
        cb = ci + cx * (cj + cy * ck)
        blocks = np.unique(cb)
        bi, bj, bk = blocks % cx, (blocks // cx) % cy, blocks // (cx * cy)
        half = COARSE * h / 2
        bc = np.stack([ox + bi * COARSE * h + half, oy + bj * COARSE * h + half, oz + bk * COARSE * h + half], axis=1)
        coarse = np.zeros(cx * cy * cz)
        coarse[blocks] = tree.at(bc)
        queries["winding"] += len(blocks)
        crossed = np.zeros(cx * cy * cz, dtype=bool)
        # Crossed: every coarse cell a scan triangle's box touches.
        tri = sV[scan_F]
        tlo = np.floor((tri.min(1) - lo) / (COARSE * h)).astype(np.int64)
        thi = np.floor((tri.max(1) - lo) / (COARSE * h)).astype(np.int64)
        dims = np.array([cx, cy, cz])
        tlo = np.clip(tlo, 0, dims - 1)
        thi = np.clip(thi, 0, dims - 1)
        span = thi - tlo + 1
        cnt = span.prod(1)
        tt = np.repeat(np.arange(len(tri)), cnt)
        k = np.arange(int(cnt.sum())) - np.repeat(np.concatenate([[0], np.cumsum(cnt)[:-1]]), cnt)
        sx, sy = span[tt, 0], span[tt, 1]
        crossed[(tlo[tt, 0] + k % sx) + cx * ((tlo[tt, 1] + (k // sx) % sy) + cy * (tlo[tt, 2] + k // (sx * sy)))] = True
        near = np.zeros_like(crossed)
        near[blocks] = np.abs(coarse[blocks] - 0.5) < NEAR_HALF
        # With its 26 neighbours.
        g = near.reshape(cz, cy, cx)
        band = g.copy()
        for dz in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    sh = np.zeros_like(g)
                    src = g[max(0, -dz) : cz - max(0, dz), max(0, -dy) : cy - max(0, dy), max(0, -dx) : cx - max(0, dx)]
                    sh[max(0, dz) : cz - max(0, -dz), max(0, dy) : cy - max(0, -dy), max(0, dx) : cx - max(0, -dx)] = src
                    band |= sh
        band = band.reshape(-1)
        # Near 1/2 and no surface through it: the value eases across the
        # coarse cell, read at its eight corners' middles (two cells each).
        crossed_cell = crossed[cb]
        oct_cell = ~crossed_cell & band[cb]
        plain = ~crossed_cell & ~oct_cell
        w[cells[plain]] = coarse[cb[plain]]
        if oct_cell.any():
            oc = cells[oct_cell]
            i, j, kk = oc % nx, (oc // nx) % ny, oc // nxy
            oi, oj, ok = (i % COARSE) >= COARSE // 2, (j % COARSE) >= COARSE // 2, (kk % COARSE) >= COARSE // 2
            key = cb[oct_cell] * 8 + oi + 2 * oj + 4 * ok
            uk, inv = np.unique(key, return_inverse=True)
            ub, uo = uk // 8, uk % 8
            ubi, ubj, ubk = ub % cx, (ub // cx) % cy, ub // (cx * cy)
            pts = np.stack(
                [
                    ox + (ubi * COARSE + (uo & 1) * (COARSE // 2) + COARSE / 4) * h,
                    oy + (ubj * COARSE + ((uo >> 1) & 1) * (COARSE // 2) + COARSE / 4) * h,
                    oz + (ubk * COARSE + ((uo >> 2) & 1) * (COARSE // 2) + COARSE / 4) * h,
                ],
                axis=1,
            )
            w[oc] = tree.at(pts)[inv.ravel()]
            queries["winding"] += len(uk)
        if crossed_cell.any():
            # A surface through it: the winding number jumps by one across
            # it, which the column's own crossings count exactly; read once
            # at the foot of each column of the coarse cell, and carried up
            # by the crossings.
            fc = cells[crossed_cell]
            colc = fc % nxy
            kk = fc // nxy
            k0 = (kk // COARSE) * COARSE
            key = colc * (nz + 1) + k0
            uk, inv = np.unique(key, return_inverse=True)
            ucol, uk0 = uk // (nz + 1), uk % (nz + 1)
            base = tree.at(centre(ucol + uk0 * nxy))
            queries["winding"] += len(uk)
            inv = inv.ravel()
            w[fc] = base[inv] + (sums[colc, kk] - sums[colc, k0])
    scan_sign = _settle_sign(model, nx, ny, nz, lambda c: w[c])
    w *= scan_sign

    kind = np.zeros(n, dtype=np.int8)
    uns = (w >= lo_u) & (w <= hi_u)
    kind[uns] = 3
    differ = ~uns & ((w > hi_u).astype(np.uint8) != model)
    kind[differ] = np.where(model[differ] == 1, 1, 2)

    # Within the tolerance of the scan's surface: noise.
    scan_surface = NominalSurface(scan_V, scan_F)
    to_scan_r = to_reference.r.T
    to_scan_t = -(to_scan_r @ to_reference.t)
    marked = np.nonzero(kind)[0]
    if len(marked):
        P = centre(marked) @ to_scan_r.T + to_scan_t
        hit = scan_surface.closest(P, T)
        kind[marked[hit.found & (hit.distance <= T)]] = 0

    # Regions: 6-connected cells of one kind.
    marked = np.nonzero(kind)[0]
    regions = []
    specks = 0.0
    cell_volume = h**3
    if len(marked):
        pos = np.full(n, -1, dtype=np.int64)
        pos[marked] = np.arange(len(marked))
        a_list, b_list = [], []
        ii, jj, kk = marked % nx, (marked // nx) % ny, marked // nxy
        for step, ok in ((1, ii < nx - 1), (nx, jj < ny - 1), (nxy, kk < nz - 1)):
            src = marked[ok]
            dst = src + step
            same = kind[dst] == kind[src]
            a_list.append(pos[src[same]])
            b_list.append(pos[dst[same]])
        label = components(len(marked), np.concatenate(a_list), np.concatenate(b_list))
        order = np.argsort(label, kind="stable")
        bounds = np.nonzero(np.diff(np.concatenate([[-1], label[order], [-2]])))[0]
        ref_surface = None
        for s, e in zip(bounds[:-1], bounds[1:]):
            members = marked[order[s:e]]
            if len(members) < MIN_REGION_CELLS:
                specks += len(members) * cell_volume
                continue
            kd = int(kind[members[0]])
            C = centre(members)
            hit = scan_surface.closest(C @ to_scan_r.T + to_scan_t)
            depth = hit.distance
            deepest_i = int(np.argmax(depth))
            inreg = np.zeros(n, dtype=bool)
            inreg[members] = True
            mi, mj, mk = members % nx, (members // nx) % ny, members // nxy
            model_faces = other_faces = 0
            bounded = np.zeros(len(members), dtype=bool)
            for step, has in ((-1, mi > 0), (1, mi < nx - 1), (-nx, mj > 0), (nx, mj < ny - 1), (-nxy, mk > 0), (nxy, mk < nz - 1)):
                d = np.where(has, members + step, 0)
                outside = ~has | ~inreg[d]
                mf = has & outside & (model[d] != model[members])
                model_faces += int(mf.sum())
                of = outside & ~mf
                other_faces += int(of.sum())
                bounded |= of
            faces = min(model_faces, other_faces) or max(model_faces, other_faces)
            volume = len(members) * cell_volume
            conf = float(np.minimum(1, np.abs(w[members] - 0.5) * 2).mean())
            deep = C[deepest_i]
            if ref_surface is None:
                ref_surface = NominalSurface(ref_V, ref_F)
            rt = ref_surface.closest(deep[None])
            regions.append(
                {
                    "kind": KINDS[kd - 1],
                    "cells": int(len(members)),
                    "volume": volume,
                    "maxDepth": float(depth[deepest_i]),
                    "thickness": volume / (faces * h * h) if faces > 0 else 0.0,
                    "box": {"min": (C.min(0) - h / 2).tolist(), "max": (C.max(0) + h / 2).tolist()},
                    "centroid": C.mean(0).tolist(),
                    "deepest": deep.tolist(),
                    "referenceTriangle": int(rt.face[0]),
                    # No patch closes the scan here, so every side the scan
                    # bounds is the real scan's.
                    "evidence": 1.0,
                    "confidence": conf,
                }
            )
    regions.sort(key=lambda r: -r["volume"])
    model_volume = float(model.sum()) * cell_volume
    totals = {}
    for k in KINDS:
        v = sum(r["volume"] for r in regions if r["kind"] == k)
        totals[k] = {"volume": v, "share": 100 * v / model_volume if model_volume > 0 else 0}
    return {
        "cell": h,
        "smallestSeen": 2 * h,
        "grid": {"min": [float(ox), float(oy), float(oz)], "dims": [nx, ny, nz]},
        "modelVolume": model_volume,
        "referenceOpen": ref_open,
        "totals": totals,
        "specks": specks,
        "regions": regions,
        "scanSign": scan_sign,
        "scanOpenColumns": int(open_col.sum()),
        "queries": queries,
        "seconds": time.time() - t0,
    }


def _r(v, d):
    return round(float(v), d)


def volume_out(v, tolerance, regions=VOLUME_REGIONS, kinds=KINDS):
    """What deviation_volume answers (volumeAnswer.ts)."""
    v3 = lambda p: [_r(x, 3) for x in p]  # noqa: E731
    listed = [r for r in v["regions"] if r["kind"] in kinds and (r["kind"] != "unsure" or r["cells"] >= 64)][:regions]
    out = {
        "tolerance": tolerance,
        "cell": _r(v["cell"], 3),
        "smallestSeen": _r(v["smallestSeen"], 3),
        "modelVolume": _r(v["modelVolume"], 1),
    }
    if v["referenceOpen"]:
        ro = v["referenceOpen"]
        out["referenceOpen"] = {"columns": ro["columns"], "box": {"min": v3(ro["box"]["min"]), "max": v3(ro["box"]["max"])}}
        out["warnings"] = [
            f"The reference's mesh has a hole over {ro['columns']} column{'' if ro['columns'] == 1 else 's'} of cells, in ({', '.join(map(str, v3(ro['box']['min'])))})–({', '.join(map(str, v3(ro['box']['max'])))}): read from the columns beside it, so no lump stands on it, and no finer than that there."
        ]
    out["totals"] = {k: {"volume": _r(v["totals"][k]["volume"], 1), "share": _r(v["totals"][k]["share"], 2)} for k in KINDS}
    out["found"] = len(v["regions"])
    out["regions"] = [
        {
            "kind": r["kind"],
            "volume": _r(r["volume"], 1),
            "maxDepth": _r(r["maxDepth"], 2),
            "thickness": _r(r["thickness"], 2),
            "shape": "layer" if r["thickness"] < 3 * v["cell"] else "lump",
            "centroid": v3(r["centroid"]),
            "deepest": v3(r["deepest"]),
            "box": {"min": v3(r["box"]["min"]), "max": v3(r["box"]["max"])},
            "evidence": _r(r["evidence"], 2),
            "confidence": _r(r["confidence"], 2),
        }
        for r in listed
    ]
    out["seconds"] = _r(v["seconds"], 1)
    return out
