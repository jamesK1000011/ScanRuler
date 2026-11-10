# SPDX-License-Identifier: AGPL-3.0-only
# Rotational repeats: how many times a cut square to an axis repeats itself
# going round it — a fan's blades, a flange's holes, a wheel's spokes — and
# how well each copy matches the others. The outline is laid on a map of
# angle against radius; a pattern of n copies lands on itself turned by
# 360/n, so the map's autocorrelation along the angle (through an FFT, every
# radius summed) scores each count, and the largest count near the best is
# taken. Round outlines about the axis (a bore, a hub, a rim) are set apart
# first and answered as rings. Each copy is then measured against the
# others turned onto it, the median over them, so one copy that is off
# reads off and the rest do not. Ported from ScanRuler by CNC Kitchen:
# src/core/geometry/rotationalRepeat.ts.

import math

import numpy as np

from .shapes import fit_circle2d

REPEAT_MIN_SCORE = 0.5
NEAR_BEST = 0.85
MAX_COUNT = 60
ANGLE_BINS = 1024
BLUR_BINS = 2
RING_COVER = 0.75
RING_SECTORS = 180
RING_SLACK = 0.02
REACH_SHARE, REACH_MIN, REACH_MAX = 0.02, 0.3, 2.0
MEASURED = 6000
TAU = 2 * math.pi


def _wrap_pi(a):
    return a - TAU * np.round(a / TAU)


def _to_segment(px, py, a, b, c, d):
    dx, dy = c - a, d - b
    l2 = dx * dx + dy * dy
    t = np.where(l2 > 0, np.clip(((px - a) * dx + (py - b) * dy) / np.where(l2 > 0, l2, 1), 0, 1), 0)
    return np.hypot(px - a - t * dx, py - b - t * dy)


