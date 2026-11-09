# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/deviation/surface.ts
#
# A triangle mesh prepared for signed closest-point queries: the reference a
# scan is aligned to and measured against. The sign is read off the
# pseudonormal of whichever vertex, edge or face the closest point lands on
# (Baerentzen & Aanaes) — exact on a closed mesh, where the nearest face's own
# normal would speckle every sharp edge with false flips. A second query finds
# the nearest surface that faces a given way.
#
# ScanRuler searches a three-mesh-bvh tree one point at a time. Here the
# points go through numpy together: the triangles are cut into small leaves
# along a Morton curve, each with its box, and every query visits the leaves
# best-first by the distance to their box, all queries a round at a time,
# until no leaf left can hold anything nearer. The answer is the same exact
# nearest triangle; only the search differs.

import numpy as np

# Where on a triangle the closest point landed (Ericson, RTCD 5.1.5).
VERTEX_A, VERTEX_B, VERTEX_C, EDGE_AB, EDGE_AC, EDGE_BC, FACE = range(7)

LEAF = 16
NODE = 16
# Queries times leaves held at once while ordering the leaves.
_BLOCK = 3_000_000


def closest_on_triangles(P, A, B, C):
    """Closest point to each P on triangle (A, B, C), row by row, and which
    feature of the triangle it belongs to: the branch that fires is the
    classification, so no epsilon comparison is needed at a seam."""
    n = len(P)
    X = np.empty((n, 3))
    feat = np.full(n, FACE, dtype=np.int8)
    done = np.zeros(n, dtype=bool)
    ab, ac, ap = B - A, C - A, P - A
    d1 = np.einsum("ij,ij->i", ab, ap)
    d2 = np.einsum("ij,ij->i", ac, ap)
    m = (d1 <= 0) & (d2 <= 0)
    X[m] = A[m]
    feat[m] = VERTEX_A
    done |= m
    bp = P - B
    d3 = np.einsum("ij,ij->i", ab, bp)
    d4 = np.einsum("ij,ij->i", ac, bp)
    m = ~done & (d3 >= 0) & (d4 <= d3)
    X[m] = B[m]
    feat[m] = VERTEX_B
    done |= m
    vc = d1 * d4 - d3 * d2
    m = ~done & (vc <= 0) & (d1 >= 0) & (d3 <= 0)
    if m.any():
        v = d1[m] / (d1[m] - d3[m])
        X[m] = A[m] + ab[m] * v[:, None]
        feat[m] = EDGE_AB
        done |= m
    cp = P - C
    d5 = np.einsum("ij,ij->i", ab, cp)
    d6 = np.einsum("ij,ij->i", ac, cp)
    m = ~done & (d6 >= 0) & (d5 <= d6)
    X[m] = C[m]
    feat[m] = VERTEX_C
    done |= m
    vb = d5 * d2 - d1 * d6
    m = ~done & (vb <= 0) & (d2 >= 0) & (d6 <= 0)
    if m.any():
        w = d2[m] / (d2[m] - d6[m])
        X[m] = A[m] + ac[m] * w[:, None]
        feat[m] = EDGE_AC
        done |= m
    va = d3 * d6 - d5 * d4
    m = ~done & (va <= 0) & (d4 - d3 >= 0) & (d5 - d6 >= 0)
    if m.any():
        w = (d4[m] - d3[m]) / ((d4[m] - d3[m]) + (d5[m] - d6[m]))
        X[m] = B[m] + (C[m] - B[m]) * w[:, None]
        feat[m] = EDGE_BC
        done |= m
    m = ~done
    if m.any():
        with np.errstate(divide="ignore", invalid="ignore"):
            denom = 1.0 / (va[m] + vb[m] + vc[m])
        v = vb[m] * denom
        w = vc[m] * denom
        X[m] = A[m] + ab[m] * v[:, None] + ac[m] * w[:, None]
        bad = ~np.isfinite(X[m]).all(axis=1)
        if bad.any():  # a triangle of no area: its first corner stands in
            idx = np.nonzero(m)[0][bad]
            X[idx] = A[idx]
    return X, feat


def _box_d2(Q, lo, hi):
    """Squared distance from each query to each box, (queries, boxes)."""
    out = np.zeros((len(Q), len(lo)))
    for k in range(3):
        q = Q[:, k : k + 1]
        d = np.maximum(lo[None, :, k] - q, 0) + np.maximum(q - hi[None, :, k], 0)
        out += d * d
    return out


