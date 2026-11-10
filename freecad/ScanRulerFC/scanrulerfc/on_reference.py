# SPDX-License-Identifier: AGPL-3.0-only
# The deviation map the other way round, as ScanRuler's
# core/deviation/onReference.ts has it: the reference read against the
# scan. The map on the scan says nothing where the scan has no surface —
# reference surface nothing was scanned at, a boss modelled where there is
# air. Read on the reference, both are painted on the surface that is
# wrong, and the share of the reference the scan stands behind is a number.
#
# The reference is cut into small triangles about `spacing` across; each
# one's middle is a reading: the signed distance along the reference's
# normal to the scan, positive where the reference stands outside it, taken
# only off scan surface that faces the way the reference does (within
# `facing_deg`; the far skin of a thin wall is not the near one's evidence)
# and lies square under the point (a ray along the normal meets it). With
# none within `reach`, the reading is NaN: no scan there.

import math

import numpy as np

DEFAULT_FACING_DEG = 60.0
MIN_SPACING, MAX_SPACING = 0.25, 2.0
MAX_SAMPLES = 200_000


def wanted_spacing(tolerance, area):
    """Twice the tolerance, within a quarter and two millimetres, opened
    as far as keeps the readings under MAX_SAMPLES."""
    s = min(MAX_SPACING, max(MIN_SPACING, 2.0 * float(tolerance)))
    # Halving a triangle until no edge is over s leaves pieces with edges
    # between s/2 and s: about s²/8 of area each, not s²/2.
    need = math.sqrt(8.0 * float(area) / MAX_SAMPLES) if area > 0 else s
    return max(s, need)


def cut(V, F, spacing):
    """The reference's triangles cut until no edge is longer than spacing:
    (centres, normals, triangles as their own corners, area per piece)."""
    V = np.asarray(V, dtype=float)
    T = V[np.asarray(F, dtype=np.int64)]
    out = []
    while len(T):
        e = np.stack([np.linalg.norm(T[:, 1] - T[:, 0], axis=1), np.linalg.norm(T[:, 2] - T[:, 1], axis=1), np.linalg.norm(T[:, 0] - T[:, 2], axis=1)], 1)
        big = e.max(1) > spacing
        out.append(T[~big])
        T = T[big]
        if not len(T):
            break
        # Four of each: the corners and the middles of the edges.
        a, b, c = T[:, 0], T[:, 1], T[:, 2]
        ab, bc, ca = (a + b) / 2, (b + c) / 2, (c + a) / 2
        T = np.concatenate([np.stack([a, ab, ca], 1), np.stack([ab, b, bc], 1), np.stack([ca, bc, c], 1), np.stack([ab, bc, ca], 1)])
    P = np.concatenate(out) if out else np.zeros((0, 3, 3))
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    area = 0.5 * np.linalg.norm(n, axis=1)
    keep = area > 1e-12
    P, n, area = P[keep], n[keep], area[keep]
    n /= np.linalg.norm(n, axis=1)[:, None]
    return P.mean(1), n, P, area


def read(centres, normals, SV, SF, reach, facing_deg=DEFAULT_FACING_DEG, group=64, chunk_cells=4_000_000):
    """Signed mm per reading (positive: the reference outside the scan), NaN
    where no scan surface facing its way lies under it within reach."""
    SV = np.asarray(SV, dtype=float)
    SF = np.asarray(SF, dtype=np.int64)
    T = SV[SF]
    tn = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    ln = np.linalg.norm(tn, axis=1)
    ok_t = ln > 1e-15
    tn[ok_t] /= ln[ok_t, None]
    tlo, thi = T.min(1), T.max(1)
    cos_f = math.cos(math.radians(facing_deg)) if facing_deg is not None else -2.0
    O = np.asarray(centres, dtype=float)
    N = np.asarray(normals, dtype=float)
    out = np.full(len(O), np.nan)
    if not len(O) or not len(SF):
        return out
    cell = max(reach, 1e-6)
    key = np.floor((O - O.min(0)) / cell).astype(np.int64)
    order = np.lexsort((key[:, 2], key[:, 1], key[:, 0]))
    for i in range(0, len(O), group):
        idx = order[i:i + group]
        lo = O[idx].min(0) - reach - 1e-6
        hi = O[idx].max(0) + reach + 1e-6
        near = np.nonzero(ok_t & np.all((thi >= lo) & (tlo <= hi), axis=1))[0]
        if not len(near):
            continue
        v0, e1, e2, nn = T[near, 0], T[near, 1] - T[near, 0], T[near, 2] - T[near, 0], tn[near]
        step = max(1, chunk_cells // len(near))
        for j in range(0, len(idx), step):
            r = idx[j:j + step]
            o, n = O[r, None, :], N[r, None, :]
            facing = (nn[None] * n).sum(-1) >= cos_f
            best = np.full(len(r), np.inf)
            for sign in (1.0, -1.0):
                d = n * sign
                h = np.cross(d, e2[None])
                a = (e1[None] * h).sum(-1)
                ok = np.abs(a) > 1e-12
                f = np.where(ok, 1.0 / np.where(ok, a, 1.0), 0.0)
                s_ = o - v0[None]
                u = f * (s_ * h).sum(-1)
                q = np.cross(s_, e1[None])
                v = f * (q * d).sum(-1)
                t = f * (e2[None] * q).sum(-1)
                m = ok & facing & (u >= -1e-9) & (v >= -1e-9) & (u + v <= 1 + 1e-9) & (t >= 0) & (t <= reach)
                # Along the normal (+): the scan stands outside, the
                # reference inside it: negative. Against it: positive.
                tt = np.where(m, t, np.inf).min(1)
                signed = np.where(np.isfinite(tt), -sign * tt, np.inf)
                closer = np.abs(signed) < np.abs(best)
                best = np.where(closer, signed, best)
            out[r] = np.where(np.isfinite(best), best, np.nan)
    return out


def summary(values, area, centres, tolerance):
    """The figures of a map on the reference: how much of it the scan
    stands behind, how much is within tolerance, and the worst each way."""
    v = np.asarray(values, dtype=float)
    a = np.asarray(area, dtype=float)
    total = float(a.sum()) or 1.0
    seen = np.isfinite(v)
    out = {"referenceAreaMm2": round(total, 1), "coveredPct": round(100 * float(a[seen].sum()) / total, 1)}
    if seen.any():
        within = seen & (np.abs(np.nan_to_num(v)) <= tolerance)
        out["withinTolerancePct"] = round(100 * float(a[within].sum()) / total, 1)
        k = int(np.nanargmax(v))
        if v[k] > 0:
            out["mostOutside"] = {"mm": round(float(v[k]), 3), "at": [round(float(x), 2) for x in centres[k]], "note": "the reference stands outside the scan: material the part lacks here"}
        k = int(np.nanargmin(v))
        if v[k] < 0:
            out["mostInside"] = {"mm": round(float(v[k]), 3), "at": [round(float(x), 2) for x in centres[k]], "note": "the reference lies inside the scan: material the part has over the model"}
    if (~seen).any():
        # The largest unscanned stretch's middle, by area-weighted reading.
        miss = np.nonzero(~seen)[0]
        k = miss[int(np.argmax(a[miss]))]
        out["unscanned"] = {"areaMm2": round(float(a[~seen].sum()), 1), "near": [round(float(x), 2) for x in centres[k]]}
    return out
