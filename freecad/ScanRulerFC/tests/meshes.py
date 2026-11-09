# SPDX-License-Identifier: AGPL-3.0-only
# Synthetic meshes for the tests, numpy only. box_mesh is ScanRuler's
# tests/helpers.ts boxMesh, welded.

import numpy as np


def weld_soup(soup, tol=1e-6):
    key = np.round(np.asarray(soup) / tol).astype(np.int64)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    return uniq * tol, inv.ravel().reshape(-1, 3)


def box_mesh(size, grid=20, center=(0, 0, 0), dims=None):
    """A box `size` across (or dims), each face a grid x grid of quads,
    wound outward."""
    d = np.array(dims if dims is not None else (size, size, size), dtype=float)
    h = 0.5
    faces = [
        ((-h, -h, h), (1, 0, 0), (0, 1, 0)),
        ((-h, -h, -h), (0, 1, 0), (1, 0, 0)),
        ((h, -h, -h), (0, 1, 0), (0, 0, 1)),
        ((-h, -h, -h), (0, 0, 1), (0, 1, 0)),
        ((-h, h, -h), (0, 0, 1), (1, 0, 0)),
        ((-h, -h, -h), (1, 0, 0), (0, 0, 1)),
    ]
    tris = []
    s = np.linspace(0, 1, grid + 1)
    for o, eu, ev in faces:
        o, eu, ev = map(np.array, (o, eu, ev))
        P = o[None, None] + s[:, None, None] * eu + s[None, :, None] * ev
        a, b, c, e = P[:-1, :-1], P[1:, :-1], P[1:, 1:], P[:-1, 1:]
        tris.append(np.stack([a, b, c], axis=2).reshape(-1, 3, 3))
        tris.append(np.stack([a, c, e], axis=2).reshape(-1, 3, 3))
    soup = np.concatenate(tris).reshape(-1, 3) * d + np.asarray(center, dtype=float)
    return weld_soup(soup)


def hollow_box(outer, wall, grid=(20, 20)):
    """A closed box with a closed cavity: the inner skin wound inward."""
    V1, F1 = box_mesh(outer, grid[0])
    V2, F2 = box_mesh(outer - 2 * wall, grid[1])
    return np.vstack([V1, V2]), np.vstack([F1, F2[:, ::-1] + len(V1)])


def subdivide(V, F, edge):
    """Conforming midpoint subdivision (1 to 4) of the whole mesh until no
    edge is longer than `edge`."""
    V = np.asarray(V, dtype=float)
    F = np.asarray(F, dtype=np.int64)
    while True:
        e = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
        if np.linalg.norm(V[e[:, 0]] - V[e[:, 1]], axis=1).max() <= edge:
            return V, F
        e.sort(axis=1)
        uniq, inv = np.unique(e, axis=0, return_inverse=True)
        inv = inv.ravel()
        mids = (V[uniq[:, 0]] + V[uniq[:, 1]]) / 2
        m = inv.reshape(3, -1).T + len(V)
        V = np.vstack([V, mids])
        a, b, c = F[:, 0], F[:, 1], F[:, 2]
        ab, bc, ca = m[:, 0], m[:, 1], m[:, 2]
        F = np.concatenate([np.stack([a, ab, ca], 1), np.stack([ab, b, bc], 1), np.stack([ca, bc, c], 1), np.stack([ab, bc, ca], 1)])