def _box_d2_pairs(Q, lo, hi):
    d = np.maximum(lo - Q, 0) + np.maximum(Q - hi, 0)
    return (d * d).sum(axis=1)


def _normalize_rows(a):
    n = np.linalg.norm(a, axis=1)
    out = np.zeros_like(a)
    ok = n > 1e-20
    out[ok] = a[ok] / n[ok, None]
    out[~ok] = (0.0, 0.0, 1.0)
    return out


def _morton(c):
    """30-bit Morton code of points already scaled to [0, 1023]."""
    def spread(x):
        x = x.astype(np.int64) & 0x3FF
        x = (x | (x << 16)) & 0x030000FF
        x = (x | (x << 8)) & 0x0300F00F
        x = (x | (x << 4)) & 0x030C30C3
        x = (x | (x << 2)) & 0x09249249
        return x

    return spread(c[:, 0]) | (spread(c[:, 1]) << 1) | (spread(c[:, 2]) << 2)


class Hits:
    """What a batch of closest-point queries found, one row a query."""

    def __init__(self, n):
        self.found = np.zeros(n, dtype=bool)
        self.distance = np.full(n, np.inf)
        self.signed = np.full(n, np.nan)
        self.point = np.zeros((n, 3))
        self.normal = np.tile((0.0, 0.0, 1.0), (n, 1))
        self.face = np.full(n, -1, dtype=np.int64)


