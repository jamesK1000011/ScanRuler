# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/section/slice.ts,
# src/core/section/frame.ts, src/core/fit/linalg.ts (orthoBasis),
# src/commands/refs.ts (parsePlaneName).
#
# Cutting the scan with a plane: the polylines where its triangles cross it,
# chained by shared mesh edges (so a welded, manifold mesh gives simple paths
# and closed loops, a loop written with its first point repeated), each point
# carrying the side the material is on; and the frames a section's sheet is
# laid out along. Pure numpy.

import math

import numpy as np

EDGE_MIN_FEATURE_MM = 1.0  # src/core/flat/edges.ts


def _unit(v):
    v = np.asarray(v, dtype=float)
    L = float(np.linalg.norm(v))
    return v / L if L > 0 and math.isfinite(L) else None


def slice_mesh(V, F, origin, normal, min_length=0.0):
    """The chains where the plane through `origin` square to `normal` cuts the
    mesh: (points (n,3), offsets (c+1,), normals (n,3)). A vertex with signed
    distance 0 or more is on the positive side; a vertex exactly on the plane
    is one point, so the chain runs through it."""
    V = np.asarray(V, dtype=float)
    F = np.asarray(F, dtype=np.int64)
    empty = (np.zeros((0, 3)), np.zeros(1, dtype=np.int64), np.zeros((0, 3)))
    if len(V) == 0 or len(F) == 0:
        return empty
    n = _unit(normal)
    if n is None:
        return empty
    nv = len(V)
    dist = V @ n - float(np.dot(n, origin))
    pos = dist >= 0
    sa, sb, sc = pos[F[:, 0]], pos[F[:, 1]], pos[F[:, 2]]
    crossed = ~((sa == sb) & (sb == sc))
    tris = np.nonzero(crossed)[0]

    pts = []
    edge_point = {}
    vertex_point = {}

    def on_vertex(i):
        k = vertex_point.get(i)
        if k is None:
            k = len(pts)
            pts.append(V[i])
            vertex_point[i] = k
        return k

    def on_edge(i, j):
        di, dj = dist[i], dist[j]
        if di == 0:
            return on_vertex(i)
        if dj == 0:
            return on_vertex(j)
        key = i * nv + j if i < j else j * nv + i
        k = edge_point.get(key)
        if k is None:
            t = di / (di - dj)
            k = len(pts)
            pts.append(V[i] + t * (V[j] - V[i]))
            edge_point[key] = k
        return k

    segs = []
    seg_tri = []
    for t in tris.tolist():
        a, b, c = F[t]
        pa, pb, pc = pos[a], pos[b], pos[c]
        p = q = -1
        if pa != pb:
            p = on_edge(a, b)
        if pb != pc:
            r = on_edge(b, c)
            if p < 0:
                p = r
            else:
                q = r
        if pc != pa:
            r = on_edge(c, a)
            if p < 0:
                p = r
            else:
                q = r
        if p < 0 or q < 0 or p == q:
            continue
        segs.append((p, q))
        seg_tri.append(t)
    if not segs:
        return empty
    P = np.array(pts)
    S = np.array(segs)
    T = np.array(seg_tri)
    # The outward direction at each point: per segment, plane normal x
    # segment, turned to the side its triangle faces, summed at both ends.
    d = P[S[:, 1]] - P[S[:, 0]]
    m = np.cross(np.broadcast_to(n, d.shape), d)
    tri = V[F[T]]
    tn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    flip = (m * tn).sum(axis=1) < 0
    m[flip] *= -1
    side = np.zeros((len(P), 3))
    np.add.at(side, S[:, 0], m)
    np.add.at(side, S[:, 1], m)

    adj = [[] for _ in range(len(P))]
    for s, (p, q) in enumerate(segs):
        adj[p].append(s)
        adj[q].append(s)
    used = bytearray(len(segs))
    chains = []

    def walk(start, first):
        chain = [start]
        cur, s = start, first
        while True:
            used[s] = 1
            p, q = segs[s]
            other = q if p == cur else p
            chain.append(other)
            cur = other
            nxt = -1
            for cand in adj[cur]:
                if not used[cand]:
                    nxt = cand
                    break
            if nxt < 0:
                break
            s = nxt
        chains.append(chain)

    for p in range(len(P)):
        if len(adj[p]) == 1 and not used[adj[p][0]]:
            walk(p, adj[p][0])
    for s in range(len(segs)):
        if not used[s]:
            walk(segs[s][0], s)

    kept = []
    for ch in chains:
        if min_length > 0:
            c = P[ch]
            if np.linalg.norm(np.diff(c, axis=0), axis=1).sum() < min_length:
                continue
        kept.append(ch)
    offsets = np.zeros(len(kept) + 1, dtype=np.int64)
    idx = []
    for k, ch in enumerate(kept):
        offsets[k] = len(idx)
        idx.extend(ch)
    offsets[len(kept)] = len(idx)
    idx = np.array(idx, dtype=np.int64)
    if len(idx) == 0:
        return empty
    nrm = side[idx]
    L = np.linalg.norm(nrm, axis=1)
    good = L > 1e-12
    out_n = np.zeros_like(nrm)
    out_n[good] = nrm[good] / L[good, None]
    return P[idx], offsets, out_n


