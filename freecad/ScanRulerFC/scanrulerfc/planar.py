# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: plugins/mesh-tools/core/planar.ts.
#
# Loops of the mesh lying in a plane, closed with the flat faces they bound:
# the cap a cut leaves and the fill of a long hole rim. Which loop is a face
# and which a hole in one is read off how deep each lies inside the others.
# ScanRuler triangulates with three.js's Earcut; this port uses its own ear
# clipping, holes bridged to the outer loop first - the same triangles in
# kind (no point added, every triangle between the loops' own vertices),
# not necessarily the same ones.

import numpy as np


def signed_area(P):
    x, y = P[:, 0], P[:, 1]
    return float(((np.roll(x, 1) - x) * (np.roll(y, 1) + y)).sum() / 2)


def inside(p, poly):
    c = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        a, b = poly[i], poly[j]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
        j = i
    return c


def _orient(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _cross(a, b, c, d):
    o1, o2, o3, o4 = _orient(a, b, c), _orient(a, b, d), _orient(c, d, a), _orient(c, d, b)
    return o1 * o2 < 0 and o3 * o4 < 0


def self_crossing(P):
    n = len(P)
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        for j in range(i + 2, n):
            if i == 0 and j == n - 1:
                continue
            if _cross(a, b, P[j], P[(j + 1) % n]):
                return True
    return False


def _bridge(outer, hole, pts):
    """The outer ring (a list of point ids) with a hole spliced in along the
    shortest segment from the hole's rightmost point that crosses no edge."""
    m = max(range(len(hole)), key=lambda k: pts[hole[k]][0])
    M = pts[hole[m]]
    edges = [(outer[i], outer[(i + 1) % len(outer)]) for i in range(len(outer))] + [(hole[i], hole[(i + 1) % len(hole)]) for i in range(len(hole))]
    order = sorted(range(len(outer)), key=lambda i: (pts[outer[i]][0] - M[0]) ** 2 + (pts[outer[i]][1] - M[1]) ** 2)
    pick = order[0]
    for i in order:
        P = pts[outer[i]]
        if not any(_cross(M, P, pts[a], pts[b]) for a, b in edges if outer[i] not in (a, b) and hole[m] not in (a, b)):
            pick = i
            break
    ring = hole[m:] + hole[: m + 1]
    return outer[: pick + 1] + ring + outer[pick:]


def _in_tri(p, a, b, c):
    return _orient(a, b, p) >= 0 and _orient(b, c, p) >= 0 and _orient(c, a, p) >= 0


def ear_clip(pts, outer, holes=()):
    """Triangles (triples of indices into pts, (n, 2)) filling the polygon
    `outer` (index list) minus `holes`, counter-clockwise."""
    pts = np.asarray(pts, dtype=float)
    ring = list(outer)
    if signed_area(pts[ring]) < 0:
        ring.reverse()
    for h in sorted(holes, key=lambda h: -max(pts[i][0] for i in h)):
        h = list(h)
        if signed_area(pts[h]) > 0:
            h.reverse()
        ring = _bridge(ring, h, pts)
    tris = []
    idx = list(ring)
    guard = 0
    while len(idx) > 3 and guard < 10 * len(ring) ** 2 + 100:
        guard += 1
        n = len(idx)
        clipped = False
        for k in range(n):
            a, b, c = idx[k - 1], idx[k], idx[(k + 1) % n]
            A, B, C = pts[a], pts[b], pts[c]
            if _orient(A, B, C) <= 1e-15:
                continue
            ok = True
            for q in idx:
                if q in (a, b, c):
                    continue
                Q = pts[q]
                if (Q == A).all() or (Q == B).all() or (Q == C).all():
                    continue
                if _in_tri(Q, A, B, C):
                    ok = False
                    break
            if ok:
                tris.append((a, b, c))
                idx.pop(k)
                clipped = True
                break
        if not clipped:
            # Degenerate leftovers: drop the flattest corner.
            k = min(range(n), key=lambda k: abs(_orient(pts[idx[k - 1]], pts[idx[k]], pts[idx[(k + 1) % n]])))
            idx.pop(k)
    if len(idx) == 3 and _orient(*(pts[i] for i in idx)) > 0:
        tris.append(tuple(idx))
    return tris


def _walks_with_loop(tris, loop):
    for i in range(len(loop)):
        a, b = loop[i], loop[(i + 1) % len(loop)]
        for t in tris:
            for k in range(3):
                p, q = t[k], t[(k + 1) % 3]
                if p == a and q == b:
                    return True
                if p == b and q == a:
                    return False
    return False


def fill_planar_loops(positions, loops, u, v):
    """Triangles (vertex ids) closing the loops seen square to the plane of
    u, v, wound against the mesh's own triangles on the rim; and how many
    faces were made."""
    positions = np.asarray(positions, dtype=float)
    flat = [np.stack([positions[list(l)] @ u, positions[list(l)] @ v], axis=1) for l in loops]
    areas = [abs(signed_area(f)) for f in flat]
    depth = [0] * len(flat)
    parent = [-1] * len(flat)
    for i in range(len(flat)):
        for j in range(len(flat)):
            if i == j or areas[j] <= areas[i] or not inside(flat[i][0], flat[j]):
                continue
            depth[i] += 1
            if parent[i] < 0 or areas[j] < areas[parent[i]]:
                parent[i] = j
    triangles = []
    faces = 0
    for i in range(len(flat)):
        if depth[i] % 2 != 0 or len(flat[i]) < 3 or areas[i] == 0:
            continue
        holes = [j for j in range(len(flat)) if depth[j] == depth[i] + 1 and parent[j] == i and len(flat[j]) >= 3]
        ids, pts, start = [], [], 0
        rings = []
        for k in [i] + holes:
            ring = list(range(start, start + len(loops[k])))
            rings.append(ring)
            ids += list(loops[k])
            pts.append(flat[k])
            start += len(loops[k])
        tris = ear_clip(np.vstack(pts), rings[0], rings[1:])
        if not tris:
            continue
        group = [(ids[a], ids[b], ids[c]) for a, b, c in tris]
        if _walks_with_loop(group, list(loops[i])):
            group = [(a, c, b) for a, b, c in group]
        triangles += group
        faces += 1
    return triangles, faces