class NominalSurface:
    """The reference geometry, prepared for signed closest-point queries.
    Must be closed for the sign to be exact."""

    def __init__(self, positions, indices, leaf=LEAF):
        self.positions = np.ascontiguousarray(positions, dtype=float).reshape(-1, 3)
        self.index = np.ascontiguousarray(indices, dtype=np.int64).reshape(-1, 3)
        self.vertex_count = len(self.positions)
        self.triangle_count = len(self.index)
        if self.triangle_count == 0:
            raise ValueError("The reference has no triangles.")
        used = self.positions[np.unique(self.index)]
        self.bbox_min = used.min(axis=0)
        self.bbox_max = used.max(axis=0)
        self.bbox_diagonal = float(np.linalg.norm(self.bbox_max - self.bbox_min))
        self.A = self.positions[self.index[:, 0]]
        self.B = self.positions[self.index[:, 1]]
        self.C = self.positions[self.index[:, 2]]
        self._normals()
        self._leaves(leaf)

    # ---- pseudonormals ----

    def _normals(self):
        A, B, C = self.A, self.B, self.C
        u, v = B - A, C - A
        n = np.cross(u, v)
        length = np.linalg.norm(n, axis=1)
        # A triangle of no area has no normal of its own, and its stand-in
        # (+Z) must not reach its corners' and edges' pseudonormals.
        degenerate = ~((length > 1e-20) & (length > 1e-6 * np.linalg.norm(u, axis=1) * np.linalg.norm(v, axis=1)))
        fn = np.zeros_like(n)
        ok = ~degenerate
        fn[ok] = n[ok] / length[ok, None]
        fn[degenerate] = (0.0, 0.0, 1.0)
        self.face_normal = fn
        self.degenerate = degenerate

        # Vertex pseudonormal: weighted by the angle each face subtends there.
        vn = np.zeros((self.vertex_count, 3))
        corners = ((A, B, C, 0), (B, A, C, 1), (C, A, B, 2))
        for P0, P1, P2, k in corners:
            e1, e2 = P1 - P0, P2 - P0
            l1 = np.linalg.norm(e1, axis=1)
            l2 = np.linalg.norm(e2, axis=1)
            good = ok & (l1 > 1e-20) & (l2 > 1e-20)
            cos = np.clip(np.einsum("ij,ij->i", e1[good], e2[good]) / (l1[good] * l2[good]), -1, 1)
            w = np.arccos(cos)
            np.add.at(vn, self.index[good, k], fn[good] * w[:, None])
        self.vertex_normal = _normalize_rows(vn)

        # Edge pseudonormal: the plain sum of the faces meeting there. Edges
        # by their sorted endpoints; per face its edges AB, AC, BC.
        I = self.index
        pairs = np.concatenate([I[:, [0, 1]], I[:, [0, 2]], I[:, [1, 2]]])
        pairs.sort(axis=1)
        key = pairs[:, 0] * (self.vertex_count + 1) + pairs[:, 1]
        uniq, inv = np.unique(key, return_inverse=True)
        f = self.triangle_count
        self.face_edge = inv.reshape(3, f).T.copy()
        en = np.zeros((len(uniq), 3))
        for k in range(3):
            np.add.at(en, self.face_edge[ok, k], fn[ok])
        self.edge_normal = _normalize_rows(en)

    # ---- the leaves ----

    def _leaves(self, size):
        cent = (self.A + self.B + self.C) / 3
        span = np.maximum(self.bbox_max - self.bbox_min, 1e-12)
        q = np.clip((cent - self.bbox_min) / span * 1023, 0, 1023)
        order = np.argsort(_morton(q), kind="stable")
        k = -(-len(order) // size)
        table = np.full(k * size, -1, dtype=np.int64)
        table[: len(order)] = order
        table = table.reshape(k, size)
        self.leaf_tris = table
        valid = table >= 0
        safe = np.where(valid, table, table[:, :1])
        lo = np.minimum(np.minimum(self.A[safe], self.B[safe]), self.C[safe]).min(axis=1)
        hi = np.maximum(np.maximum(self.A[safe], self.B[safe]), self.C[safe]).max(axis=1)
        self.leaf_lo = lo
        self.leaf_hi = hi
        self.leaf_valid = valid
        # Nodes: runs of NODE leaves along the same curve.
        kn = -(-k // NODE)
        nt = np.full(kn * NODE, -1, dtype=np.int64)
        nt[:k] = np.arange(k)
        nt = nt.reshape(kn, NODE)
        self.node_leaves = nt
        ns = np.where(nt >= 0, nt, nt[:, :1])
        self.node_lo = lo[ns].min(axis=1)
        self.node_hi = hi[ns].max(axis=1)

    # ---- queries ----

    def closest(self, P, max_distance=np.inf, facing=None, min_dot=None):
        """The nearest surface point to each row of P (n, 3) within
        max_distance — or, with facing (n, 3) and min_dot, the nearest
        triangle whose own normal n satisfies n . facing >= min_dot. Returns
        Hits, signed by the pseudonormal of the feature landed on."""
        P = np.asarray(P, dtype=float).reshape(-1, 3)
        n = len(P)
        hits = Hits(n)
        if n == 0:
            return hits
        best_face = np.full(n, -1, dtype=np.int64)
        best2 = np.full(n, np.inf)
        cap2 = max_distance * max_distance if np.isfinite(max_distance) else np.inf
        block = max(1, _BLOCK // len(self.node_lo))
        for s in range(0, n, block):
            e = min(n, s + block)
            f, d2 = self._search(P[s:e], cap2, None if facing is None else facing[s:e], min_dot)
            best_face[s:e] = f
            best2[s:e] = d2
        ok = best_face >= 0
        if np.isfinite(max_distance):
            ok &= best2 <= cap2
        if ok.any():
            self._fill(P, np.nonzero(ok)[0], best_face[ok], hits)
        return hits

    def _search(self, Q, cap2, facing, min_dot):
        """Best-first over the nodes (a run of leaves each), every query a
        round at a time: a node is opened while its box is nearer than the
        best triangle found, then its leaves while theirs are."""
        m = len(Q)
        lb = _box_d2(Q, self.node_lo, self.node_hi)
        if np.isfinite(cap2):
            lb[lb > cap2] = np.inf
        order = np.argsort(lb, axis=1)
        lb_sorted = np.take_along_axis(lb, order, axis=1)
        best2 = np.full(m, np.inf if not np.isfinite(cap2) else cap2 * (1 + 1e-12) + 1e-300)
        best_face = np.full(m, -1, dtype=np.int64)
        K = lb.shape[1]
        rows = np.arange(m)
        r = 0
        while r < K:
            bound = lb_sorted[rows, r]
            live = bound < best2[rows]
            if not live.any():
                break
            rows = rows[live]
            nodes = order[rows, r]
            # The node's leaves, each against its own box.
            leaves = self.node_leaves[nodes]  # (p, G)
            lq = np.repeat(rows, leaves.shape[1])
            ll = leaves.ravel()
            ok = ll >= 0
            lq, ll = lq[ok], ll[ok]
            d2 = _box_d2_pairs(Q[lq], self.leaf_lo[ll], self.leaf_hi[ll])
            # Each query's nearest leaf first, for a bound the rest are cut by.
            o = np.lexsort((d2, lq))
            lq, ll, d2 = lq[o], ll[o], d2[o]
            head = np.ones(len(lq), dtype=bool)
            head[1:] = lq[1:] != lq[:-1]
            for part in (head, ~head):
                pl, pk, pd = lq[part], ll[part], d2[part]
                ok = pd < best2[pl]
                self._leaf_pass(Q, pl[ok], pk[ok], facing, min_dot, best2, best_face)
            r += 1
        return best_face, best2

    def _leaf_pass(self, Q, lq, ll, facing, min_dot, best2, best_face):
        if not len(lq):
            return
        tris = self.leaf_tris[ll]  # (p, S), -1 padded
        valid = self.leaf_valid[ll]
        S = tris.shape[1]
        pt = np.where(valid, tris, tris[:, :1]).ravel()
        pq = np.repeat(lq, S)
        X, _ = closest_on_triangles(Q[pq], self.A[pt], self.B[pt], self.C[pt])
        d2 = ((X - Q[pq]) ** 2).sum(axis=1).reshape(-1, S)
        bad = ~valid
        if facing is not None:
            bad |= (np.einsum("ij,ij->i", self.face_normal[pt], facing[pq]) < min_dot).reshape(-1, S)
        d2[bad] = np.inf
        k = d2.argmin(axis=1)
        row = d2[np.arange(len(lq)), k]
        face = tris[np.arange(len(lq)), k]
        # Per query, the least over its leaves.
        before = best2.copy()
        np.minimum.at(best2, lq, row)
        won = (row == best2[lq]) & (row < before[lq])
        best_face[lq[won]] = face[won]

    def _fill(self, P, rows, faces, hits):
        """Resolve the closest point on one known triangle per row, and the
        pseudonormal of whichever feature of it the point belongs to."""
        Q = P[rows]
        X, feat = closest_on_triangles(Q, self.A[faces], self.B[faces], self.C[faces])
        nrm = self.face_normal[faces].copy()
        isv = feat <= VERTEX_C
        if isv.any():
            vi = self.index[faces[isv], feat[isv].astype(np.int64)]
            nrm[isv] = self.vertex_normal[vi]
        ise = (feat >= EDGE_AB) & (feat <= EDGE_BC)
        if ise.any():
            ei = self.face_edge[faces[ise], (feat[ise] - EDGE_AB).astype(np.int64)]
            nrm[ise] = self.edge_normal[ei]
        d = Q - X
        dist = np.linalg.norm(d, axis=1)
        side = np.einsum("ij,ij->i", d, nrm)
        hits.found[rows] = True
        hits.distance[rows] = dist
        hits.signed[rows] = np.where(side < 0, -dist, dist)
        hits.point[rows] = X
        hits.normal[rows] = nrm
        hits.face[rows] = faces

    def raycast_first(self, O, D, near, far):
        """The first triangle each ray O + t D meets, either side, with
        near <= t <= far: (t, face), t inf and face -1 for none. Leaves are
        opened best-first by where the ray enters their box."""
        O = np.asarray(O, dtype=float).reshape(-1, 3)
        D = np.asarray(D, dtype=float).reshape(-1, 3)
        near = np.broadcast_to(np.asarray(near, dtype=float), (len(O),))
        far = np.broadcast_to(np.asarray(far, dtype=float), (len(O),))
        t_out = np.full(len(O), np.inf)
        f_out = np.full(len(O), -1, dtype=np.int64)
        K = len(self.leaf_tris)
        block = max(1, _BLOCK // K)
        for s in range(0, len(O), block):
            e = min(len(O), s + block)
            t_out[s:e], f_out[s:e] = self._cast(O[s:e], D[s:e], near[s:e], far[s:e])
        return t_out, f_out

    def _cast(self, O, D, near, far):
        m = len(O)
        flat = np.abs(D) < 1e-12
        inv = 1.0 / np.where(flat, 1.0, D)
        tn = np.full((m, len(self.leaf_lo)), -np.inf)
        tf = np.full((m, len(self.leaf_lo)), np.inf)
        for k in range(3):
            lo = self.leaf_lo[None, :, k] - O[:, k : k + 1]
            hi = self.leaf_hi[None, :, k] - O[:, k : k + 1]
            t1 = lo * inv[:, k : k + 1]
            t2 = hi * inv[:, k : k + 1]
            # A ray square to an axis never leaves its slab, or never enters.
            fk = flat[:, k : k + 1]
            inside = (lo <= 0) & (hi >= 0)
            t1 = np.where(fk, np.where(inside, -np.inf, np.inf), t1)
            t2 = np.where(fk, np.where(inside, np.inf, -np.inf), t2)
            tn = np.maximum(tn, np.minimum(t1, t2))
            tf = np.minimum(tf, np.maximum(t1, t2))
        entry = np.maximum(tn, near[:, None])
        entry[(tn > tf) | (tf < near[:, None]) | (entry > far[:, None])] = np.inf
        order = np.argsort(entry, axis=1)
        entry_sorted = np.take_along_axis(entry, order, axis=1)
        best = far * (1 + 1e-12) + 1e-300
        best_face = np.full(m, -1, dtype=np.int64)
        best_t = np.full(m, np.inf)
        rows = np.arange(m)
        K = entry.shape[1]
        r, step = 0, 1
        while r < K:
            cols = slice(r, min(K, r + step))
            live = entry_sorted[rows, cols] <= best[rows, None]
            if not live.any():
                break
            keep = live.any(axis=1)
            rows, live = rows[keep], live[keep]
            leaves = order[rows, cols][live]
            qrow = np.repeat(rows, live.sum(axis=1))
            tris = self.leaf_tris[leaves]
            pv = self.leaf_valid[leaves].ravel()
            pq = np.repeat(qrow, tris.shape[1])[pv]
            pt = tris.ravel()[pv]
            if len(pq):
                t = _moller_trumbore(O[pq], D[pq], self.A[pt], self.B[pt], self.C[pt])
                ok = (t >= near[pq]) & (t <= best[pq])
                pq, pt, t = pq[ok], pt[ok], t[ok]
                if len(pq):
                    o = np.lexsort((t, pq))
                    pq, pt, t = pq[o], pt[o], t[o]
                    first = np.ones(len(pq), dtype=bool)
                    first[1:] = pq[1:] != pq[:-1]
                    uq, ut, uf = pq[first], t[first], pt[first]
                    better = ut < best_t[uq]
                    best_t[uq[better]] = ut[better]
                    best[uq[better]] = ut[better]
                    best_face[uq[better]] = uf[better]
            r += step
            step = min(8, step * 2)
        return best_t, best_face

    def closest_on_faces(self, P, faces):
        """The signed reading off triangles already known to be the nearest."""
        P = np.asarray(P, dtype=float).reshape(-1, 3)
        hits = Hits(len(P))
        rows = np.arange(len(P))
        self._fill(P, rows, np.asarray(faces, dtype=np.int64), hits)
        return hits


def _moller_trumbore(O, D, A, B, C):
    """Where each ray meets its triangle, either side; inf where it misses."""
    e1, e2 = B - A, C - A
    p = np.cross(D, e2)
    det = np.einsum("ij,ij->i", e1, p)
    ok = np.abs(det) > 1e-18
    inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
    s = O - A
    u = np.einsum("ij,ij->i", s, p) * inv
    q = np.cross(s, e1)
    v = np.einsum("ij,ij->i", D, q) * inv
    t = np.einsum("ij,ij->i", e2, q) * inv
    # A hair of slack on the barycentrics: a ray straight down a shared edge
    # must not slip between the two triangles on rounding.
    eps = 1e-12
    hit = ok & (u >= -eps) & (v >= -eps) & (u + v <= 1 + eps)
    return np.where(hit, t, np.inf)


def signed_volume(V, F):
    V = np.asarray(V, dtype=float)
    F = np.asarray(F, dtype=np.int64)
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6)


def weld(V, F, tol=1e-6):
    """Coincident vertices merged (a STEP tessellation comes face by face),
    triangles that collapse dropped."""
    V = np.asarray(V, dtype=float)
    F = np.asarray(F, dtype=np.int64)
    if len(V) == 0:
        return V, F
    key = np.round(V / tol).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    F2 = inv[F]
    good = (F2[:, 0] != F2[:, 1]) & (F2[:, 1] != F2[:, 2]) & (F2[:, 0] != F2[:, 2])
    return V[first], F2[good]