def project_cut(points, frame):
    """The cut laid flat: (n, 2) [u, v] mm in the frame of the cutting plane."""
    d = np.asarray(points, dtype=float) - np.asarray(frame["origin"])
    return np.stack([d @ np.asarray(frame["basisU"]), d @ np.asarray(frame["basisV"])], axis=1) if len(d) else np.zeros((0, 2))


def project_normals(normals, frame):
    N = np.asarray(normals, dtype=float)
    if len(N) == 0:
        return np.zeros((0, 2))
    uv = np.stack([N @ np.asarray(frame["basisU"]), N @ np.asarray(frame["basisV"])], axis=1)
    L = np.hypot(uv[:, 0], uv[:, 1])
    out = np.zeros_like(uv)
    ok = L > 1e-9
    out[ok] = uv[ok] / L[ok, None]
    return out


def chains_of(flat, offsets):
    return [flat[offsets[c]:offsets[c + 1]] for c in range(len(offsets) - 1)]


# ---- frames (frame.ts) --------------------------------------------------------------------

def ortho_basis(n):
    n = np.asarray(n, dtype=float)
    ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
    helper = np.array([1.0, 0, 0]) if ax <= ay and ax <= az else (np.array([0, 1.0, 0]) if ay <= az else np.array([0, 0, 1.0]))
    u = _unit(np.cross(n, helper))
    if u is None:
        u = np.array([0, 0, 1.0])
    v = _unit(np.cross(n, u))
    if v is None:
        v = np.array([0, 0, 1.0])
    return u, v


def in_plane_x(normal, want):
    if want is not None:
        f = _unit(np.asarray(want, dtype=float) - normal * float(np.dot(want, normal)))
        if f is not None:
            return f
    return ortho_basis(normal)[0]


AXIS_DIR = {"x": np.array([1.0, 0, 0]), "y": np.array([0, 1.0, 0]), "z": np.array([0, 0, 1.0])}
PLANE_NAME = {"x": "YZ plane", "y": "XZ plane", "z": "XY plane"}


def parse_plane_name(name):
    """"XY" (or "XY plane", "yx", "ZX") -> the axis it stands square to."""
    if not isinstance(name, str):
        return None
    key = name.strip().upper()
    for suffix in ("PLANE",):
        if key.endswith(suffix):
            key = key[: -len(suffix)].rstrip(" _-")
    if len(key) != 2 or key[0] == key[1] or any(c not in "XYZ" for c in key):
        return None
    return next(a for a in "xyz" if a.upper() not in key)


def world_cut_axis(axis, through=(0, 0, 0)):
    d = AXIS_DIR[axis]
    through = np.asarray(through, dtype=float)
    basis_u = {"x": np.array([0, 1.0, 0]), "y": np.array([0, 0, 1.0]), "z": np.array([1.0, 0, 0])}[axis]
    return {"origin": through - d * float(np.dot(through, d)), "dir": d, "basisU": basis_u}


def section_frame_along(axis, offset, seed_u=None):
    normal = _unit(axis["dir"])
    if normal is None:
        return None
    origin = np.asarray(axis["origin"], dtype=float) + normal * (offset if math.isfinite(offset) else 0.0)
    bu = in_plane_x(normal, seed_u if seed_u is not None else axis.get("basisU"))
    return {"origin": origin, "normal": normal, "basisU": bu, "basisV": np.cross(normal, bu)}


def sketch_x_axis(normal):
    a = np.abs(normal)
    nearest = 0 if a[0] >= a[1] and a[0] >= a[2] else (1 if a[1] >= a[2] else 2)
    e = np.zeros(3)
    e[(nearest + 1) % 3] = 1.0
    return e


def sketch_frame_on(origin, normal, seed_u=None):
    """The frame a CAD sketch takes on a plane: zero at the world origin's foot
    on it, X the coordinate axis next round from the one the normal is
    nearest."""
    n = _unit(normal)
    if n is None:
        return None
    o = n * float(np.dot(origin, n))
    bu = in_plane_x(n, seed_u if seed_u is not None else sketch_x_axis(n))
    return {"origin": o, "normal": n, "basisU": bu, "basisV": np.cross(n, bu)}


def radial_frame(axis, angle_deg):
    """A plane through an axis turned angle_deg about it: U out along the
    radius, V up the axis (towards + of the coordinate axis it lies nearest),
    normal U x V."""
    up = _unit(axis["dir"])
    if up is None or not math.isfinite(angle_deg):
        return None
    k = int(np.argmax(np.abs(up)))
    if up[k] < 0:
        up = -up
    zero = in_plane_x(up, sketch_x_axis(up))
    quarter = np.cross(up, zero)
    a = math.radians(angle_deg)
    bu = _unit(zero * math.cos(a) + quarter * math.sin(a))
    return {"origin": np.asarray(axis["origin"], dtype=float), "normal": np.cross(bu, up), "basisU": bu, "basisV": up}


def frame_out(f, nd=4):
    return {k: [round(float(x), nd) for x in f[k]] for k in ("origin", "normal", "basisU", "basisV")}


def lift(frame, uv):
    o, u, v = (np.asarray(frame[k], dtype=float) for k in ("origin", "basisU", "basisV"))
    return o + uv[0] * u + uv[1] * v
