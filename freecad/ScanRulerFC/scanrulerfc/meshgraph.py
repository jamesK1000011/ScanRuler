# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/geometry/buildGraph.ts,
# normals.ts, adjacency.ts, nearest.ts, query.ts, src/core/fit/segment.ts
# (vertexAreas)
#
# What a scan becomes before anything is measured on it: vertex adjacency
# for region growing and area-weighted vertex normals turned the right way
# out where that can be told.

import math

import numpy as np


class MeshGraph:
    def __init__(self, V, F):
        self.P = np.asarray(V, dtype=float)
        F = np.asarray(F, dtype=np.int64)
        # Degenerate triangles (a repeated corner) carry no surface.
        F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
        self.F = F.copy()
        n = len(self.P)
        self.n = n
        self.N = vertex_normals(self.P, self.F)
        if orient_outward(self.P, self.F):
            self.N = -self.N
            self.F = self.F[:, [0, 2, 1]]
        # Undirected edges, each vertex's neighbours sorted (CSR).
        e = np.concatenate([self.F[:, [0, 1]], self.F[:, [1, 2]], self.F[:, [2, 0]]])
        e = np.concatenate([e, e[:, ::-1]])
        e = np.unique(e, axis=0)
        self.adj_list = e[:, 1].copy()
        self.adj_off = np.zeros(n + 1, dtype=np.int64)
        np.add.at(self.adj_off, e[:, 0] + 1, 1)
        self.adj_off = np.cumsum(self.adj_off)
        lo, hi = self.P.min(axis=0), self.P.max(axis=0)
        self.bbox_diag = float(np.linalg.norm(hi - lo))
        self._areas = None
        self._lists = None

    def neighbours(self, verts):
        """The neighbours of each vertex in `verts`, one after the other."""
        verts = np.asarray(verts, dtype=np.int64)
        if len(verts) == 0:
            return np.zeros(0, dtype=np.int64), np.zeros(0, dtype=np.int64)
        s, t = self.adj_off[verts], self.adj_off[verts + 1]
        cnt = t - s
        tot = int(cnt.sum())
        if tot == 0:
            return np.zeros(0, dtype=np.int64), np.zeros(0, dtype=np.int64)
        owner = np.repeat(np.arange(len(verts)), cnt)
        start = np.repeat(s - np.concatenate([[0], np.cumsum(cnt)[:-1]]), cnt)
        return self.adj_list[start + np.arange(tot)], owner

    def lists(self):
        if self._lists is None:
            off, lst = self.adj_off.tolist(), self.adj_list.tolist()
            self._lists = [lst[off[v]:off[v + 1]] for v in range(self.n)]
        return self._lists

    def vertex_areas(self):
        """Each vertex's share of the surface: a third of every triangle it
        is a corner of."""
        if self._areas is None:
            t = self.P[self.F]
            a = np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1) / 6
            out = np.zeros(self.n)
            for k in range(3):
                np.add.at(out, self.F[:, k], a)
            self._areas = out
        return self._areas

    def triangle_of(self, v):
        rows = np.nonzero((self.F == v).any(axis=1))[0]
        return [int(x) for x in self.F[rows[0]]] if len(rows) else None

    def spot(self, vertex=None, point=None):
        """The place on the scan a location names (nearest.scanSpot)."""
        if vertex is not None:
            if not (0 <= vertex < self.n):
                raise ValueError(f"The scan has no vertex {vertex} — it has {self.n}.")
            dist = 0.0
        else:
            d2 = ((self.P - np.asarray(point, dtype=float)) ** 2).sum(axis=1)
            vertex = int(np.argmin(d2))
            dist = float(math.sqrt(d2[vertex]))
        tri = self.triangle_of(vertex)
        if tri is None:
            raise ValueError(f"Vertex {vertex} is no corner of any triangle.")
        return {"vertex": int(vertex), "point": [float(x) for x in self.P[vertex]], "normal": [float(x) for x in self.N[vertex]], "triangle": tri, "distance": dist}


def vertex_normals(P, F):
    t = P[F]
    fn = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    N = np.zeros_like(P)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    ln = np.linalg.norm(N, axis=1)
    ok = ln > 1e-20
    N[ok] /= ln[ok][:, None]
    N[~ok] = [0, 0, 1]
    return N


def orient_outward(P, F):
    """True when the winding decisively encloses its volume inside-out: the
    signed volume about the centroid below −0.6 % of the box."""
    if len(P) == 0:
        return False
    c = P.mean(axis=0)
    t = P[F] - c
    vol6 = float(np.einsum("ij,ij->i", t[:, 0], np.cross(t[:, 1], t[:, 2])).sum())
    lo, hi = P.min(axis=0), P.max(axis=0)
    bbox = float(np.prod(hi - lo))
    return bbox > 0 and vol6 < -6e-3 * bbox


def bfs_levels(g, seeds, accept=None, limit=None):
    """Breadth-first from the seeds, level by level: a neighbour joins when
    `accept(candidates)` passes it. Stops at `limit` members. Returns (the
    members in BFS order, whether the limit stopped it)."""
    stamp = np.zeros(g.n, dtype=bool)
    seeds = np.asarray(seeds, dtype=np.int64)
    _, first = np.unique(seeds, return_index=True)
    front = seeds[np.sort(first)]
    stamp[front] = True
    out = [front]
    total = len(front)
    capped = False
    while len(front) and not capped:
        nb, _ = g.neighbours(front)
        nb = nb[~stamp[nb]]
        if len(nb) == 0:
            break
        _, first = np.unique(nb, return_index=True)
        nb = nb[np.sort(first)]
        if accept is not None:
            nb = nb[accept(nb)]
        if limit is not None and total + len(nb) >= limit:
            nb = nb[: max(0, limit - total)]
            capped = True
        stamp[nb] = True
        out.append(nb)
        total += len(nb)
        front = nb
    return np.concatenate(out), capped
