# SPDX-License-Identifier: AGPL-3.0-only
# Draft read off a scan against a pull direction: the walls that run near
# the pull — the sides a mould opens along — gathered into patches, each
# with the angle it leans off the pull: positive where the wall faces
# partly along the pull (it lets go as the tool moves that way), negative
# where it faces back (a back draft, an undercut). Walls are grown from
# point to neighbouring point between points that face nearly the same way
# across the pull, then grown again by their running mean facing so a round
# turn does not run on; a boss's or a hole's round side stays one patch and
# is flagged; a split plane keeps patches to one side. Ported from ScanRuler
# by CNC Kitchen: src/core/fit/draft.ts.

import math

import numpy as np

from .dev_hotspots import components, neighbour_pairs, point_spacing

FACING_GAP_DEG = 20
GRAIN_SPACINGS = 3
MIN_COUNT = 3
SHORT_FACING = 0.5


def _square(d):
    t = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = np.cross(d, t)
    e1 /= np.linalg.norm(e1)
    return e1, np.cross(d, e1)


def _pairs(P, idx, grain):
    """Pairs (i, j), i < j, of positions in idx within the grain."""
    S = P[idx]
    q, p = neighbour_pairs(S, S, grain)
    keep = q < p
    q, p = q[keep], p[keep]
    d2 = ((S[q] - S[p]) ** 2).sum(1)
    keep = d2 <= grain * grain
    return q[keep], p[keep]


def _round_side(m, P, fu, fv, e1, e2):
    n = len(m)
    u, v = P[m] @ e1, P[m] @ e2
    a, b = fu[m], fv[m]
    m11, m12, m22 = 1 - a * a, -a * b, 1 - b * b
    A11, A12, A22 = m11.sum(), m12.sum(), m22.sum()
    B1, B2 = (m11 * u + m12 * v).sum(), (m12 * u + m22 * v).sum()
    det = A11 * A22 - A12 * A12
    if not det > 0.05 * n * n:
        return False
    cu, cv = (B1 * A22 - B2 * A12) / det, (A11 * B2 - A12 * B1) / det
    du, dv = u - cu, v - cv
    dl = np.hypot(du, dv)
    ok = dl > 0
    facing = ((a * du + b * dv)[ok] / dl[ok]).sum()
    off = (a * dv - b * du)[ok]
    return abs(facing) > 0.8 * n and math.sqrt((off * off).sum() / n) < 0.2 * dl[ok].sum() / n


def _mean_grow(m, P, fu, fv, side, grain):
    cos_gap = math.cos(math.radians(FACING_GAP_DEG))
    n = len(m)
    q, p = _pairs(P, m, grain)
    nbr = [[] for _ in range(n)]
    for a, b in zip(q.tolist(), p.tolist()):
        nbr[a].append(b)
        nbr[b].append(a)
    F = np.column_stack([fu[m], fv[m]])
    steady = np.zeros(n)
    for i in range(n):
        js = nbr[i] + [i]
        s = F[js].sum(0)
        steady[i] = math.hypot(*s) / len(js)
    order = sorted(range(n), key=lambda i: (-steady[i], i))
    owner = np.full(n, -1)
    out = []
    for s0 in order:
        if owner[s0] >= 0:
            continue
        pid = len(out)
        owner[s0] = pid
        patch = [s0]
        mu, mv = F[s0]
        h = 0
        while h < len(patch):
            a = patch[h]
            h += 1
            ml = math.hypot(mu, mv) or 1
            cu, cv = mu / ml, mv / ml
            for j in nbr[a]:
                if owner[j] >= 0:
                    continue
                if side is not None and side[m[a]] != side[m[j]]:
                    continue
                if F[a] @ F[j] < cos_gap or F[j, 0] * cu + F[j, 1] * cv < cos_gap:
                    continue
                owner[j] = pid
                patch.append(j)
                mu += F[j, 0]
                mv += F[j, 1]
        out.append([int(m[i]) for i in patch])
    return [x for x in out if len(x) >= MIN_COUNT]


