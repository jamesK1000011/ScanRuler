# SPDX-License-Identifier: AGPL-3.0-only
# Synthetic scans for the tests: surfaces tessellated on a grid with numpy,
# noise added along the normals — the shape of ScanRuler's tests/helpers.ts
# samplers, as meshes, since the fits here grow regions over a mesh.

import math

import numpy as np


def grid(fn, nu, nv, wrap_u=False, wrap_v=False):
    us = np.linspace(0, 1, nu, endpoint=not wrap_u)
    vs = np.linspace(0, 1, nv, endpoint=not wrap_v)
    U, W = np.meshgrid(us, vs, indexing="ij")
    P = fn(U.ravel(), W.ravel())
    F = []
    for i in range(nu if wrap_u else nu - 1):
        for j in range(nv if wrap_v else nv - 1):
            a = i * nv + j
            b = ((i + 1) % nu) * nv + j
            c = ((i + 1) % nu) * nv + (j + 1) % nv
            d = i * nv + (j + 1) % nv
            F += [[a, b, c], [a, c, d]]
    return P, np.array(F, dtype=np.int64)


def noisy(P, F, sigma, seed=1):
    if sigma <= 0:
        return P, F
    from scanrulerfc.meshgraph import vertex_normals

    N = vertex_normals(P, F)
    rng = np.random.default_rng(seed)
    return P + N * rng.normal(0, sigma, (len(P), 1)), F


def sphere(r=10.0, c=(0, 0, 0), n=90, m=45, sigma=0.0, cap=0.95):
    def fn(u, v):
        t = 2 * math.pi * u
        p = math.pi * (0.5 - cap / 2 + cap * v)
        return np.c_[r * np.sin(p) * np.cos(t), r * np.sin(p) * np.sin(t), r * np.cos(p)] + np.asarray(c)

    return noisy(*grid(fn, n, m, wrap_u=True), sigma)


def cylinder(r=5.0, h=20.0, n=90, m=40, sigma=0.0, inside=False):
    def fn(u, v):
        t = 2 * math.pi * u * (-1 if inside else 1)
        return np.c_[r * np.cos(t), r * np.sin(t), v * h]

    return noisy(*grid(fn, n, m, wrap_u=True), sigma)


def cone(r0=4.0, half_deg=15.0, h=12.0, n=90, m=40, sigma=0.0):
    tan = math.tan(math.radians(half_deg))

    def fn(u, v):
        t = 2 * math.pi * u
        z = v * h
        rr = r0 + z * tan
        return np.c_[rr * np.cos(t), rr * np.sin(t), z]

    return noisy(*grid(fn, n, m, wrap_u=True), sigma)


def torus(R=20.0, r=4.0, n=140, m=40, sigma=0.0):
    def fn(u, v):
        a = 2 * math.pi * u
        b = 2 * math.pi * v
        return np.c_[(R + r * np.cos(b)) * np.cos(a), (R + r * np.cos(b)) * np.sin(a), r * np.sin(b)]

    return noisy(*grid(fn, n, m, wrap_u=True, wrap_v=True), sigma)


def box(size=(40.0, 30.0, 20.0), step=1.0, sigma=0.0, seed=2):
    """A closed box, its six faces gridded and welded along the edges."""
    sx, sy, sz = size
    Ps, Fs = [], []
    off = 0
    for axis in range(3):
        for side in (0, 1):
            a, b = [k for k in range(3) if k != axis]
            na, nb = int(round(size[a] / step)) + 1, int(round(size[b] / step)) + 1

            def fn(u, v, axis=axis, side=side, a=a, b=b):
                X = np.zeros((len(u), 3))
                X[:, axis] = side * size[axis]
                X[:, a] = u * size[a]
                X[:, b] = v * size[b]
                return X

            P, F = grid(fn, na, nb)
            # Outward winding: flip where the grid's own normal points in.
            n = np.cross(P[F[0, 1]] - P[F[0, 0]], P[F[0, 2]] - P[F[0, 0]])
            if (n[axis] > 0) != (side == 1):
                F = F[:, [0, 2, 1]]
            Ps.append(P)
            Fs.append(F + off)
            off += len(P)
    P = np.concatenate(Ps)
    F = np.concatenate(Fs)
    # Weld the shared edge vertices.
    key = np.round(P / (step * 1e-3)).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    P = P[first]
    F = inv.ravel()[F]
    return noisy(P, F, sigma, seed)


def stl(path, P, F):
    """An ASCII STL of the mesh, for FreeCAD to read."""
    with open(path, "w") as fh:
        fh.write("solid s\n")
        for t in F:
            a, b, c = P[t]
            n = np.cross(b - a, c - a)
            ln = np.linalg.norm(n) or 1
            n = n / ln
            fh.write(f"facet normal {n[0]} {n[1]} {n[2]}\nouter loop\n")
            for p in (a, b, c):
                fh.write(f"vertex {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}\n")
            fh.write("endloop\nendfacet\n")
        fh.write("endsolid s\n")
