# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen, the Mesh Tools plugin (Stefan
# Hermann's): plugins/mesh-tools/core/pieces.ts, boundary.ts, edit.ts,
# flip.ts, cut.ts, cutPlane.ts (middleOffset), mirror.ts, fillHoles.ts,
# smooth.ts, offset.ts and evenMove.ts (the whole-mesh move), select.ts,
# round125.ts, boolean.ts (closedness) and worker.ts (describe).
#
# Every edit hands back the mesh as it is to be, on the vertices it still
# uses (compact_edit). Pure numpy; meshes are V (n, 3) float, F (m, 3) int.

import math

import numpy as np

from . import planar
from .section_core import ortho_basis


class MeshError(Exception):
    """An edit the mesh cannot take, with a message for the person."""


def round125(x):
    if not (x > 0):
        return 0.1
    e = math.floor(math.log10(x))
    m = x / 10 ** e
    step = 1 if m <= 1 else 2 if m <= 2 else 5 if m <= 5 else 10
    return float(f"{step * 10 ** e:.{max(0, -e)}f}")


def diagonal(V):
    return float(np.linalg.norm(V.max(axis=0) - V.min(axis=0))) if len(V) else 0.0


def default_min_piece(diag):
    return round125(diag * 0.01)


def default_hole_size(diag):
    return round125(diag * 0.05)


def default_tolerance(diag):
    return round125(diag * 2.5e-4)