def rotational_repeat(chains, min_radius=0.0, max_radius=math.inf, max_count=MAX_COUNT):
    """chains: (u, v) polylines in a plane square to the axis, the axis at
    [0, 0]."""
    max_count = max(2, min(max_count, ANGLE_BINS // 8))
    segs = []
    for ch in chains:
        ch = np.asarray(ch, float)
        if len(ch) < 2:
            continue
        s = np.concatenate([ch[:-1], ch[1:]], axis=1)
        segs.append(s)
    S = np.concatenate(segs) if segs else np.zeros((0, 4))
    if len(S):
        L = np.hypot(S[:, 2] - S[:, 0], S[:, 3] - S[:, 1])
        R = np.hypot((S[:, 0] + S[:, 2]) / 2, (S[:, 1] + S[:, 3]) / 2)
        S = S[(L > 0) & (R >= min_radius) & (R <= max_radius)]
    length = float(np.hypot(S[:, 2] - S[:, 0], S[:, 3] - S[:, 1]).sum()) if len(S) else 0.0

    def none(tried=None, rings=()):
        return {"count": 1, "pitchDeg": 360.0, "phaseDeg": 0.0, "score": 0.0, **({"tried": tried} if tried else {}), "instances": [], "rms": 0.0,
                "worst": 0.0, "worstInstance": -1, "rings": list(rings), "length": length}

    if len(S) < 8:
        return none()
    ends = np.concatenate([np.hypot(S[:, 0], S[:, 1]), np.hypot(S[:, 2], S[:, 3])])
    r_lo, r_hi = float(ends.min()), float(ends.max())
    span = max(r_hi - r_lo, 1e-3)
    step = max(min(0.25, span / 400), length / 400_000, 1e-3)
    seg_len = np.hypot(S[:, 2] - S[:, 0], S[:, 3] - S[:, 1])
    k = np.maximum(1, np.ceil(seg_len / step).astype(np.int64))
    si = np.repeat(np.arange(len(S)), k)
    j = np.arange(k.sum()) - np.repeat(np.cumsum(k) - k, k)
    kk = k[si]
    t0, t1 = j / kk, (j + 1) / kk
    A, B = S[si, 0:2], S[si, 2:4]
    P0 = A + (B - A) * t0[:, None]
    P1 = A + (B - A) * t1[:, None]
    mid = (P0 + P1) / 2
    px, py = mid[:, 0], mid[:, 1]
    pw = seg_len[si] / kk
    n = len(px)
    pr = np.hypot(px, py)
    pt = np.arctan2(py, px)

    ring_bins = max(1, min(200, math.ceil(span / max(0.1, span / 100))))
    rw = span / ring_bins
    bin_r = np.clip(np.floor((pr - r_lo) / rw).astype(np.int64), 0, ring_bins - 1)
    tx, ty = P1[:, 0] - P0[:, 0], P1[:, 1] - P0[:, 1]
    tl = np.hypot(tx, ty)
    along = (pr > 0) & (tl > 0) & (np.abs(tx * px + ty * py) / np.maximum(tl * pr, 1e-300) < 0.5)
    sector = (np.floor((pt + math.pi) / TAU * RING_SECTORS).astype(np.int64)) % RING_SECTORS
    covered = np.zeros((ring_bins, RING_SECTORS), bool)
    covered[bin_r[along], sector[along]] = True
    is_ring = np.zeros(ring_bins, bool)
    for b in range(ring_bins):
        wide = max(1, math.ceil(RING_SLACK * (r_lo + (b + 0.5) * rw) / rw))
        seen = covered[max(0, b - wide):b + wide + 1].any(0)
        if seen.sum() >= RING_COVER * RING_SECTORS:
            is_ring[b] = True
    runs = []
    for b in range(ring_bins):
        if is_ring[b]:
            if runs and runs[-1][1] == b - 1:
                runs[-1][1] = b
            else:
                runs.append([b, b])
    run_of = np.full(ring_bins, -1)
    for kr, (a, b) in enumerate(runs):
        run_of[a:b + 1] = kr
    ring_of = np.where(along, run_of[bin_r], -1)
    rings = []
    for kr in range(len(runs)):
        m = ring_of == kr
        if m.sum() < 8:
            continue
        c = fit_circle2d(px[m], py[m])
        if not c or not math.isfinite(c[2]):
            continue
        cu, cv, r = c
        rms = float(np.sqrt(((np.hypot(px[m] - cu, py[m] - cv) - r) ** 2).mean()))
        rings.append({"radius": float(r), "off": float(math.hypot(cu, cv)), "towardDeg": (math.degrees(math.atan2(cv, cu)) + 360) % 360, "rms": rms})
    rings.sort(key=lambda g: g["radius"])

    kept = np.nonzero(ring_of < 0)[0]
    if len(kept) < 8:
        return none(None, rings)
    map_bins = max(1, min(128, ring_bins))
    mw = span / map_bins
    row = np.clip(np.floor((pr[kept] - r_lo) / mw).astype(np.int64), 0, map_bins - 1)
    t = ((pt[kept] / TAU) * ANGLE_BINS) % ANGLE_BINS
    t0i = np.floor(t).astype(np.int64)
    f = t - t0i
    M = np.zeros((map_bins, ANGLE_BINS))
    np.add.at(M, (row, t0i % ANGLE_BINS), pw[kept] * (1 - f))
    np.add.at(M, (row, (t0i + 1) % ANGLE_BINS), pw[kept] * f)
    M -= M.mean(1, keepdims=True)
    power = (np.abs(np.fft.fft(M, axis=1)) ** 2).sum(0)
    kf = np.minimum(np.arange(ANGLE_BINS), ANGLE_BINS - np.arange(ANGLE_BINS))
    ac = np.real(np.fft.ifft(power * np.exp(-((TAU * kf * BLUR_BINS / ANGLE_BINS) ** 2)))) * ANGLE_BINS
    ac0 = ac[0]
    if not ac0 > 1e-12 * length * length:
        return none(None, rings)

    def ac_at(s):
        tt = s % ANGLE_BINS
        a0 = int(math.floor(tt))
        ff = tt - a0
        return (ac[a0 % ANGLE_BINS] * (1 - ff) + ac[(a0 + 1) % ANGLE_BINS] * ff) / ac0

    scores = {c: sum(ac_at(jj * ANGLE_BINS / c) for jj in range(1, c)) / (c - 1) for c in range(2, max_count + 1)}
    best = max(scores, key=lambda c: (scores[c], -c))
    if scores[best] < REPEAT_MIN_SCORE:
        return none({"count": best, "score": scores[best]}, rings)
    count = best
    for c in range(max_count, best, -1):
        if scores[c] >= max(REPEAT_MIN_SCORE, NEAR_BEST * scores[best]):
            count = c
            break
    pitch = TAU / count

    zr = float((pw[kept] * np.cos(count * pt[kept])).sum())
    zi = float((pw[kept] * np.sin(count * pt[kept])).sum())
    phase = ((math.atan2(zi, zr) / count) % pitch + pitch) % pitch
    rel = _wrap_pi(pt[kept] - phase)
    kq = np.round(rel / pitch).astype(np.int64)
    copy_of = np.full(n, -1)
    off_of = np.zeros(n)
    copy_of[kept] = ((kq % count) + count) % count
    off_of[kept] = rel - kq * pitch
    lengths = np.bincount(copy_of[kept], weights=pw[kept], minlength=count)
    sx = np.bincount(copy_of[kept], weights=pw[kept] * px[kept], minlength=count)
    sy = np.bincount(copy_of[kept], weights=pw[kept] * py[kept], minlength=count)
    mr = mi = 0.0
    for kc in range(count):
        if lengths[kc] > 0:
            dd = float(_wrap_pi(math.atan2(sy[kc], sx[kc]) - phase - kc * pitch))
            mr += lengths[kc] * math.cos(dd)
            mi += lengths[kc] * math.sin(dd)
    raw = phase + math.atan2(mi, mr)
    turned = math.floor(raw / pitch)
    phase = raw - turned * pitch
    typical = float(np.sort(lengths)[len(lengths) >> 1])
    mean_r = float((pw[kept] * pr[kept]).sum() / pw[kept].sum())
    reach = min(REACH_MAX, max(REACH_MIN, REACH_SHARE * mean_r))

    # The pieces turned back onto the first copy's place, tagged by copy.
    tags, segA, segB = [], [], []

    def turn(x, y, by):
        c, s = np.cos(by), np.sin(by)
        return x * c - y * s, x * s + y * c

    for i in kept:
        kc = int(copy_of[i])
        places = [kc]
        if abs(off_of[i]) >= pitch / 4:
            places.append((kc + (1 if off_of[i] > 0 else -1) + count) % count)
        for kp in places:
            a, b = turn(P0[i, 0], P0[i, 1], -kp * pitch)
            c, d = turn(P1[i, 0], P1[i, 1], -kp * pitch)
            tags.append(kp)
            segA.append((a, b))
            segB.append((c, d))
    tags = np.array(tags)
    segA, segB = np.array(segA), np.array(segB)
    cell = {}
    lo = np.floor(np.minimum(segA, segB) / reach).astype(np.int64)
    hi = np.floor(np.maximum(segA, segB) / reach).astype(np.int64)
    for sid in range(len(tags)):
        for gx in range(lo[sid, 0], hi[sid, 0] + 1):
            for gy in range(lo[sid, 1], hi[sid, 1] + 1):
                cell.setdefault((gx, gy), []).append(sid)
    stride = max(1, math.ceil(len(kept) / MEASURED))
    sum_sq = np.zeros(count)
    measured = np.zeros(count)
    worst_of = np.zeros(count)
    for q in range(0, len(kept), stride):
        i = kept[q]
        kc = int(copy_of[i])
        x, y = turn(px[i], py[i], -kc * pitch)
        gx, gy = int(math.floor(x / reach)), int(math.floor(y / reach))
        ids = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                ids += cell.get((gx + dx, gy + dy), [])
        near = np.full(count, reach)
        if ids:
            ids = np.array(ids)
            ids = ids[tags[ids] != kc]
            if len(ids):
                dist = _to_segment(x, y, segA[ids, 0], segA[ids, 1], segB[ids, 0], segB[ids, 1])
                np.minimum.at(near, tags[ids], dist)
        others = np.delete(near, kc)
        dmed = float(np.sort(others)[len(others) >> 1])
        sum_sq[kc] += pw[i] * dmed * dmed
        measured[kc] += pw[i]
        worst_of[kc] = max(worst_of[kc], dmed)
    instances = []
    allsq = weight = worst = 0.0
    worst_instance = 0
    for kc in range(count):
        o = ((kc - turned) % count + count) % count
        l = lengths[o]
        cx, cy = (sx[o] / l, sy[o] / l) if l > 0 else (0.0, 0.0)
        angle = math.atan2(cy, cx)
        ideal = phase + kc * pitch
        instances.append({"angleDeg": (math.degrees(angle) + 360) % 360, "offDeg": math.degrees(float(_wrap_pi(angle - ideal))) if l > 0 else 0.0,
                          "radius": math.hypot(cx, cy), "rms": math.sqrt(sum_sq[o] / measured[o]) if measured[o] > 0 else reach,
                          "worst": float(worst_of[o]) if measured[o] > 0 else reach, "share": float(l / typical) if typical > 0 else 0.0})
        allsq += sum_sq[o]
        weight += measured[o]
        if worst_of[o] > worst:
            worst, worst_instance = float(worst_of[o]), kc
    return {"count": count, "pitchDeg": 360 / count, "phaseDeg": math.degrees(phase), "score": float(scores[count]), "instances": instances,
            "rms": math.sqrt(allsq / weight) if weight > 0 else 0.0, "worst": worst, "worstInstance": worst_instance, "rings": rings, "length": length}
