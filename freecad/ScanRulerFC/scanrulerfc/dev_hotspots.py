# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/deviation/hotspots.ts,
# src/core/deviation/patchKind.ts, src/core/geometry/unionFind.ts
#
# Where a deviation map lies past its tolerance, as patches: the vertices
# over tolerance gathered into connected regions — two within `grain` of
# each other, on the same side of the surface, are one patch — each with its
# centre, box, area (count x spacing^2), mean, extreme, depth (the median
# |reading|), the volume past the tolerance and whether it is a feature
# (broad and deep: material missing or misplaced) or texture.

import math

import numpy as np

FEATURE_MIN_AREA = 4
FEATURE_MIN_SPACINGS = 25
FEATURE_DEPTH = 2
GRAIN_SPACINGS = 3
DEFAULT_LIMIT = 8
DEFAULT_MIN_COUNT = 3
SPACING_SAMPLE = 2000
_KEY = 1 << 20
_HALF = _KEY // 2


def patch_kind(area, depth, spacing, feature_depth):
    return "feature" if area >= max(FEATURE_MIN_AREA, FEATURE_MIN_SPACINGS * spacing * spacing) and depth >= feature_depth else "texture"


def _keys(cells):
    c = cells + _HALF
    return (c[:, 0] * _KEY + c[:, 1]) * _KEY + c[:, 2]


def neighbour_pairs(P, Q, cell):
    """Every (query, point) pair whose cells are within one of each other —
    the 27 cells about each query, as ScanRuler's hash grid asks."""
    pc = np.floor(P / cell).astype(np.int64)
    qc = np.floor(Q / cell).astype(np.int64)
    keys = _keys(pc)
    order = np.argsort(keys, kind="stable")
    sk = keys[order]
    out_q, out_p = [], []
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                k = _keys(qc + (dx, dy, dz))
                lo = np.searchsorted(sk, k, "left")
                hi = np.searchsorted(sk, k, "right")
                cnt = hi - lo
                if not cnt.any():
                    continue
                qi = np.repeat(np.arange(len(Q)), cnt)
                start = np.repeat(lo - np.concatenate([[0], np.cumsum(cnt)[:-1]]), cnt)
                pos = np.arange(int(cnt.sum())) + start
                out_q.append(qi)
                out_p.append(order[pos])
    if not out_q:
        return np.zeros(0, dtype=np.int64), np.zeros(0, dtype=np.int64)
    return np.concatenate(out_q), np.concatenate(out_p)


def components(n, a, b):
    """Connected components of n items joined by the pairs (a, b): the
    smallest member's index labels each."""
    label = np.arange(n)
    if len(a) == 0:
        return label
    while True:
        la, lb = label[a], label[b]
        m = np.minimum(la, lb)
        before = label.copy()
        np.minimum.at(label, a, m)
        np.minimum.at(label, b, m)
        np.minimum.at(label, la, m)
        np.minimum.at(label, lb, m)
        while True:
            nxt = label[label]
            if np.array_equal(nxt, label):
                break
            label = nxt
        if np.array_equal(label, before):
            return label


def point_spacing(P, sel):
    """The median distance from a selected entry to the nearest other one,
    over a sample."""
    sel = np.asarray(sel, dtype=np.int64)
    if len(sel) < 2:
        return 0.0
    S = P[sel]
    diag = float(np.linalg.norm(S.max(axis=0) - S.min(axis=0)))
    cell = max(diag / max(4, (len(sel) ** (1 / 3)) * 2), 1e-9)
    stride = max(1, len(sel) // SPACING_SAMPLE)
    qi_all = np.arange(0, len(sel), stride)
    q, p = neighbour_pairs(S, S[qi_all], cell)
    keep = qi_all[q] != p
    q, p = q[keep], p[keep]
    if len(q) == 0:
        return cell
    d2 = ((S[qi_all[q]] - S[p]) ** 2).sum(axis=1)
    best = np.full(len(qi_all), np.inf)
    np.minimum.at(best, q, d2)
    best = best[np.isfinite(best)]
    if len(best) == 0:
        return cell
    best = np.sort(np.sqrt(best))
    return float(best[len(best) // 2])


def hotspots(points, values, tolerance, grain=None, limit=DEFAULT_LIMIT, min_count=DEFAULT_MIN_COUNT, only=None, group=None, feature_depth=None):
    """The patches of points whose values lie past tolerance either way.
    `only` is a boolean mask of the entries to consider, `group` a key per
    entry that keeps entries apart."""
    P = np.asarray(points, dtype=float).reshape(-1, 3)
    v = np.asarray(values, dtype=float)
    with np.errstate(invalid="ignore"):
        mask = np.isfinite(v) & (np.abs(v) > tolerance)
    if only is not None:
        mask &= np.asarray(only, dtype=bool)
    sel = np.nonzero(mask)[0]
    empty = {"patches": [], "found": 0, "over": int(len(sel)), "features": {"count": 0, "shareOfExcess": 0}, "spacing": 0.0, "grain": grain if grain is not None else 0}
    if len(sel) == 0:
        return empty
    spacing = point_spacing(P, sel)
    g = grain if grain is not None else max(spacing * GRAIN_SPACINGS, 1e-6)
    if not (g > 0):
        return {**empty, "spacing": spacing}
    S = P[sel]
    sv = v[sel]
    q, p = neighbour_pairs(S, S, g)
    keep = (p > q) & ((sv[q] > 0) == (sv[p] > 0)) & (((S[q] - S[p]) ** 2).sum(axis=1) <= g * g)
    if group is not None:
        gr = np.asarray(group)[sel]
        keep &= gr[q] == gr[p]
    label = components(len(sel), q[keep], p[keep])
    feature_depth = FEATURE_DEPTH * tolerance if feature_depth is None else feature_depth
    excess_each = np.abs(sv) - tolerance
    all_excess = float(excess_each.sum())
    order = np.argsort(label, kind="stable")
    bounds = np.nonzero(np.diff(np.concatenate([[-1], label[order], [-2]])))[0]
    patches = []
    f_count, f_excess = 0, 0.0
    for s, e in zip(bounds[:-1], bounds[1:]):
        members_local = order[s:e]
        if len(members_local) < min_count:
            continue
        members = sel[members_local]
        mv = sv[members_local]
        mp = S[members_local]
        ab = np.abs(mv)
        k = int(np.argmax(ab))
        excess = float(excess_each[members_local].sum())
        srt = np.sort(ab.astype(np.float32))
        half = len(srt) >> 1
        depth = float(srt[half]) if len(srt) % 2 else float((srt[half - 1] + srt[half]) / 2)
        area = len(members) * spacing * spacing
        kind = patch_kind(area, depth, spacing, feature_depth)
        if kind == "feature":
            f_count += 1
            f_excess += excess
        patches.append(
            {
                "count": int(len(members)),
                "centroid": mp.mean(axis=0),
                "min": mp.min(axis=0),
                "max": mp.max(axis=0),
                "mean": float(mv.mean()),
                "extreme": float(mv[k]),
                "excess": excess,
                "area": area,
                "volume": excess * spacing * spacing,
                "depth": depth,
                "kind": kind,
                "at": mp[k],
                "index": int(members[k]),
                "members": members,
            }
        )
    patches.sort(key=lambda x: -x["excess"])
    features = {"count": f_count, "shareOfExcess": f_excess / all_excess if all_excess > 0 else 0}
    return {"patches": patches[:limit], "found": len(patches), "over": int(len(sel)), "features": features, "spacing": spacing, "grain": g}
