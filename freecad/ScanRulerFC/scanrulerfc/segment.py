# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/fit/segment.ts (segmentPlanes,
# vertexAreas) and src/commands/core/segment.ts
#
# The scan's flat faces found all at once: planar regions grown from the
# flattest places outward, each vertex joining while its normal leans less
# than maxDeg off the region's plane and it lies inside a band of the
# region's own scatter (never wider than twice maxRms, so a region cannot
# widen its way across a shallow crease). The plane is refitted as the
# region grows; what it took in under an earlier plane and now lies off it
# goes back. Regions smaller than minArea, or rougher than maxRms, are given
# back. Neighbours are the regions whose fronts meet when each spreads a few
# rings into the unclaimed vertices round it.

import math

import numpy as np

from .linalg import sym_eigen

PATCH = 30
PATCH_LEAST = 12
REGION_LEAST = 20
BAND_SIGMAS = 3.5
BAND_MAX_RMS = 2
REFIT_GROWTH = 1.25
MEET_RINGS = 6
MEET_EDGES = 3
SEED_BUCKETS = 4096
SMOOTH_DEG = 35


class Moments:
    """Running sums over a region's points about a fixed origin near them."""

    def __init__(self, o):
        self.o = np.asarray(o, dtype=float)
        self.n = 0
        self.s = np.zeros(3)
        self.ss = np.zeros((3, 3))

    def add(self, x):
        a = x - self.o
        self.n += 1
        self.s += a
        self.ss += np.outer(a, a)

    def add_many(self, X):
        A = X - self.o
        self.n += len(A)
        self.s += A.sum(axis=0)
        self.ss += A.T @ A

    def plane(self, toward):
        n = self.n
        if n < 3:
            return None
        m = self.s / n
        C = self.ss / n - np.outer(m, m)
        vals, vecs = sym_eigen(C)
        if not vals[1] > 1e-12 * max(vals[2], 1e-30):
            return None
        nrm = vecs[0]
        if nrm @ toward < 0:
            nrm = -nrm
        c = m + self.o
        return {"n": nrm, "d": float(nrm @ c), "centroid": c, "sigma": math.sqrt(max(0.0, vals[0]))}