def draft_patches(P, N, pull, near_deg=10, limit=12, min_area=1.0, split=None, grain=None):
    P, N = np.asarray(P, float), np.asarray(N, float)
    d = np.asarray(pull, float)
    if not np.linalg.norm(d) > 0:
        raise ValueError("The pull direction has no length.")
    d = d / np.linalg.norm(d)
    nl = np.linalg.norm(N, axis=1)
    s = np.where(nl > 0, (N @ d) / np.maximum(nl, 1e-300), 2.0)
    sel = np.nonzero(np.abs(s) <= math.sin(math.radians(near_deg)))[0]
    e1, e2 = _square(d)
    lean = np.degrees(np.arcsin(np.clip(s, -1, 1)))
    U, Vv = N @ e1, N @ e2
    fl = np.hypot(U, Vv)
    fl[fl == 0] = 1
    fu, fv = U / fl, Vv / fl
    base = {"pull": d.tolist(), "nearDeg": near_deg, "walls": int(len(sel)), "points": int(len(P))}
    if len(sel) < MIN_COUNT:
        return {**base, "patches": [], "found": 0}
    spacing = point_spacing(P, sel)
    grain = grain or max(spacing * GRAIN_SPACINGS, 1e-6)
    side = None
    if split:
        sn = np.asarray(split["normal"], float)
        sn /= np.linalg.norm(sn)
        split = {"point": list(map(float, split["point"])), "normal": sn.tolist()}
        side = ((P - np.asarray(split["point"])) @ sn < 0).astype(np.int8)
    cos_gap = math.cos(math.radians(FACING_GAP_DEG))
    q, p = _pairs(P, sel, grain)
    ok = fu[sel[q]] * fu[sel[p]] + fv[sel[q]] * fv[sel[p]] >= cos_gap
    labels = components(len(sel), q[ok], p[ok])
    groups = {}
    for i, lab in enumerate(labels.tolist()):
        groups.setdefault(lab, []).append(int(sel[i]))
    parts = []
    for members in groups.values():
        if len(members) < MIN_COUNT:
            continue
        m = np.array(members)
        su, sv = fu[m].sum(), fv[m].sum()
        sl = math.hypot(su, sv)
        if sl < SHORT_FACING * len(m) and _round_side(m, P, fu, fv, e1, e2):
            parts.append((members, True))
            continue
        one = sl > 0 and bool(((fu[m] * su + fv[m] * sv) / sl >= cos_gap).all()) and (side is None or bool((side[m] == side[m[0]]).all()))
        if one:
            parts.append((members, False))
        else:
            parts += [(x, False) for x in _mean_grow(m, P, fu, fv, side, grain)]
    patches = []
    for members, rnd in parts:
        m = np.array(members)
        area = len(m) * spacing * spacing
        if area < min_area:
            continue
        L = lean[m]
        mean = float(L.mean())
        spread = float(math.sqrt(max(0.0, (L * L).mean() - mean * mean)))
        f = N[m].sum(0)
        across = f - (f @ d) * d
        al = np.linalg.norm(across) or 1
        facing = across / al
        mu, mv = facing @ e1, facing @ e2
        turn = np.sort(np.arctan2(mu * fv[m] - mv * fu[m], mu * fu[m] + mv * fv[m]))
        c = len(m)
        turn_deg = math.degrees(turn[int(0.98 * (c - 1))] - turn[int(0.02 * (c - 1))])
        t = np.cross(d, facing)
        w = P[m] @ t
        if float(w.max() - w.min()) < grain:
            continue  # a strip along a sharp edge: the edge's averaged normals
        patch = {"centroid": P[m].mean(0).tolist(), "min": P[m].min(0).tolist(), "max": P[m].max(0).tolist(), "area": area, "count": c,
                 "draftDeg": mean, "sigmaDeg": spread / math.sqrt(c), "spreadDeg": spread, "facing": facing.tolist(), "turnDeg": turn_deg}
        if rnd:
            patch["round"] = True
        elif side is not None:
            patch["side"] = -1 if side[m[0]] else 1
        patches.append(patch)
    patches.sort(key=lambda x: -x["area"])
    return {**base, "patches": patches[:limit], "found": len(parts), **({"split": split} if split else {})}