def mean_edge_length(V, F, samples=4096):
    if len(F) == 0:
        return 0.0
    stride = max(1, len(F) // samples)
    T = V[F[::stride]]
    return float(np.linalg.norm(T[:, [1, 2, 0]] - T, axis=2).mean())


def default_smooth_size(diag, edge=0.0):
    return round125(max(diag * 0.008, edge * 2.5))


def default_smooth_limit(diag):
    return round125(diag * 1e-3)


def compact_edit(V, F, vertex_count):
    """The mesh on the vertices its triangles use; old vertices first in their
    order, then new ones; vertexMap old -> new (or -1)."""
    V = np.asarray(V, dtype=float)
    F = np.asarray(F, dtype=np.int64).reshape(-1, 3)
    used = np.zeros(len(V), dtype=bool)
    used[F.reshape(-1)] = True
    remap = np.full(len(V), -1, dtype=np.int64)
    remap[used] = np.arange(int(used.sum()))
    return V[used], remap[F], remap[:vertex_count]


# ---- reading the mesh -------------------------------------------------------------------

def _edge_counts(F, nv):
    a = F.reshape(-1)
    b = F[:, [1, 2, 0]].reshape(-1)
    key = a * nv + b
    uniq, counts = np.unique(key, return_counts=True)
    return a, b, key, uniq, counts


def _count_of(uniq, counts, keys):
    i = np.searchsorted(uniq, keys)
    i = np.clip(i, 0, len(uniq) - 1)
    hit = uniq[i] == keys
    return np.where(hit, counts[i], 0)


def closedness(F, nv):
    """open: half-edges no triangle walks back; bad: edges more than two
    triangles share (boolean.ts)."""
    if len(F) == 0:
        return {"open": 0, "bad": 0}
    a, b, key, uniq, counts = _edge_counts(F, nv)
    same = _count_of(uniq, counts, key)
    back = _count_of(uniq, counts, b * nv + a)
    open_ = int((back == 0).sum())
    bad = int((((same > 1) | (back > 1)) & (back > 0) & (a < b)).sum())
    return {"open": open_, "bad": bad}


def describe(V, F):
    shut = closedness(F, len(V))
    out = {"vertices": int(len(V)), "triangles": int(len(F)),
           "bounds": {"min": [round(float(x), 4) for x in V.min(axis=0)], "max": [round(float(x), 4) for x in V.max(axis=0)]} if len(V) else None,
           **shut}
    if shut["open"] == 0 and shut["bad"] == 0 and len(F):
        t = V[F]
        out["volume"] = float(np.einsum("ij,ij->i", t[:, 0], np.cross(t[:, 1], t[:, 2])).sum() / 6)
    else:
        out["volume"] = None
    return out


def components(F, nv):
    """A label per vertex: the connected piece it is in (min-label
    propagation with pointer jumping, in place of ScanRuler's union-find)."""
    lab = np.arange(nv)
    if len(F) == 0:
        return lab
    while True:
        m = lab[F].min(axis=1)
        old = lab.copy()
        for k in range(3):
            np.minimum.at(lab, F[:, k], m)
        while True:
            nxt = lab[lab]
            if np.array_equal(nxt, lab):
                break
            lab = nxt
        if np.array_equal(old, lab):
            return lab


def survey_pieces(V, F, min_size):
    lab = components(F, len(V))
    used = np.zeros(len(V), dtype=bool)
    used[F.reshape(-1)] = True
    roots = np.unique(lab[used])
    islands, centres, largest, smallest = [], [], None, None
    small_root = set()
    for r in roots.tolist():
        P = V[(lab == r) & used]
        lo, hi = P.min(axis=0), P.max(axis=0)
        size = float(np.linalg.norm(hi - lo))
        if size < min_size:
            small_root.add(r)
            centres.append(((lo + hi) / 2).tolist())
            largest = size if largest is None else max(largest, size)
        else:
            smallest = size if smallest is None else min(smallest, size)
    mask = np.isin(lab[F[:, 0]], list(small_root)) if small_root else np.zeros(len(F), dtype=bool)
    return {"pieces": len(roots), "islands": len(small_root), "islandTriangles": int(mask.sum()), "largestIsland": largest, "smallestKept": smallest}, mask, centres


def without_triangles(V, F, drop):
    return compact_edit(V, F[~drop], len(V))


def boundary_loops(F, nv):
    """Every rim as a simple closed loop: (vertices, opposite) in the direction
    the open half-edges run (boundary.ts)."""
    if len(F) == 0:
        return [], 0
    a, b, key, uniq, counts = _edge_counts(F, nv)
    same = _count_of(uniq, counts, key)
    back = _count_of(uniq, counts, b * nv + a)
    third = F[:, [2, 0, 1]].reshape(-1)
    is_open = (same == 1) & (back == 0)
    out_edges = {}
    for h in np.nonzero(is_open)[0].tolist():
        out_edges.setdefault(int(a[h]), []).append((int(b[h]), int(third[h])))
    loops, stray = [], 0
    at = {}
    while out_edges:
        start = next(iter(out_edges))
        path, opp = [], []
        v = start
        while True:
            lst = out_edges.get(v)
            if not lst:
                stray += len(path)
                for x in path:
                    at.pop(x, None)
                break
            w, t = lst.pop(0)
            if not lst:
                del out_edges[v]
            at[v] = len(path)
            path.append(v)
            opp.append(t)
            if w in at:
                fr = at[w]
                if len(path) - fr >= 3:
                    loops.append((path[fr:], opp[fr:]))
                else:
                    stray += len(path) - fr
                for x in path[fr:]:
                    at.pop(x, None)
                del path[fr:]
                del opp[fr:]
                if not path:
                    break
            v = w
    return loops, stray


def loop_size(V, loop):
    P = V[list(loop)]

    def furthest(i):
        d = np.linalg.norm(P - P[i], axis=1)
        k = int(np.argmax(d))
        return k, float(d[k])

    a, _ = furthest(0)
    b, ab = furthest(a)
    _, bc = furthest(b)
    return max(ab, bc)


def survey_holes(V, F, max_size):
    loops, _ = boundary_loops(F, len(V))
    holes, centres, largest, smallest = 0, [], None, None
    for lv, _ in loops:
        s = loop_size(V, lv)
        if s < max_size:
            holes += 1
            centres.append(V[lv].mean(axis=0).tolist())
            largest = s if largest is None else max(largest, s)
        else:
            smallest = s if smallest is None else min(smallest, s)
    return {"rims": len(loops), "holes": holes, "largestHole": largest, "smallestOpen": smallest}, centres


# ---- regions (select.ts) ------------------------------------------------------------------

DEFAULT_FACING_DEG = 30


def vertex_normals(V, F):
    t = V[F]
    n = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    out = np.zeros_like(V)
    for k in range(3):
        np.add.at(out, F[:, k], n)
    L = np.linalg.norm(out, axis=1)
    ok = L > 0
    out[ok] /= L[ok, None]
    return out


def select_vertices(V, F, region):
    shapes = [k for k in ("box", "sphere", "vertices") if region.get(k) is not None]
    if len(shapes) != 1:
        raise MeshError("Name the region one way: a box, a sphere or vertices — with facing and angleDeg to narrow it.")
    keep = np.zeros(len(V), dtype=bool)
    if region.get("vertices") is not None:
        vs = np.asarray(region["vertices"], dtype=np.int64)
        bad = vs[(vs < 0) | (vs >= len(V))]
        if len(bad):
            raise MeshError(f"The mesh has no vertex {int(bad[0])} — it has {len(V)}.")
        keep[vs] = True
    elif region.get("box") is not None:
        lo, hi = np.asarray(region["box"]["min"], dtype=float), np.asarray(region["box"]["max"], dtype=float)
        if not np.all(lo <= hi):
            raise MeshError("The box's min corner must not lie past its max corner.")
        keep = np.all((V >= lo) & (V <= hi), axis=1)
    else:
        c, r = np.asarray(region["sphere"]["center"], dtype=float), float(region["sphere"]["radius"])
        keep = np.linalg.norm(V - c, axis=1) <= r
    if region.get("facing") is not None:
        f = np.asarray(region["facing"], dtype=float)
        if not np.linalg.norm(f) > 0:
            raise MeshError("The direction to face has no length.")
        f = f / np.linalg.norm(f)
        keep &= vertex_normals(V, F) @ f >= math.cos(math.radians(region.get("angleDeg", DEFAULT_FACING_DEG)))
    return np.nonzero(keep)[0]


def marked_triangles(F, vertices, nv):
    m = np.zeros(nv, dtype=bool)
    m[np.asarray(vertices, dtype=np.int64)] = True
    return m[F].all(axis=1)


# ---- flip, mirror, cut --------------------------------------------------------------------

def flip_triangles(V, F, mask=None):
    out = F.copy()
    sel = np.ones(len(F), dtype=bool) if mask is None else mask
    out[sel] = out[sel][:, [0, 2, 1]]
    return V.copy(), out, np.arange(len(V)), int(sel.sum())


def plane_sides(V, F, origin, normal):
    n = np.asarray(normal, dtype=float)
    L = float(np.linalg.norm(n))
    if not L > 0:
        raise MeshError("The cut plane has no direction.")
    n = n / L
    eps = max(float(np.abs(V).max()) * 5e-7, 1e-9) if len(V) else 1e-9
    s = (V - np.asarray(origin, dtype=float)) @ n
    side = np.where(s > eps, 1, np.where(s < -eps, -1, 0)).astype(np.int8)
    used = side[F.reshape(-1)]
    return {"n": n, "s": s, "side": side, "anyGoes": bool((used > 0).any()), "anyStays": bool((used < 0).any())}


def clip(V, F, plane, at_plane=False):
    """The mesh clipped to the side that stays (side <= 0), crossings made once
    per edge, points of the cut snapped onto the plane."""
    n, s, side = plane["n"], plane["s"], plane["side"]
    nv = len(V)
    extra = []
    crossings = {}

    def crossing(p, q):
        key = (p, q) if p < q else (q, p)
        k = crossings.get(key)
        if k is None:
            t = s[p] / (s[p] - s[q])
            extra.append(V[p] + t * (V[q] - V[p]))
            k = nv + len(extra) - 1
            crossings[key] = k
        return k

    sa, sb, sc = side[F[:, 0]], side[F[:, 1]], side[F[:, 2]]
    stays = (sa <= 0) & (sb <= 0) & (sc <= 0)
    goes = (sa >= 0) & (sb >= 0) & (sc >= 0) & ~stays
    if at_plane:
        on = (sa == 0).astype(int) + (sb == 0) + (sc == 0)
        out = [tuple(t) for t in F[stays & (on >= 2)].tolist()]
    else:
        out = [tuple(t) for t in F[stays].tolist()]
    removed = int(goes.sum())
    split_idx = np.nonzero(~stays & ~goes)[0]
    for t in split_idx.tolist():
        c = F[t].tolist()
        poly = []
        for k in range(3):
            p, q = c[k], c[(k + 1) % 3]
            if side[p] <= 0:
                poly.append(p)
            if side[p] * side[q] < 0:
                poly.append(crossing(p, q))
        for k in range(1, len(poly) - 1):
            out.append((poly[0], poly[k], poly[k + 1]))
    allV = np.vstack([V, np.array(extra).reshape(-1, 3)])
    on_plane = np.zeros(len(allV), dtype=bool)
    z = np.nonzero(side == 0)[0]
    on_plane[z] = True
    allV[z] -= s[z, None] * n
    on_plane[nv:] = True
    return out, allV, on_plane, removed, len(split_idx)


MAX_BRIDGE_SHARE = 0.1


def _plane_rim(tris, on_plane):
    uses = {}
    for t in tris:
        for k in range(3):
            a, b = t[k], t[(k + 1) % 3]
            if on_plane[a] and on_plane[b]:
                uses[(a, b)] = uses.get((a, b), 0) + 1
    nxt, incoming = {}, {}
    for (a, b), c in uses.items():
        if c != 1 or (b, a) in uses:
            continue
        nxt.setdefault(a, []).append(b)
        incoming[b] = incoming.get(b, 0) + 1
    loops, stretches = [], []

    def take(a):
        lst = nxt.get(a)
        b = lst.pop() if lst else None
        if lst is not None and not lst:
            del nxt[a]
        return b

    heads = [v for v in nxt if v not in incoming]
    while nxt:
        start = heads.pop() if heads else None
        while start is not None and start not in nxt:
            start = heads.pop() if heads else None
        if start is None:
            start = next(iter(nxt))
        path, at, a = [start], {start: 0}, start
        while True:
            b = take(a)
            if b is None:
                if len(path) >= 2:
                    stretches.append(path)
                break
            seen = at.get(b)
            if seen is not None:
                loop = path[seen:]
                if len(loop) >= 3:
                    loops.append(loop)
                for v in loop:
                    at.pop(v, None)
                del path[seen:]
                if not path:
                    break
                at[b] = len(path)
                path.append(b)
                a = b
                continue
            at[b] = len(path)
            path.append(b)
            a = b
    return loops, stretches


def _bridge_stretches(stretches, P):
    def dist(a, b):
        return float(np.linalg.norm(P[a] - P[b]))

    used = [False] * len(stretches)
    loops, bridged, open_ = [], 0, []
    for i in range(len(stretches)):
        if used[i]:
            continue
        used[i] = True
        loop, pieces, gaps, gap_len = list(stretches[i]), [i], 0, 0.0
        while True:
            tail = loop[-1]
            best, nx = dist(tail, loop[0]), -1
            for j in range(len(stretches)):
                if not used[j]:
                    d = dist(tail, stretches[j][0])
                    if d < best:
                        best, nx = d, j
            gaps += 1
            gap_len += best
            if nx < 0:
                break
            used[nx] = True
            loop += stretches[nx]
            pieces.append(nx)
        per = sum(dist(loop[k], loop[(k + 1) % len(loop)]) for k in range(len(loop)))
        if len(loop) >= 3 and gap_len <= MAX_BRIDGE_SHARE * per:
            loops.append(loop)
            bridged += gaps
        else:
            open_ += [stretches[k] for k in pieces]
    return loops, bridged, open_


def cap_of(tris, P, on_plane, n):
    loops, stretches = _plane_rim(tris, on_plane)
    joined, bridged, open_ = _bridge_stretches(stretches, P)
    loops = loops + joined
    faces, capped = [], 0
    if loops:
        u, v = ortho_basis(n)
        faces, capped = planar.fill_planar_loops(P, loops, u, v)
    return faces, capped, bridged, open_


def cut_mesh(V, F, origin, normal, cap=True):
    """Everything on the side `normal` points to taken off; the part closed
    flat where the plane crosses it all the way round (cap)."""
    plane = plane_sides(V, F, origin, normal)
    if not plane["anyGoes"]:
        raise MeshError("The plane cuts nothing off — all of the scan is on the side that stays.")
    if not plane["anyStays"]:
        raise MeshError("Nothing of the scan is on the side that stays — flip the side to keep.")
    out, P, on, removed, split = clip(V, F, plane)
    capped = cap_tris = bridged = open_n = 0
    if cap:
        faces, capped, bridged, open_ = cap_of(out, P, on, plane["n"])
        cap_tris, open_n = len(faces), len(open_)
        out = out + list(faces)
    V2, F2, vmap = compact_edit(P, np.array(out, dtype=np.int64).reshape(-1, 3), len(V))
    return V2, F2, vmap, {"removed": removed, "split": split, "capped": capped, "capTriangles": cap_tris, "open": open_n, "bridged": bridged}


def cut_preview(V, F, origin, normal):
    plane = plane_sides(V, F, origin, normal)
    if not plane["anyGoes"] or not plane["anyStays"]:
        return {"cuts": False, "capped": 0, "bridged": 0, "open": 0}
    out, P, on, _, _ = clip(V, F, plane, True)
    faces, capped, bridged, open_ = cap_of(out, P, on, plane["n"])
    return {"cuts": True, "capped": capped, "bridged": bridged, "open": len(open_)}


def middle_offset(raw, size=0.0):
    if not size > 0:
        return round(raw, 3) or 0.0
    step = round125(size / 100)
    places = max(0, -math.floor(math.log10(step)))
    return float(f"{round(raw / step) * step:.{places}f}") or 0.0


def _reflect(P, o, n):
    d2 = 2 * ((P - o) @ n)
    return P - d2[:, None] * n


def mirror_mesh(V, F, origin, normal, mode):
    n = np.asarray(normal, dtype=float)
    if not np.linalg.norm(n) > 0:
        raise MeshError("The mirror plane has no direction.")
    n = n / np.linalg.norm(n)
    o = np.asarray(origin, dtype=float)
    if mode == "whole":
        return _reflect(V, o, n), F[:, [0, 2, 1]].copy(), np.arange(len(V)), {"mode": "whole", "mirrored": len(F), "removed": 0, "split": 0, "inPlane": 0}
    plane = plane_sides(V, F, o, n)
    nothing = "Nothing of the part is on the side to keep — keep the other side."
    if not plane["anyStays"]:
        raise MeshError(nothing)
    out, P, on, removed, split = clip(V, F, plane)
    kept = [t for t in out if not (on[t[0]] and on[t[1]] and on[t[2]])]
    in_plane = len(out) - len(kept)
    if not kept:
        raise MeshError(nothing)
    K = np.array(kept, dtype=np.int64)
    total = len(P)
    twin = np.full(total, -1, dtype=np.int64)
    vs = np.unique(K)
    onv = vs[on[vs]]
    twin[onv] = onv
    off = vs[~on[vs]]
    twin[off] = total + np.arange(len(off))
    extra = _reflect(P[off], o, n)
    mirrored = twin[K][:, [0, 2, 1]]
    V2, F2, vmap = compact_edit(np.vstack([P, extra]), np.vstack([K, mirrored]), len(V))
    return V2, F2, vmap, {"mode": "symmetric", "mirrored": len(kept), "removed": removed, "split": split, "inPlane": in_plane}


# ---- fill holes (fillHoles.ts, after Liepa 2003) ------------------------------------------

SEARCH_LIMIT = 500
MAX_PATCH_POINTS = 250_000
MAX_FAIR_ITERATIONS = 600


def _unit_normals(A, B, C):
    n = np.cross(B - A, C - A)
    L = np.linalg.norm(n, axis=-1)
    out = np.zeros_like(n)
    ok = L > 1e-300
    out[ok] = n[ok] / L[ok, None]
    return out, L


def _search_triangulation(pos, V, opposite):
    """The rim triangulation that bends least (min-max dihedral, then least
    area) by dynamic programming over sub-polygons; triangles (i, j, k) wound
    against the rim."""
    n = len(pos)
    rim, _ = _unit_normals(pos, np.roll(pos, -1, axis=0), V[opposite])
    worst = np.ones((n, n))
    area = np.zeros((n, n))
    best = np.full((n, n), -1, dtype=np.int64)
    normal = np.zeros((n, n, 3))

    def cos_with(buf, nt):
        z = np.all(buf == 0, axis=-1)
        return np.where(z, 1.0, (buf * nt).sum(axis=-1))

    for span in range(2, n):
        for i in range(0, n - span):
            j = i + span
            k = np.arange(i + 1, j)
            nt, a2 = _unit_normals(pos[i][None], pos[j][None], pos[k])
            c = np.where(a2 > 0, 1.0, -1.0)
            c = np.minimum(c, np.minimum(worst[i, k], worst[k, j]))
            left = np.where(k[:, None] == i + 1, rim[i][None], normal[i, k])
            right = np.where(k[:, None] + 1 == j, rim[k], normal[k, j])
            c = np.minimum(c, cos_with(left, nt))
            c = np.minimum(c, cos_with(right, nt))
            if i == 0 and j == n - 1:
                c = np.minimum(c, cos_with(np.broadcast_to(rim[n - 1], nt.shape), nt))
            ar = area[i, k] + area[k, j] + a2 / 2
            top = c.max()
            cand = np.nonzero(c >= top - 1e-12)[0]
            pick = cand[int(np.argmin(ar[cand]))]
            worst[i, j] = c[pick]
            area[i, j] = ar[pick]
            best[i, j] = k[pick]
            normal[i, j] = nt[pick]
    tris = []
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        k = int(best[i, j])
        tris += [i, j, k]
        stack += [(i, k), (k, j)]
    return tris


def _flat_triangulation(pos):
    n = len(pos)
    P1 = np.roll(pos, -1, axis=0)
    nx = ((pos[:, 1] - P1[:, 1]) * (pos[:, 2] + P1[:, 2])).sum()
    ny = ((pos[:, 2] - P1[:, 2]) * (pos[:, 0] + P1[:, 0])).sum()
    nz = ((pos[:, 0] - P1[:, 0]) * (pos[:, 1] + P1[:, 1])).sum()
    L = math.hypot(nx, ny, nz)
    if not L > 0:
        return None
    u, v = ortho_basis(np.array([nx, ny, nz]) / L)
    flat = np.stack([pos @ u, pos @ v], axis=1)
    if planar.self_crossing(flat):
        return None
    tris, faces = planar.fill_planar_loops(pos, [list(range(n))], u, v)
    return [x for t in tris for x in t] if faces else None


class _Patch:
    def __init__(self, pos, tris):
        self.pos = [list(p) for p in pos]
        self.tris = list(tris)
        self.edges = {}
        for t in range(len(self.tris) // 3):
            self._index(t, True)

    def count(self):
        return len(self.tris) // 3

    def walking(self, a, b):
        return self.edges.get((a, b))

    def set(self, t, a, b, c):
        if t * 3 < len(self.tris):
            self._index(t, False)
            self.tris[t * 3:t * 3 + 3] = [a, b, c]
        else:
            self.tris += [a, b, c]
        self._index(t, True)

    def add(self, a, b, c):
        self.set(self.count(), a, b, c)

    def third(self, t, a, b):
        for v in self.tris[t * 3:t * 3 + 3]:
            if v != a and v != b:
                return v
        return -1

    def _index(self, t, on):
        for k in range(3):
            a, b = self.tris[t * 3 + k], self.tris[t * 3 + (k + 1) % 3]
            if on:
                self.edges[(a, b)] = t
            elif self.edges.get((a, b)) == t:
                del self.edges[(a, b)]


def _angle_at(p, c, a, b):
    u, v = np.subtract(p[a], p[c]), np.subtract(p[b], p[c])
    lu, lv = np.linalg.norm(u), np.linalg.norm(v)
    if not (lu > 0 and lv > 0):
        return 0.0
    return math.acos(max(-1.0, min(1.0, float(u @ v) / (lu * lv))))


def _un(p, a, b, c):
    n = np.cross(np.subtract(p[b], p[a]), np.subtract(p[c], p[a]))
    L = np.linalg.norm(n)
    return (n / L, True) if L > 1e-300 else (np.zeros(3), False)


def _flip_if_better(m, a, b):
    t1, t2 = m.walking(a, b), m.walking(b, a)
    if t1 is None or t2 is None:
        return False
    c, d = m.third(t1, a, b), m.third(t2, a, b)
    if c < 0 or d < 0 or c == d:
        return False
    if m.walking(c, d) is not None or m.walking(d, c) is not None:
        return False
    p = m.pos
    if _angle_at(p, c, a, b) + _angle_at(p, d, a, b) <= math.pi + 1e-9:
        return False
    b1, _ = _un(p, a, b, c)
    b2, _ = _un(p, b, a, d)
    a1, ok1 = _un(p, d, b, c)
    a2, ok2 = _un(p, c, a, d)
    if not ok1 or not ok2 or a1 @ a2 <= 0 or (a1 + a2) @ (b1 + b2) <= 0:
        return False
    m.set(t1, d, b, c)
    m.set(t2, c, a, d)
    return True


def _relax_all(m):
    queue = []
    for t in range(m.count()):
        for k in range(3):
            a, b = m.tris[t * 3 + k], m.tris[t * 3 + (k + 1) % 3]
            if a < b:
                queue += [a, b]
    budget = 8 * len(queue)
    while queue and budget > 0:
        budget -= 1
        b = queue.pop()
        a = queue.pop()
        t1, t2 = m.walking(a, b), m.walking(b, a)
        if t1 is None or t2 is None:
            continue
        c, d = m.third(t1, a, b), m.third(t2, a, b)
        if _flip_if_better(m, a, b):
            queue += [a, c, c, b, b, d, d, a]


def _refine(m, sigma):
    alpha = math.sqrt(2)
    for _ in range(64):
        splits = 0
        for t in range(m.count()):
            if len(m.pos) >= MAX_PATCH_POINTS:
                return
            a, b, c = m.tris[t * 3:t * 3 + 3]
            P = np.array([m.pos[a], m.pos[b], m.pos[c]])
            g = P.mean(axis=0)
            sg = (sigma[a] + sigma[b] + sigma[c]) / 3
            if not all(alpha * np.linalg.norm(g - P[i]) > sg and alpha * np.linalg.norm(g - P[i]) > sigma[v] for i, v in enumerate((a, b, c))):
                continue
            gi = len(m.pos)
            m.pos.append(list(g))
            sigma.append(sg)
            m.set(t, a, b, gi)
            m.add(b, c, gi)
            m.add(c, a, gi)
            _flip_if_better(m, a, b)
            _flip_if_better(m, b, c)
            _flip_if_better(m, c, a)
            splits += 1
        _relax_all(m)
        if splits == 0:
            return


def _cg(apply, b, x, diag, iters):
    inv = np.where(diag > 0, 1 / np.where(diag > 0, diag, 1), 1.0)
    r = b - apply(x)
    z = r * inv
    p = z.copy()
    rz, rr, bb = r @ z, r @ r, b @ b
    stop = max(bb, 1e-30) * 1e-20
    for _ in range(iters):
        if not rr > stop:
            break
        ap = apply(p)
        pap = p @ ap
        if not pap > 0:
            return x
        alpha = rz / pap
        x = x + alpha * p
        r = r - alpha * ap
        z = r * inv
        nrz = r @ z
        rr = r @ r
        p = z + (nrz / rz) * p
        rz = nrz
    return x


def _fair(m, rim_count, V, rim, nbrs_of, mode, iters):
    local = len(m.pos)
    free = local - rim_count
    if free <= 0:
        return
    x = [list(p) for p in m.pos]
    neighbours = [set() for _ in range(local)]
    for t in range(m.count()):
        for k in range(3):
            a, b = m.tris[t * 3 + k], m.tris[t * 3 + (k + 1) % 3]
            neighbours[a].add(b)
            neighbours[b].add(a)
    rows = list(range(rim_count, local))
    if mode == "curved":
        rim_local = {int(g): i for i, g in enumerate(rim)}
        ring = {}
        for i in range(rim_count):
            for u in nbrs_of(int(rim[i])):
                idx = rim_local.get(u)
                if idx is None:
                    idx = ring.get(u)
                    if idx is None:
                        idx = len(x)
                        ring[u] = idx
                        x.append(list(V[u]))
                neighbours[i].add(idx)
            rows.append(i)
    X = np.array(x)
    # A as entries (row, col of the free unknowns, value), the fixed points'
    # share moved to the right-hand side.
    R, C, W = [], [], []
    fixed_rows, fixed_cols, fixed_w = [], [], []
    for r_i, v in enumerate(rows):
        nb = list(neighbours[v])
        w = 1.0 / len(nb)
        if rim_count <= v < local:
            R.append(r_i), C.append(v - rim_count), W.append(1.0)
        else:
            fixed_rows.append(r_i), fixed_cols.append(v), fixed_w.append(1.0)
        for q in nb:
            if rim_count <= q < local:
                R.append(r_i), C.append(q - rim_count), W.append(-w)
            else:
                fixed_rows.append(r_i), fixed_cols.append(q), fixed_w.append(-w)
    R, C, W = np.array(R), np.array(C), np.array(W)
    FR, FC, FW = np.array(fixed_rows, dtype=np.int64), np.array(fixed_cols, dtype=np.int64), np.array(fixed_w)
    nr = len(rows)

    def A(xf):
        return np.bincount(R, W * xf[C], minlength=nr)

    def At(y):
        return np.bincount(C, W * y[R], minlength=free)

    diag = np.bincount(C, W * W, minlength=free)
    for axis in range(3):
        c = np.bincount(FR, FW * X[FC, axis], minlength=nr) if len(FR) else np.zeros(nr)
        b = -At(c)
        xf = X[rim_count:local, axis].copy()
        xf = _cg(lambda q: At(A(q)), b, xf, diag, iters)
        for i in range(free):
            m.pos[rim_count + i][axis] = float(xf[i])


def _patch_for(V, loop, opposite, nbrs_of, mode):
    n = len(loop)
    pos = V[loop]
    if n == 3:
        tris = [0, 2, 1]
    elif n <= SEARCH_LIMIT:
        tris = _search_triangulation(pos, V, np.asarray(opposite))
    else:
        tris = _flat_triangulation(pos)
    if not tris:
        return None
    nxt = np.roll(pos, -1, axis=0)
    prv = np.roll(pos, 1, axis=0)
    sigma = ((np.linalg.norm(pos - prv, axis=1) + np.linalg.norm(nxt - pos, axis=1)) / 2).tolist()
    m = _Patch(pos, tris)
    _refine(m, sigma)
    free = len(m.pos) - n
    _fair(m, n, V, loop, nbrs_of, mode, min(MAX_FAIR_ITERATIONS, 50 + 2 * free))
    return m.pos, m.tris


def fill_holes(V, F, max_size, mode="curved", at=None):
    if not max_size > 0:
        raise MeshError("The size must be more than zero.")
    loops, _ = boundary_loops(F, len(V))
    holes = [l for l in loops if loop_size(V, l[0]) < max_size]
    if not holes:
        raise MeshError("No hole in the scan is smaller than that.")
    if at is not None:
        holes = [min(holes, key=lambda l: float(np.linalg.norm(V[l[0]].mean(axis=0) - np.asarray(at))))]
    # One ring of the scan round each rim vertex, for the curved fairing.
    a, b = F.reshape(-1), F[:, [1, 2, 0]].reshape(-1)
    order = np.argsort(a, kind="stable")
    sa, sb = a[order], b[order]
    starts = np.searchsorted(sa, np.arange(len(V) + 1))
    back_order = np.argsort(b, kind="stable")
    ta, tb = b[back_order], a[back_order]
    tstarts = np.searchsorted(ta, np.arange(len(V) + 1))

    def nbrs_of(v):
        return set(sb[starts[v]:starts[v + 1]].tolist()) | set(tb[tstarts[v]:tstarts[v + 1]].tolist())

    extra, added, filled, failed = [], [], 0, 0
    nv = len(V)
    for loop, opp in holes:
        patch = _patch_for(V, loop, opp, nbrs_of, mode)
        if patch is None:
            failed += 1
            continue
        pos, tris = patch
        n = len(loop)
        base = nv + len(extra)
        extra += pos[n:]
        added += [loop[v] if v < n else base + v - n for v in tris]
        filled += 1
    if filled == 0:
        raise MeshError("None of the holes could be closed — every rim crosses itself too much to lay a patch across.")
    allV = np.vstack([V, np.array(extra).reshape(-1, 3)])
    allF = np.vstack([F, np.array(added, dtype=np.int64).reshape(-1, 3)])
    V2, F2, vmap = compact_edit(allV, allF, nv)
    return V2, F2, vmap, {"filled": filled, "triangles": len(added) // 3, "vertices": len(extra), "failed": failed, "left": len(loops) - len(holes)}


# ---- smooth (smooth.ts: moving least squares on a quadric height field) -------------------

EDGE_COS = math.cos(math.radians(30))
EDGE_SHARE = 0.35
TURNED_SHARE = 0.1
PASSES = 2
PATCH_POINTS = 96


def _hash32(v):
    v = np.asarray(v, dtype=np.uint64)
    h = ((v ^ np.uint64(0x9E3779B9)) * np.uint64(0x85EBCA6B)) & np.uint64(0xFFFFFFFF)
    h ^= h >> np.uint64(13)
    h = (h * np.uint64(0xC2B2AE35)) & np.uint64(0xFFFFFFFF)
    h ^= h >> np.uint64(16)
    return h


def _vertex_adjacency(F, nv):
    a = np.concatenate([F[:, 0], F[:, 1], F[:, 2], F[:, 1], F[:, 2], F[:, 0]])
    b = np.concatenate([F[:, 1], F[:, 2], F[:, 0], F[:, 0], F[:, 1], F[:, 2]])
    pairs = np.unique(a * nv + b)
    a, b = pairs // nv, pairs % nv
    return np.searchsorted(a, np.arange(nv + 1)), b


def _smooth_normals(N, offs, lst, used):
    for _ in range(2):
        out = N.copy()
        src = np.repeat(np.arange(len(N)), np.diff(offs))
        same = (N[src] * N[lst]).sum(axis=1) >= EDGE_COS
        np.add.at(out, src[same], N[lst[same]])
        out[~used] = N[~used]
        L = np.linalg.norm(out, axis=1)
        ok = L > 0
        out[ok] /= L[ok, None]
        N = out
    return N


def _cells(P, keys_of, size):
    lo = P.min(axis=0)
    c = np.floor((P - lo) / size).astype(np.int64)
    return c


def smooth_mesh(V, F, size, limit, keep_edges=True, region=None):
    if not size > 0:
        raise MeshError("The size must be more than zero.")
    if not limit > 0:
        raise MeshError("The limit must be more than zero.")
    nv = len(V)
    used = np.zeros(nv, dtype=bool)
    used[F.reshape(-1)] = True
    offs, lst = _vertex_adjacency(F, nv)
    reach = None
    if region is not None:
        if len(region) == 0:
            raise MeshError("Nothing is marked — mark the surface to smooth on the part first.")
        reach = _region_shares(V, used, np.asarray(region), size, offs, lst)
    t = V[F]
    area = float(np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1).sum() / 2)
    per_vertex = area / max(1, int(used.sum()))
    share = min(1.0, PATCH_POINTS / (math.pi * size * size / max(per_vertex, 1e-12)))
    cut = math.floor(share * 0xFFFFFFFF)
    cur = V.copy()
    held = np.zeros(nv, dtype=bool)
    min_cos = EDGE_COS if keep_edges else 0.0
    r2 = size * size
    ridx = np.arange(nv)
    for p in range(PASSES):
        N = _smooth_normals(vertex_normals(cur, F), offs, lst, used)
        sampled = used & (_hash32(ridx + p * nv) <= cut)
        nxt = cur.copy()
        cell = _cells(cur[used], None, size)
        uidx = np.nonzero(used)[0]
        keys = {}
        for i, k in zip(uidx.tolist(), map(tuple, cell.tolist())):
            keys.setdefault(k, []).append(i)
        samples = {k: [i for i in v if sampled[i]] for k, v in keys.items()}
        for k, verts in keys.items():
            if reach is not None and not any(reach[v] > 0 for v in verts):
                continue
            cand = []
            for dz in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        cand += samples.get((k[0] + dx, k[1] + dy, k[2] + dz), [])
            if not cand:
                for v in verts:
                    held[v] = True
                continue
            cand = np.array(cand)
            Q, QN = cur[cand], N[cand]
            for v in verts:
                part = reach[v] if reach is not None else 1.0
                if part == 0:
                    continue
                n = N[v]
                if not n.any():
                    held[v] = True
                    continue
                if abs(n[0]) < 0.9:
                    u = np.array([0, n[2], -n[1]])
                else:
                    u = np.array([-n[2], 0, n[0]])
                u = u / np.linalg.norm(u)
                w_ = np.cross(n, u)
                d = Q - cur[v]
                d2 = (d * d).sum(axis=1)
                turn = QN @ n
                near = (d2 < r2) & (turn > 0)
                f = 1 - d2 / r2
                wt = f * f
                x = (d @ u) / size
                y = (d @ w_) / size
                facing = wt[near].sum()
                tsel = near & (turn < min_cos)
                ksel = near & ~tsel
                turned = wt[tsel].sum()
                tx, ty = (wt * x)[tsel].sum(), (wt * y)[tsel].sum()
                tr = (wt * (x * x + y * y))[tsel].sum()
                kept = wt[ksel].sum()
                points = int(ksel.sum())
                around = turned > TURNED_SHARE * facing and tx * tx + ty * ty < 0.25 * tr * turned
                if points < 6 or kept < EDGE_SHARE * facing or around:
                    held[v] = True
                    continue
                xs, ys, ws = x[ksel], y[ksel], wt[ksel]
                h = d[ksel] @ n
                phi = np.stack([np.ones_like(xs), xs, ys, xs * xs, xs * ys, ys * ys], axis=1)
                M = (phi * ws[:, None]).T @ phi
                b = (phi * ws[:, None]).T @ h
                M[np.arange(1, 6), np.arange(1, 6)] += kept * 1e-7
                try:
                    L = np.linalg.cholesky(M)
                    if not np.all(np.diag(L) > math.sqrt(1e-12)):
                        raise np.linalg.LinAlgError
                    height = float(np.linalg.solve(L.T, np.linalg.solve(L, b))[0])
                except np.linalg.LinAlgError:
                    held[v] = True
                    continue
                if not math.isfinite(height):
                    held[v] = True
                    continue
                held[v] = False
                q = cur[v] + part * height * n
                o = q - V[v]
                dd = float(np.linalg.norm(o))
                if dd > limit:
                    q = V[v] + o * (limit / dd)
                nxt[v] = q
        cur = nxt
    moved = held_n = at_limit = 0
    maxm = sq = 0.0
    dist = np.linalg.norm(cur - V, axis=1)
    for v in np.nonzero(used)[0].tolist():
        if reach is not None and reach[v] == 0:
            continue
        if held[v] and dist[v] == 0:
            held_n += 1
            continue
        moved += 1
        maxm = max(maxm, dist[v])
        sq += dist[v] ** 2
        if dist[v] >= limit * (1 - 1e-4):
            at_limit += 1
    V2, F2, vmap = compact_edit(cur, F, nv)
    return V2, F2, vmap, {"settings": {"size": size, "limit": limit, "keepEdges": keep_edges}, "region": None if region is None else int(len(region)), "moved": moved, "held": held_n, "maxMove": float(maxm), "rmsMove": math.sqrt(sq / moved) if moved else 0.0, "atLimit": at_limit}


def _region_shares(V, used, region, size, offs, lst):
    n = len(V)
    inside = np.zeros(n, dtype=bool)
    region = region[(region < n)]
    inside[region] = True
    inside &= used
    src = np.repeat(np.arange(n), np.diff(offs))
    e = inside[src] & ~inside[lst] & used[lst]
    edge = np.zeros(n, dtype=bool)
    edge[lst[e]] = True
    share = np.zeros(n)
    E = V[edge]
    if len(E) == 0:
        share[inside] = 1.0
        return share
    for v in np.nonzero(inside)[0].tolist():
        d = min(float(np.sqrt(((E - V[v]) ** 2).sum(axis=1).min())), size)
        t = d / size
        share[v] = t * t * (3 - 2 * t)
    return share


# ---- offset (offset.ts, evenMove.ts: the whole mesh) ---------------------------------------

EDGE_RATIO = math.tan(math.radians(15)) ** 2
MAX_STRETCH = 3
MAX_NORMAL_PASSES = 64
SLIVER_SHAPE = 1e-6


def face_geometry(V, F):
    t = V[F]
    ab, ac, bc = t[:, 1] - t[:, 0], t[:, 2] - t[:, 0], t[:, 2] - t[:, 1]
    n = np.cross(ab, ac)
    L = np.linalg.norm(n, axis=1)
    longest = np.maximum.reduce([(ab * ab).sum(1), (ac * ac).sum(1), (bc * bc).sum(1)])
    ok = L > SLIVER_SHAPE * longest
    normals = np.zeros_like(n)
    normals[ok] = n[ok] / L[ok, None]
    a0 = np.arctan2(L, (ab * ac).sum(1))
    a1 = np.arctan2(L, -(ab * bc).sum(1))
    a2 = np.maximum(0, math.pi - a0 - a1)
    return normals, np.stack([a0, a1, a2], axis=1)


def _face_neighbours(F, nv):
    a, b = F.reshape(-1), F[:, [1, 2, 0]].reshape(-1)
    key = a * nv + b
    order = np.argsort(key)
    sk = key[order]
    want = b * nv + a
    i = np.clip(np.searchsorted(sk, want), 0, len(sk) - 1)
    hit = sk[i] == want
    nb = np.where(hit, order[i] // 3, -1)
    return nb.reshape(-1, 3)


def smoothed_normals(normals, F, nv, passes):
    nb = _face_neighbours(F, nv)
    valid = nb >= 0
    nbn = np.where(valid[..., None], normals[np.maximum(nb, 0)], 0)
    nonzero = valid & np.any(nbn != 0, axis=-1)
    alike = (nonzero & ((nbn * normals[:, None]).sum(-1) >= EDGE_COS)).any(axis=1)
    s = (nbn * nonzero[..., None]).sum(axis=1)
    L = np.linalg.norm(s, axis=1)
    fix = ~alike & (nonzero.sum(axis=1) >= 2) & (L > 0)
    cleaned = normals.copy()
    cleaned[fix] = s[fix] / L[fix, None]
    nbc = np.where(valid[..., None], cleaned[np.maximum(nb, 0)], 0)
    same = valid & ((nbc * cleaned[:, None]).sum(-1) >= EDGE_COS)
    cur = cleaned
    for _ in range(passes):
        acc = cur + (np.where(same[..., None], cur[np.maximum(nb, 0)], 0)).sum(axis=1)
        L = np.linalg.norm(acc, axis=1)
        cur = np.where(L[:, None] > 0, acc / np.where(L > 0, L, 1)[:, None], 0)
    return cur


def offset_mesh(V, F, distance):
    """The whole surface moved along its normal so every face around a point
    ends `distance` from where it was (the least-squares even move); edges
    stay sharp, no point moves more than three times the distance."""
    d = float(distance)
    if not math.isfinite(d) or d == 0:
        raise MeshError("The distance must not be zero.")
    nv = len(V)
    normals, angles = face_geometry(V, F)
    edge = mean_edge_length(V, F)
    passes = min(MAX_NORMAL_PASSES, max(1, round((abs(d) / edge) ** 2))) if edge > 0 else 1
    facing = smoothed_normals(normals, F, nv, passes)
    # Per vertex: the faces round it, weighted by their angle there.
    vi = F.reshape(-1)
    ti = np.repeat(np.arange(len(F)), 3)
    w = angles.reshape(-1)
    fn = facing[ti]
    mean = np.zeros((nv, 3))
    np.add.at(mean, vi, w[:, None] * fn)
    take = (w > 0) & np.any(fn != 0, axis=1) & ((fn * mean[vi]).sum(axis=1) > 0)
    M = np.zeros((nv, 3, 3))
    np.add.at(M, vi[take], (w[take, None, None] * fn[take, :, None] * fn[take, None, :]))
    B = np.zeros((nv, 3))
    np.add.at(B, vi[take], w[take, None] * fn[take])
    wsum = np.zeros(nv)
    np.add.at(wsum, vi[take], w[take])
    vals, vecs = np.linalg.eigh(M)
    top = vals.max(axis=1, keepdims=True)
    good = vals > EDGE_RATIO * top
    proj = np.einsum("nik,ni->nk", vecs, B)
    coef = np.where(good, proj / np.where(good, vals, 1), 0)
    move = np.einsum("nik,nk->ni", vecs, coef) * d
    L = np.linalg.norm(move, axis=1)
    most = MAX_STRETCH * abs(d)
    over = L > most
    move[over] *= (most / L[over])[:, None]
    move[wsum == 0] = 0
    out = V + move
    moved = int((np.linalg.norm(move, axis=1) > 0).sum())
    V2, F2, vmap = compact_edit(out, F, nv)
    return V2, F2, vmap, {"distance": d, "region": None, "moved": moved, "maxMove": float(np.linalg.norm(move, axis=1).max()) if nv else 0.0, "relaxed": 0, "merged": 0, "slid": 0, "stepped": 0, "wall": 0}