def segment_planes(g, min_area, max_rms, max_deg, box=None):
    P, N, n = g.P, g.N, g.n
    lists = g.lists()
    cos_max = math.cos(math.radians(min(89, max(0.1, max_deg))))
    max_rms = max(max_rms, 1e-9)
    band_floor = max(1e-5 * g.bbox_diag, 1e-7)

    def band_of(sigma):
        return min(BAND_MAX_RMS * max_rms, max(BAND_SIGMAS * sigma, band_floor))

    areas = g.vertex_areas()
    if box:
        allowed = np.all((P >= np.asarray(box["min"])) & (P <= np.asarray(box["max"])), axis=1)
        considered = int(allowed.sum())
    else:
        allowed = np.ones(n, dtype=bool)
        considered = n
    allowed_l = allowed.tolist()

    # How much the normals turn round each vertex, smoothed over its ring:
    # the flattest places seed first.
    nb, owner = g.neighbours(np.arange(n))
    deg = np.diff(g.adj_off)
    turn_sum = np.bincount(owner, weights=1 - (N[nb] * N[owner]).sum(axis=1), minlength=n)
    turn = np.where(deg > 0, turn_sum / np.maximum(deg, 1), 1.0)
    rough = (turn + np.bincount(owner, weights=turn[nb], minlength=n)) / (deg + 1)
    seed_limit = 1 - cos_max
    ok = allowed & (rough <= seed_limit)
    keys = np.minimum(SEED_BUCKETS - 1, np.floor(np.sqrt(rough / seed_limit) * SEED_BUCKETS)).astype(np.int64)
    cand = np.nonzero(ok)[0]
    order = cand[np.argsort(keys[cand], kind="stable")]

    label = [0] * n
    no_seed = [False] * n
    Nl = N.tolist()
    Pl = P.tolist()
    kept = []
    next_id = 1

    def give_back(ms):
        for v in ms:
            label[v] = 0
            no_seed[v] = True

    for s in order.tolist():
        if label[s] != 0 or no_seed[s]:
            continue
        rid = next_id
        next_id += 1
        sn = N[s]
        members = [s]
        label[s] = rid
        head = 0
        while head < len(members) and len(members) < PATCH:
            v = members[head]
            for w in lists[v]:
                if len(members) >= PATCH:
                    break
                if label[w] != 0 or not allowed_l[w]:
                    continue
                nw = Nl[w]
                if nw[0] * sn[0] + nw[1] * sn[1] + nw[2] * sn[2] < cos_max:
                    continue
                label[w] = rid
                members.append(w)
            head += 1
        m = Moments(P[s])
        m.add_many(P[members])
        fit = m.plane(sn) if len(members) >= PATCH_LEAST else None
        if not fit or fit["sigma"] > max_rms:
            give_back(members)
            continue
        band = band_of(fit["sigma"])
        fitted_at = len(members)
        head = 0
        while head < len(members):
            v = members[head]
            pn, pd = fit["n"], fit["d"]
            nx, ny, nz = float(pn[0]), float(pn[1]), float(pn[2])
            for w in lists[v]:
                if label[w] != 0 or not allowed_l[w]:
                    continue
                nw = Nl[w]
                if nw[0] * nx + nw[1] * ny + nw[2] * nz < cos_max:
                    continue
                pw = Pl[w]
                if not abs(pw[0] * nx + pw[1] * ny + pw[2] * nz - pd) <= band:
                    continue
                label[w] = rid
                members.append(w)
                m.add(P[w])
            if len(members) >= REFIT_GROWTH * fitted_at + 8:
                nxt = m.plane(pn)
                if nxt:
                    fit = nxt
                    band = band_of(fit["sigma"])
                fitted_at = len(members)
            head += 1
        settled = m.plane(fit["n"]) or fit
        fband = band_of(settled["sigma"])
        mem = np.asarray(members)
        res = np.abs(P[mem] @ settled["n"] - settled["d"])
        stay = mem[res <= fband]
        give_back(mem[res > fband].tolist())
        fm = Moments(P[s])
        fm.add_many(P[stay])
        final = fm.plane(settled["n"])
        area = float(areas[stay].sum())
        vote = float((N[stay] @ settled["n"]).sum())
        if not final or len(stay) < REGION_LEAST or area < min_area or final["sigma"] > max_rms:
            give_back(stay.tolist())
            continue
        sign = 1 if vote >= 0 else -1
        kept.append({"id": rid, "members": stay, "normal": sign * final["n"], "point": final["centroid"], "sigma": final["sigma"], "area": area})

    kept.sort(key=lambda r: -r["area"])
    lab = np.zeros(n, dtype=np.int64)
    for k, r in enumerate(kept):
        lab[r["members"]] = k + 1

    # Each region spreads a few rings into the unclaimed vertices round it;
    # where two fronts meet, or two regions touch, they are neighbours.
    owner_l = lab.tolist()
    ring = [0] * n
    front = [v for v in range(n) if owner_l[v] != 0]
    head = 0
    while head < len(front):
        v = front[head]
        head += 1
        if ring[v] >= MEET_RINGS:
            continue
        for w in lists[v]:
            if owner_l[w] != 0 or not allowed_l[w]:
                continue
            owner_l[w] = owner_l[v]
            ring[w] = ring[v] + 1
            front.append(w)
    ow = np.asarray(owner_l)
    e0 = np.repeat(np.arange(n), deg)
    e1 = g.adj_list
    sel = (e1 > e0) & (ow[e0] != 0) & (ow[e1] != 0) & (ow[e0] != ow[e1])
    a, b = np.minimum(ow[e0][sel], ow[e1][sel]), np.maximum(ow[e0][sel], ow[e1][sel])
    pairs, counts = np.unique(np.c_[a, b], axis=0, return_counts=True) if len(a) else (np.zeros((0, 2), int), np.zeros(0, int))

    regions = []
    for r in kept:
        Q = P[r["members"]]
        regions.append({"normal": r["normal"], "point": r["point"], "sigma": r["sigma"], "area": r["area"], "min": Q.min(axis=0), "max": Q.max(axis=0), "count": len(r["members"]), "neighbours": [], "members": r["members"]})
    for (ia, ib), c in zip(pairs.tolist(), counts.tolist()):
        if c < MEET_EDGES:
            continue
        ra, rb = regions[ia - 1], regions[ib - 1]
        d = math.degrees(math.acos(max(-1.0, min(1.0, float(ra["normal"] @ rb["normal"])))))
        ra["neighbours"].append({"id": ib, "deg": d})
        rb["neighbours"].append({"id": ia, "deg": d})
    for r in regions:
        r["neighbours"].sort(key=lambda x: x["id"])
    return {"regions": regions, "considered": considered, "claimed": int(sum(r["count"] for r in regions))}
