# SPDX-License-Identifier: AGPL-3.0-only
# Test meshes for ScanRuler for FreeCAD, as ScanRuler's own tests build them
# (tests/helpers.ts boxMesh, cylinderMesh): welded, outward-wound, numpy only.
import struct
import zlib

import numpy as np


def weld(V, F, digits=6):
    key = np.round(V, digits)
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    out = np.zeros((len(uniq), 3))
    out[inv] = V
    return out, inv[F]


def box_mesh(sx, sy, sz, n=8, center=(0, 0, 0)):
    """A closed box sx x sy x sz centred on `center`, each face an n x n grid."""
    Vs, Fs = [], []
    h = np.array([sx, sy, sz]) / 2
    for axis in range(3):
        for sign in (-1, 1):
            u, v = [(axis + 1) % 3, (axis + 2) % 3]
            g = np.linspace(-1, 1, n + 1)
            uu, vv = np.meshgrid(g, g, indexing="ij")
            P = np.zeros((n + 1, n + 1, 3))
            P[..., axis] = sign * h[axis]
            P[..., u] = uu * h[u]
            P[..., v] = vv * h[v]
            base = sum(len(x) for x in Vs)
            Vs.append(P.reshape(-1, 3))
            idx = np.arange((n + 1) * (n + 1)).reshape(n + 1, n + 1) + base
            a, b, c, d = idx[:-1, :-1], idx[1:, :-1], idx[1:, 1:], idx[:-1, 1:]
            t1 = np.stack([a, b, c], -1).reshape(-1, 3)
            t2 = np.stack([a, c, d], -1).reshape(-1, 3)
            T = np.vstack([t1, t2])
            if sign < 0:
                T = T[:, [0, 2, 1]]
            Fs.append(T)
    V, F = weld(np.vstack(Vs), np.vstack(Fs))
    return V + np.asarray(center, dtype=float), F


def cylinder_mesh(r, h, seg=96, rows=8, closed=True):
    """A cylinder of radius r round Z from z = -h/2 to h/2."""
    t = np.arange(seg) * 2 * np.pi / seg
    zs = np.linspace(-h / 2, h / 2, rows + 1)
    V = [[r * np.cos(a), r * np.sin(a), z] for z in zs for a in t]
    F = []
    for i in range(rows):
        for j in range(seg):
            a, b = i * seg + j, i * seg + (j + 1) % seg
            c, d = b + seg, a + seg
            F += [[a, b, c], [a, c, d]]
    if closed:
        bot, top = len(V), len(V) + 1
        V += [[0, 0, -h / 2], [0, 0, h / 2]]
        for j in range(seg):
            F.append([bot, (j + 1) % seg, j])
            F.append([top, rows * seg + j, rows * seg + (j + 1) % seg])
    return np.array(V, dtype=float), np.array(F, dtype=np.int64)


def volume(V, F):
    t = V[F]
    return float(np.einsum("ij,ij->i", t[:, 0], np.cross(t[:, 1], t[:, 2])).sum() / 6)


def subdivide(V, F, max_edge):
    """Every triangle split in four until no edge is longer than max_edge."""
    V = np.asarray(V, dtype=float)
    F = np.asarray(F, dtype=np.int64)
    while True:
        e = np.linalg.norm(V[F[:, [1, 2, 0]]] - V[F], axis=2).max()
        if e <= max_edge:
            return V, F
        mids = {}
        newV = list(V)

        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in mids:
                mids[k] = len(newV)
                newV.append((V[a] + V[b]) / 2)
            return mids[k]

        out = []
        for a, b, c in F.tolist():
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            out += [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]
        V, F = np.array(newV), np.array(out, dtype=np.int64)


def write_stl(path, V, F):
    t = V[F]
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    with open(path, "wb") as f:
        f.write(b"\0" * 80 + struct.pack("<I", len(F)))
        for k in range(len(F)):
            f.write(struct.pack("<12fH", *n[k], *t[k, 0], *t[k, 1], *t[k, 2], 0))


def write_png(path, gray, ppm=None):
    """An 8-bit grayscale PNG of `gray` (rows top first), with a pHYs chunk
    of `ppm` pixels per metre when given."""
    h, w = gray.shape

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    raw = b"".join(b"\0" + bytes(row) for row in gray.astype(np.uint8))
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
    if ppm:
        data += chunk(b"pHYs", struct.pack(">IIB", ppm, ppm, 1))
    data += chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)
