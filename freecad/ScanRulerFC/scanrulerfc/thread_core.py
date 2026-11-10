# SPDX-License-Identifier: AGPL-3.0-only
# A thread named from a scan: read off the points about a bore's or a boss's
# axis, folded along the helix, and decided against the thread tables.
# Ported from ScanRuler by CNC Kitchen: plugins/reverse/core/threadRead.ts
# (the reading: pitch by the sectors' autocorrelation, window by window;
# crests and roots; the hand; the noise), plugins/thread-match/core/
# shape.ts (the helix fold: a sharper pitch, starts, the tooth, the flank
# angle, the taper), tables.ts (dimensions only), decide.ts (the verdict
# and the measurement that would settle a tie) and identify.ts.
#
# The comments on why each step is the way it is are upstream's, shortened.

import math

import numpy as np

# ---- tables ------------------------------------------------------------------

FAMILIES = [
    {"id": "metric", "label": "ISO metric", "angle": 60, "taper": 0, "inch": False, "source": "ISO 261 sizes, ISO 68-1 profile"},
    {"id": "unc", "label": "Unified coarse (UNC)", "angle": 60, "taper": 0, "inch": True, "source": "ASME B1.1"},
    {"id": "unf", "label": "Unified fine (UNF)", "angle": 60, "taper": 0, "inch": True, "source": "ASME B1.1"},
    {"id": "unef", "label": "Unified extra fine (UNEF)", "angle": 60, "taper": 0, "inch": True, "source": "ASME B1.1"},
    {"id": "npt", "label": "American taper pipe (NPT)", "angle": 60, "taper": 1 / 16, "inch": True, "source": "ASME B1.20.1"},
    {"id": "bspp", "label": "British parallel pipe (G / BSPP)", "angle": 55, "taper": 0, "inch": True, "source": "ISO 228-1"},
    {"id": "bspt", "label": "British taper pipe (R / BSPT)", "angle": 55, "taper": 1 / 16, "inch": True, "source": "ISO 7-1"},
    {"id": "tr", "label": "Metric trapezoidal (Tr)", "angle": 30, "taper": 0, "inch": False, "source": "ISO 2904 (DIN 103)"},
    {"id": "acme", "label": "ACME, general purpose", "angle": 29, "taper": 0, "inch": True, "source": "ASME B1.5"},
    {"id": "print45", "label": "3D printing, 45° flanks", "angle": 90, "taper": 0, "inch": False, "source": "ScanRuler print form (the Thread feature)"},
]
FAMILY_IDS = [f["id"] for f in FAMILIES]
LABEL = {f["id"]: f["label"] for f in FAMILIES}
INCH = 25.4

METRIC = [
    (1, [0.25, 0.2]), (1.2, [0.25, 0.2]), (1.4, [0.3, 0.2]), (1.6, [0.35, 0.2]), (2, [0.4, 0.25]), (2.5, [0.45, 0.35]),
    (3, [0.5, 0.35]), (3.5, [0.6, 0.35]), (4, [0.7, 0.5]), (5, [0.8, 0.5]), (6, [1, 0.75]), (7, [1, 0.75]),
    (8, [1.25, 1, 0.75]), (10, [1.5, 1.25, 1, 0.75]), (12, [1.75, 1.5, 1.25, 1]), (14, [2, 1.5, 1.25, 1]), (16, [2, 1.5, 1]),
    (18, [2.5, 2, 1.5, 1]), (20, [2.5, 2, 1.5, 1]), (22, [2.5, 2, 1.5, 1]), (24, [3, 2, 1.5, 1]), (27, [3, 2, 1.5, 1]),
    (30, [3.5, 3, 2, 1.5, 1]), (33, [3.5, 3, 2, 1.5]), (36, [4, 3, 2, 1.5]), (39, [4, 3, 2, 1.5]), (42, [4.5, 4, 3, 2, 1.5]),
    (45, [4.5, 4, 3, 2, 1.5]), (48, [5, 4, 3, 2, 1.5]), (52, [5, 4, 3, 2, 1.5]), (56, [5.5, 4, 3, 2, 1.5]), (60, [5.5, 4, 3, 2, 1.5]),
    (64, [6, 4, 3, 2, 1.5]),
]
UNC = [
    ("#1", 0.073, 64), ("#2", 0.086, 56), ("#3", 0.099, 48), ("#4", 0.112, 40), ("#5", 0.125, 40), ("#6", 0.138, 32),
    ("#8", 0.164, 32), ("#10", 0.19, 24), ("#12", 0.216, 24), ("1/4", 0.25, 20), ("5/16", 0.3125, 18), ("3/8", 0.375, 16),
    ("7/16", 0.4375, 14), ("1/2", 0.5, 13), ("9/16", 0.5625, 12), ("5/8", 0.625, 11), ("3/4", 0.75, 10), ("7/8", 0.875, 9),
    ("1", 1, 8), ("1-1/8", 1.125, 7), ("1-1/4", 1.25, 7), ("1-3/8", 1.375, 6), ("1-1/2", 1.5, 6), ("1-3/4", 1.75, 5), ("2", 2, 4.5),
]
UNF = [
    ("#0", 0.06, 80), ("#1", 0.073, 72), ("#2", 0.086, 64), ("#3", 0.099, 56), ("#4", 0.112, 48), ("#5", 0.125, 44),
    ("#6", 0.138, 40), ("#8", 0.164, 36), ("#10", 0.19, 32), ("#12", 0.216, 28), ("1/4", 0.25, 28), ("5/16", 0.3125, 24),
    ("3/8", 0.375, 24), ("7/16", 0.4375, 20), ("1/2", 0.5, 20), ("9/16", 0.5625, 18), ("5/8", 0.625, 18), ("3/4", 0.75, 16),
    ("7/8", 0.875, 14), ("1", 1, 12), ("1-1/8", 1.125, 12), ("1-1/4", 1.25, 12), ("1-3/8", 1.375, 12), ("1-1/2", 1.5, 12),
]
UNEF = [
    ("#12", 0.216, 32), ("1/4", 0.25, 32), ("5/16", 0.3125, 32), ("3/8", 0.375, 32), ("7/16", 0.4375, 28), ("1/2", 0.5, 28),
    ("9/16", 0.5625, 24), ("5/8", 0.625, 24), ("11/16", 0.6875, 24), ("3/4", 0.75, 20), ("13/16", 0.8125, 20), ("7/8", 0.875, 20),
    ("15/16", 0.9375, 20), ("1", 1, 20), ("1-1/16", 1.0625, 18), ("1-1/8", 1.125, 18), ("1-1/4", 1.25, 18), ("1-3/8", 1.375, 18),
    ("1-1/2", 1.5, 18), ("1-5/8", 1.625, 18),
]
NPT = [
    ("1/16", 27, 0.3125), ("1/8", 27, 0.405), ("1/4", 18, 0.54), ("3/8", 18, 0.675), ("1/2", 14, 0.84), ("3/4", 14, 1.05),
    ("1", 11.5, 1.315), ("1-1/4", 11.5, 1.66), ("1-1/2", 11.5, 1.9), ("2", 11.5, 2.375), ("2-1/2", 8, 2.875), ("3", 8, 3.5),
    ("3-1/2", 8, 4), ("4", 8, 4.5),
]
BSP = [
    ("1/16", 28, 7.723, True), ("1/8", 28, 9.728, True), ("1/4", 19, 13.157, True), ("3/8", 19, 16.662, True),
    ("1/2", 14, 20.955, True), ("5/8", 14, 22.911, False), ("3/4", 14, 26.441, True), ("7/8", 14, 30.201, False),
    ("1", 11, 33.249, True), ("1-1/8", 11, 37.897, False), ("1-1/4", 11, 41.91, True), ("1-1/2", 11, 47.803, True),
    ("1-3/4", 11, 53.746, False), ("2", 11, 59.614, True), ("2-1/2", 11, 75.184, True), ("3", 11, 87.884, True), ("4", 11, 113.03, True),
]
TR = [
    (8, [1.5, 2]), (9, [2, 1.5]), (10, [2, 1.5]), (11, [2, 3]), (12, [3, 2]), (14, [3, 2]), (16, [4, 2]), (18, [4, 2]),
    (20, [4, 2]), (22, [5, 3, 8]), (24, [5, 3, 8]), (26, [5, 3, 8]), (28, [5, 3, 8]), (30, [6, 3, 10]), (32, [6, 3, 10]),
    (36, [6, 3, 10]), (40, [7, 3, 10]), (44, [7, 3, 12]), (48, [8, 3, 12]), (50, [8, 3, 12]), (52, [8, 3, 12]), (60, [9, 3, 14]),
]
ACME = [
    ("1/4", 0.25, 16), ("5/16", 0.3125, 14), ("3/8", 0.375, 12), ("7/16", 0.4375, 12), ("1/2", 0.5, 10), ("5/8", 0.625, 8),
    ("3/4", 0.75, 6), ("7/8", 0.875, 6), ("1", 1, 5), ("1-1/8", 1.125, 5), ("1-1/4", 1.25, 5), ("1-3/8", 1.375, 4),
    ("1-1/2", 1.5, 4), ("1-3/4", 1.75, 4), ("2", 2, 4), ("2-1/4", 2.25, 3), ("2-1/2", 2.5, 3), ("2-3/4", 2.75, 3), ("3", 3, 2),
    ("3-1/2", 3.5, 2), ("4", 4, 2), ("4-1/2", 4.5, 2), ("5", 5, 2),
]
V60_DEPTH = (5 / 8) * (math.sqrt(3) / 2)


def r3(v):
    return round(float(v), 3) + 0.0


def r4(v):
    return round(float(v), 4) + 0.0


def _trim(v):
    return f"{round(v, 4):g}"


def _print_pitch(coarse):
    p = coarse * V60_DEPTH / 0.3
    step = 0.25 if p < 3 else 0.5
    return round(p / step) * step


def _tr_clearance(p):
    return 0.15 if p <= 1.5 else 0.25 if p <= 5 else 0.5 if p <= 12 else 1


def _build():
    rows = []

    def v60(family, size, d, p, designation, tpi=None):
        rows.append({"family": family, "size": size, "designation": designation, "major": r4(d), "pitch": r4(p), **({"tpi": tpi} if tpi else {}),
                     "minorExternal": r4(d - 1.226869 * p), "minorInternal": r4(d - 1.082532 * p), "angle": 60, "taper": 0, "depthShare": r4(V60_DEPTH)})

    for d, pitches in METRIC:
        for p in pitches:
            v60("metric", f"M{d:g}", d, p, f"M{d:g}×{_trim(p)}")
    for family, table in (("unc", UNC), ("unf", UNF), ("unef", UNEF)):
        for size, din, tpi in table:
            v60(family, size, din * INCH, INCH / tpi, f"{size}-{tpi:g} {family.upper()}", tpi)
    for size, tpi, od in NPT:
        d, p = od * INCH, INCH / tpi
        rows.append({"family": "npt", "size": size, "designation": f"{size}-{tpi:g} NPT", "major": r4(d), "pitch": r4(p), "tpi": tpi,
                     "minorExternal": r4(d - 1.6 * p), "minorInternal": r4(d - 1.6 * p), "angle": 60, "taper": 1 / 16, "depthShare": 0.8})
    for size, tpi, d, tapered in BSP:
        p = INCH / tpi
        common = {"size": size, "major": r4(d), "pitch": r4(p), "tpi": tpi, "minorExternal": r4(d - 1.280654 * p), "minorInternal": r4(d - 1.280654 * p), "angle": 55, "depthShare": 0.6403}
        rows.append({"family": "bspp", "designation": f"G {size}", "taper": 0, **common})
        if tapered:
            rows.append({"family": "bspt", "designation": f"R {size}", "taper": 1 / 16, "note": "R external, Rc tapered internal, Rp parallel internal (ISO 7-1)", **common})
    for d, pitches in TR:
        for p in pitches:
            ac = _tr_clearance(p)
            row = {"family": "tr", "size": f"Tr{d}", "designation": f"Tr{d}×{_trim(p)}", "major": d, "pitch": p, "minorExternal": r4(d - 2 * (p / 2 + ac)),
                   "minorInternal": r4(d - p), "angle": 30, "taper": 0, "depthShare": r4(0.5 + ac / p)}
            if d == 8 and p == 2:
                row["note"] = "Common on 3D-printer lead screws as Tr8×8 (P2): 4 starts, 8 mm lead"
            rows.append(row)
    for size, din, tpi in ACME:
        d, p = din * INCH, INCH / tpi
        rows.append({"family": "acme", "size": size, "designation": f"{size}-{tpi:g} ACME", "major": r4(d), "pitch": r4(p), "tpi": tpi,
                     "minorExternal": r4(d - p), "minorInternal": r4(d - p), "angle": 29, "taper": 0, "depthShare": 0.5})
    for d, pitches in METRIC:
        if d < 3:
            continue
        coarse = pitches[0]
        for p in (_print_pitch(coarse), coarse):
            rows.append({"family": "print45", "size": f"Ø{d:g}", "designation": f"Ø{d:g}×{_trim(p)} print", "major": d, "pitch": p,
                         "minorExternal": r4(d - 0.6 * p), "minorInternal": r4(d - 0.6 * p), "angle": 90, "taper": 0, "depthShare": 0.3})
    return rows


ROWS = _build()


def rows_of(families):
    return [r for r in ROWS if r["family"] in families]


def lookup(designation):
    def key(s):
        return "".join(s.lower().split()).replace("x", "×")

    k = key(designation)
    return next((r for r in ROWS if key(r["designation"]) == k), None)


# ---- the reading (reverse.thread.read) --------------------------------------

PITCH_MIN, PITCH_MAX = 0.15, 8
PROFILE_BINS, BIN_MIN = 400, 0.01
GAP_SHARE = 0.25
SECTORS = 12
STRENGTH_MIN = 0.25
CONTRAST_MIN = 3
FIRST_PEAK_SHARE = 0.75
LAG_SHARE = 0.6
WALL_FACING = 0.8
WINDOW_MM, WINDOW_STEP, WINDOWS_MAX = 2.5, 0.2, 16
SECTOR_LINE_MIN = 8
AGREE_SHARE = 0.06


def _basis(d):
    u0 = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(d, u0)
    u /= np.linalg.norm(u)
    return u, np.cross(d, u)


def binned_median(b, values, nbins):
    """The upper median of `values` in each of `nbins` bins (NaN where
    empty) and the counts — a list's [floor(len/2)] after sorting, as
    upstream takes it."""
    b = np.asarray(b, dtype=np.int64)
    out = np.full(nbins, np.nan)
    counts = np.bincount(b, minlength=nbins)
    if not len(b):
        return out, counts
    order = np.lexsort((values, b))
    starts = np.concatenate([[0], np.cumsum(counts)[:-1]])
    have = counts > 0
    out[have] = np.asarray(values)[order][starts[have] + counts[have] // 2]
    return out, counts


def _median(xs):
    return float(np.median(np.asarray(xs, dtype=float)))


def _detrend(v):
    n = len(v)
    if n < 2:
        return v
    i = np.arange(n, dtype=float)
    slope, icept = np.polyfit(i, v, 1)
    return v - (icept + slope * i)


def _window_read(zs, rs, sec, frm, to):
    none = {"pitch": None, "strength": 0.0, "contrast": None}
    length = to - frm
    bin_ = max(BIN_MIN, length / PROFILE_BINS)
    bins = max(1, math.ceil(length / bin_))
    inside = (zs >= frm) & (zs <= to)
    bi = np.minimum(bins - 1, np.floor((zs[inside] - frm) / bin_).astype(np.int64))
    profiles = []
    for s in range(SECTORS):
        m = sec[inside] == s
        med, cnt = binned_median(bi[m], rs[inside][m], bins)
        filled = int((cnt > 0).sum())
        if filled < SECTOR_LINE_MIN:
            continue
        # The longest run of empty bins.
        longest = run = 0
        for c in cnt:
            run = 0 if c else run + 1
            longest = max(longest, run)
        if longest > bins * GAP_SHARE:
            continue
        # Empty bins carry the last value; leading ones the first.
        last = np.nan
        for k in range(bins):
            if np.isnan(med[k]):
                med[k] = last
            else:
                last = med[k]
        first = med[~np.isnan(med)][0]
        med[np.isnan(med)] = first
        profiles.append(_detrend(med))
    lag_min = max(2, round(PITCH_MIN / bin_))
    lag_max = min(int(bins * LAG_SHARE), round(PITCH_MAX / bin_))
    if not lag_max > lag_min + 2 or not profiles:
        return none
    ac = np.zeros(lag_max + 1)
    weighed = 0
    for p in profiles:
        norm = float(p @ p)
        if not norm > 0:
            continue
        weighed += 1
        full = np.correlate(p, p, "full")[bins - 1:]
        L = np.arange(lag_min, lag_max + 1)
        ac[L] += full[L] / norm * (bins / (bins - L))
    if not weighed:
        return none
    ac[lag_min:] /= weighed
    start = lag_min
    while start < lag_max and ac[start + 1] <= ac[start]:
        start += 1
    best = float(ac[start:lag_max + 1].max())
    weak = {**none, "strength": min(1.0, max(0.0, best))}
    if not best >= STRENGTH_MIN:
        return weak
    at = -1
    for L in range(max(lag_min + 1, start), lag_max):
        if ac[L] >= ac[L - 1] and ac[L] >= ac[L + 1] and ac[L] >= FIRST_PEAK_SHARE * best:
            at = L
            break
    if at < 0:
        return weak
    y0, y1, y2 = ac[at - 1], ac[at], ac[at + 1]
    den = y0 - 2 * y1 + y2
    shift = max(-1.0, min(1.0, 0.5 * (y0 - y2) / den)) if abs(den) > 1e-12 else 0.0
    pitch = (at + shift) * bin_
    phases = max(4, min(24, round(pitch / bin_)))
    heights = []
    zc = (np.arange(bins) + 0.5) * bin_
    k = np.minimum(phases - 1, np.floor(((zc / pitch) % 1) * phases).astype(np.int64))
    for p in profiles:
        s = np.bincount(k, weights=p, minlength=phases)
        c = np.bincount(k, minlength=phases)
        v = s[c > 0] / c[c > 0]
        if v.max() > v.min():
            heights.append(float(v.max() - v.min()))
    heights.sort()
    return {"pitch": float(pitch), "strength": min(1.0, max(0.0, float(y1))), "contrast": heights[len(heights) >> 1] if heights else 0.0}


def _agree_on(reads):
    read = [w for w in reads if w["pitch"] is not None]
    best, best_s = [], -math.inf
    for w in read:
        near = [x for x in read if abs(x["pitch"] - w["pitch"]) <= AGREE_SHARE * w["pitch"]]
        s = sum(x["strength"] for x in near)
        if len(near) > len(best) or (len(near) == len(best) and s > best_s):
            best, best_s = near, s
    return best


def read_thread(points, normals, origin, direction, radius, band, half_length):
    """The thread in a shell of points about an axis (reverse.thread.read);
    None with under 20 points on the wall."""
    d = np.asarray(direction, float)
    d /= np.linalg.norm(d)
    u, v = _basis(d)
    q = np.asarray(points, float) - np.asarray(origin, float)
    z = q @ d
    radial = q - np.outer(z, d)
    r = np.linalg.norm(radial, axis=1)
    keep = (np.abs(z) <= half_length) & (np.abs(r - radius) <= band)
    off_wall = 0
    with_normals = normals is not None and len(normals) == len(points)
    if with_normals:
        N = np.asarray(normals, float)
        facing_axis = np.abs(N @ d) > WALL_FACING
        off_wall = int((keep & facing_axis).sum())
        keep &= ~facing_axis
    zs, rs = z[keep], r[keep]
    ths = np.arctan2(radial[keep] @ v, radial[keep] @ u)
    m = len(zs)
    if m < 20:
        return None
    facing = float(np.sum((N[keep] * radial[keep]).sum(axis=1) / np.maximum(rs, 1e-9))) if with_normals else 0.0
    internal = True if facing / m < -0.3 else False if facing / m > 0.3 else None
    z_min, z_max = float(zs.min()), float(zs.max())
    span = z_max - z_min
    sec = np.minimum(SECTORS - 1, np.floor((ths + math.pi) / (2 * math.pi) * SECTORS).astype(np.int64))

    window_mm = max(WINDOW_MM, radius)
    count = 1 if span <= window_mm * 1.2 else min(WINDOWS_MAX, math.ceil((span - window_mm) / (window_mm * WINDOW_STEP)) + 1)
    wlen = span if count == 1 else window_mm
    wstep = 0 if count == 1 else (span - wlen) / (count - 1)
    reads = []
    for k in range(count):
        frm = z_min + k * wstep
        to = z_max if count == 1 else frm + wlen
        reads.append({"from": frm, "to": to, **_window_read(zs, rs, sec, frm, to)})
    agreeing = _agree_on(reads)
    agree = len(agreeing)
    if agree == 0 and count > 1:
        whole = {"from": z_min, "to": z_max, **_window_read(zs, rs, sec, z_min, z_max)}
        if whole["pitch"] is not None:
            agreeing = [whole]
    pitch = _median([w["pitch"] for w in agreeing]) if agreeing else None
    strength = _median([w["strength"] for w in agreeing]) if agreeing else max([0.0] + [w["strength"] for w in reads])
    contrast = _median([w["contrast"] or 0 for w in agreeing]) if agreeing else None
    threaded = [min(w["from"] for w in agreeing), max(w["to"] for w in agreeing)] if agreeing else None

    on = np.ones(m, bool) if not threaded else (zs >= threaded[0]) & (zs <= threaded[1])
    reach = threaded[1] - threaded[0] if threaded else span
    lines = np.full(m, np.nan)
    levels = []
    for s in range(SECTORS):
        idx = np.nonzero(on & (sec == s))[0]
        if len(idx) < SECTOR_LINE_MIN:
            continue
        zz, rr = zs[idx], rs[idx]
        zm, rm = zz.mean(), rr.mean()
        szz = float(((zz - zm) ** 2).sum())
        slope = float(((zz - zm) * (rr - rm)).sum()) / szz if zz.max() - zz.min() >= reach / 2 and szz > 1e-12 else 0.0
        lines[idx] = rm + slope * (zz - zm)
        levels.append(rm)
    centre = _median(levels) if levels else _median(rs[on])
    dev = np.zeros(m)
    dev[on] = rs[on] - np.where(np.isnan(lines[on]), centre, lines[on])
    sorted_dev = np.sort(dev[on])

    def pct(p):
        return float(sorted_dev[min(len(sorted_dev) - 1, int(p * len(sorted_dev)))])

    low, high = centre + pct(0.05), centre + pct(0.95)

    left_handed, hand_conf = None, 0.0
    if pitch is not None:
        lo_cut, hi_cut = pct(0.15), pct(0.85)
        oi = np.nonzero(on)[0]
        dv = dev[oi]
        lo_m, hi_m = dv <= lo_cut, dv >= hi_cut

        def agreement(sign):
            ph = (zs[oi] - sign * pitch * ths[oi] / (2 * math.pi)) / pitch * 2 * math.pi
            out = 0.0
            for mm in (lo_m, hi_m):
                if mm.any():
                    out += math.hypot(np.cos(ph[mm]).sum(), np.sin(ph[mm]).sum()) / mm.sum()
            return out

        right, left = agreement(1), agreement(-1)
        if max(right, left) > 0.05:
            left_handed = bool(left > right)
            hand_conf = abs(left - right) / max(left, right)

    bin_ = max(BIN_MIN, span / PROFILE_BINS)
    bins = max(1, math.ceil(span / bin_))
    bo = np.minimum(bins - 1, np.floor((zs - z_min) / bin_).astype(np.int64))
    key = sec * bins + bo
    med, cnt = binned_median(key, rs, SECTORS * bins)
    ok = cnt[key] >= 2
    devs = np.abs(rs[ok] - med[key[ok]])
    noise = 1.4826 * float(np.sort(devs)[len(devs) >> 1]) if len(devs) else 0.0
    prof_med, _c = binned_median(bo, rs, bins)
    stride = max(1, math.ceil(bins / 200))
    profile = [{"z": r3(z_min + (b + 0.5) * bin_), "r": r3(prof_med[b])} for b in range(0, bins, stride) if not np.isnan(prof_med[b])]
    return {
        "points": m, "offWall": off_wall, "span": [r3(z_min), r3(z_max)],
        "radius": {"mean": r3(centre), "low": r3(low), "high": r3(high)},
        "minor": r3(2 * low), "major": r3(2 * high), "depth": r3(high - low), "internal": internal,
        "pitch": None if pitch is None else r4(pitch), "strength": r3(strength), "contrast": None if contrast is None else r4(contrast),
        "noise": r4(noise), "leftHanded": left_handed, "handConfidence": r3(hand_conf),
        "windows": [{"from": r3(w["from"]), "to": r3(w["to"]), "pitch": None if w["pitch"] is None else r4(w["pitch"]), "strength": r3(w["strength"]),
                     "contrast": None if w["contrast"] is None else r4(w["contrast"])} for w in reads],
        "agree": agree, "threaded": [r3(threaded[0]), r3(threaded[1])] if threaded else None, "profile": profile,
    }


def is_thread(r):
    return r["pitch"] is not None and r["contrast"] is not None and r["contrast"] >= CONTRAST_MIN * r["noise"]


# ---- the helix fold (thread-match shape) -------------------------------------

BINS_MIN, BINS_MAX = 16, 64
SEARCH, STEP, FINE = 0.03, 0.0006, 0.00005
STARTS_MAX = 4
STARTS_GAIN = 1.25
FLANK_PITCH_MIN = 0.9


def _wall_fit(z, th, value):
    c, s = np.cos(th), np.sin(th)
    A = np.column_stack([np.ones_like(z), c, s, z * c, z * s, z])
    ata = A.T @ A
    inv = np.linalg.pinv(ata)
    coef = inv @ (A.T @ value)
    resid = value - A @ coef
    sigma2 = float(resid @ resid) / max(1, len(z) - 6)
    return coef, math.sqrt(max(0.0, sigma2 * inv[5, 5])), resid


def _phases(z, th, pitch, lead, left):
    s = -1 if left else 1
    u = (z - s * lead * th / (2 * math.pi)) / pitch
    return u - np.floor(u)


def _sharpness(values, phase, bins, total):
    b = np.minimum(bins - 1, np.floor(phase * bins).astype(np.int64))
    s = np.bincount(b, weights=values, minlength=bins)
    c = np.bincount(b, minlength=bins)
    h = c > 0
    w = c[h].sum()
    return float((c[h] * (s[h] / c[h]) ** 2).sum() / w / total) if w > 0 and total > 0 else 0.0


def _fold_medians(values, phase, bins):
    b = np.minimum(bins - 1, np.floor(phase * bins).astype(np.int64))
    med, _c = binned_median(b, values, bins)
    for k in range(bins):
        if np.isnan(med[k]):
            v = (med[(k - 1) % bins] + med[(k + 1) % bins]) / 2
            med[k] = 0.0 if np.isnan(v) or v == 0 else v
    return list(med)


def _flanks(tooth, pitch):
    n = len(tooth)
    hi = int(np.argmax(tooth))
    lo = int(np.argmin(tooth))
    depth = tooth[hi] - tooth[lo]
    if depth <= 0:
        return None
    a, b = tooth[lo] + 0.25 * depth, tooth[lo] + 0.75 * depth

    def run(start, end):
        xs, ys = [], []
        k, x = start, 0
        while True:
            v = tooth[k]
            if a <= v <= b:
                xs.append(x * pitch / n)
                ys.append(v)
            if k == end:
                break
            k = (k + 1) % n
            x += 1
        if len(xs) < 3:
            return None
        xs, ys = np.array(xs), np.array(ys)
        dx, dy = xs - xs.mean(), ys - ys.mean()
        sxx, syy, sxy = float(dx @ dx), float(dy @ dy), float(dx @ dy)
        if sxx == 0 or syy == 0:
            return None
        return {"slope": sxy / sxx, "r2": sxy * sxy / (sxx * syy), "count": len(xs)}

    rise, fall = run(lo, hi), run(hi, lo)
    if not rise or not fall:
        return None

    def half(s):
        return math.degrees(math.atan(1 / abs(s)))

    fit = min(rise["r2"], fall["r2"])
    return {"half": [half(rise["slope"]), half(fall["slope"])], "ok": fit > 0.9 and min(rise["count"], fall["count"]) >= 4, "fit": fit}


def read_shape(points, origin, direction, radius, band, frm, to, pitch0):
    """The thread folded along its helix; None with too few points or under
    two turns."""
    d = np.asarray(direction, float)
    d /= np.linalg.norm(d)
    # e1, e2, dir right-handed, so the hand reads the same whichever way the
    # axis was given.
    a = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = a - (a @ d) * d
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(d, e1)
    q = np.asarray(points, float) - np.asarray(origin, float)
    z = q @ d
    x, y = q @ e1, q @ e2
    r = np.hypot(x, y)
    keep = (z >= frm) & (z <= to) & (np.abs(r - radius) <= band)
    z, th, r = z[keep], np.arctan2(y[keep], x[keep]), r[keep]
    n = len(z)
    if n < 200 or not pitch0 > 0:
        return None
    length = to - frm
    if length / pitch0 < 2:
        return None
    bins = max(BINS_MIN, min(BINS_MAX, n // 40))
    _c, _se, rho = _wall_fit(z, th, r)
    total = float(rho @ rho) / n

    def score_at(pitch, left, starts):
        return _sharpness(rho, _phases(z, th, pitch, starts * pitch, left), bins, total)

    best = {"score": -1.0, "pitch": pitch0, "left": False, "starts": 1}
    one = 0.0
    ks = np.arange(-SEARCH, SEARCH + 1e-12, STEP)
    for starts in range(1, STARTS_MAX + 1):
        for left in (False, True):
            local = -1.0
            for k in ks:
                p = pitch0 * (1 + k)
                s = score_at(p, left, starts)
                local = max(local, s)
                need = best["score"] if starts == 1 else max(best["score"], one * STARTS_GAIN)
                if s > need:
                    best = {"score": s, "pitch": p, "left": left, "starts": starts}
            if starts == 1:
                one = max(one, local)
    curve = []
    for k in np.arange(-STEP * 2, STEP * 2 + 1e-12, FINE):
        p = best["pitch"] * (1 + k)
        s = score_at(p, best["left"], best["starts"])
        curve.append((p, s))
        if s > best["score"]:
            best = {**best, "score": s, "pitch": p}
    kept = [p for p, s in curve if s >= 0.9 * best["score"]]
    width = max(kept) - min(kept) if len(kept) > 1 else FINE * best["pitch"]
    pitch_sigma = max(width / 2, best["pitch"] * 2e-4)

    phase = _phases(z, th, best["pitch"], best["starts"] * best["pitch"], best["left"])
    tooth = np.array(_fold_medians(rho, phase, bins))

    def tooth_at():
        xx = phase * bins - 0.5
        b0 = np.floor(xx).astype(np.int64)
        f = xx - b0
        return tooth[b0 % bins] * (1 - f) + tooth[(b0 + 1) % bins] * f

    c, taper_se, _r = _wall_fit(z, th, r - tooth_at())
    z_mid = (frm + to) / 2
    cs, sn = np.cos(th), np.sin(th)
    rho = r - (c[0] + c[1] * cs + c[2] * sn + c[3] * z * cs + c[4] * z * sn + c[5] * z)
    tooth = np.array(_fold_medians(rho, phase, bins))
    noise = 1.4826 * float(np.median(np.abs(rho - tooth_at())))
    lo = int(np.argmin(tooth))
    rolled = [float(tooth[(i + lo) % bins]) for i in range(bins)]
    hi_v, lo_v = max(rolled), min(rolled)
    depth = hi_v - lo_v
    f = _flanks(rolled, best["pitch"]) if depth > 3 * noise else None
    wall = c[0] + c[5] * z_mid
    return {
        "points": n, "pitch": r4(best["pitch"]), "pitchSigma": r4(pitch_sigma), "leftHanded": best["left"], "starts": best["starts"],
        "lead": r4(best["starts"] * best["pitch"]), "sharpness": r3(best["score"]), "tooth": [r3(t) for t in rolled],
        "depth": r3(depth), "depthShare": r3(depth / best["pitch"]),
        "flankAngle": round(f["half"][0] + f["half"][1], 1) if f else None,
        "halfAngles": [round(f["half"][0], 1), round(f["half"][1], 1)] if f else None,
        "flankConfidence": ("high" if f["ok"] and depth > 6 * noise and best["pitch"] >= FLANK_PITCH_MIN else "low") if f else None,
        "taper": r4(2 * c[5]), "taperSigma": r4(max(2 * taper_se, 1e-4)),
        "crestDiameter": r3(2 * (wall + hi_v)), "rootDiameter": r3(2 * (wall + lo_v)), "noise": r4(noise), "length": r3(length),
    }


# ---- the decision (thread-match decide, identify) ---------------------------

NEAR_PITCH, NEAR_DIAMETER = 0.12, 0.08
PITCH_FLOOR, DIAMETER_FLOOR = 0.01, 0.05
PIPE_TAPER = 1 / 16
DEPTH_SLACK = 1.15


def flank_slack(pitch):
    return 4 if pitch >= 1.5 else 6 if pitch >= 0.9 else 12


def _fmt(v):
    return f"{round(v, 2):g}"


def reading_of(read, shape, floor_mm=0.0):
    """What the decision takes: the reading, sharpened by the fold where
    there is one; the noise raised to the scan noise to plan with."""
    if read["pitch"] is None:
        return None
    rng = read["threaded"] or read["span"]
    ws = [w["pitch"] for w in read.get("windows", []) if w["pitch"] is not None]
    mean = sum(ws) / len(ws) if ws else read["pitch"]
    sd = math.sqrt(sum((v - mean) ** 2 for v in ws) / (len(ws) - 1)) if len(ws) > 1 else read["pitch"] * 0.02
    sh = shape or {}
    return {
        "pitch": sh.get("pitch", read["pitch"]),
        "pitchSigma": sh.get("pitchSigma", max(sd / math.sqrt(max(1, len(ws))), read["pitch"] * 0.005)),
        "major": read["major"], "minor": read["minor"], "internal": read["internal"],
        "noise": max(read["noise"], sh.get("noise", 0), floor_mm),
        "length": sh.get("length", rng[1] - rng[0]),
        "flankAngle": sh.get("flankAngle"), "flankConfidence": sh.get("flankConfidence"),
        "taper": sh.get("taper") if shape else None, "taperSigma": sh.get("taperSigma") if shape else None,
        "depthShare": sh.get("depthShare") if shape else None,
    }


def taper_state(rd):
    if rd["taper"] is None or rd["taperSigma"] is None:
        return "unclear"
    s = max(rd["taperSigma"], 0.003)
    from_zero = abs(rd["taper"]) / s
    from_pipe = abs(abs(rd["taper"]) - PIPE_TAPER) / s
    if from_zero >= 3 and from_pipe < 3:
        return "tapered"
    if from_zero < 3 and from_pipe >= 3:
        return "parallel"
    return "unclear"


def _diameter_tol(rd, d):
    return max(6 * rd["noise"] / d, DIAMETER_FLOOR)


def _score(row, rd, taper_read, pitch_tol):
    pitch_off = abs(row["pitch"] - rd["pitch"]) / row["pitch"]
    read_d = rd["minor"] if rd["internal"] is True else rd["major"] if rd["internal"] is False else None
    row_d = row["minorInternal"] if rd["internal"] is True else row["major"]
    slack = row["taper"] * rd["length"]

    def off(a, b):
        return max(0.0, abs(a - b) - slack) / row["major"]

    diameter_off = min(off(row["major"], rd["major"]), off(row["minorInternal"], rd["minor"])) if read_d is None else off(row_d, read_d)
    against, penalty = [], 0.0
    if rd["flankAngle"] is not None and rd["flankConfidence"] == "high":
        dev = abs(rd["flankAngle"] - row["angle"])
        sl = flank_slack(rd["pitch"])
        if dev > sl:
            against.append(f"flank reads {_fmt(rd['flankAngle'])}°, the {LABEL[row['family']]} form is {row['angle']}°")
            penalty += (dev - sl) / 60
    if rd["depthShare"] is not None and rd["depthShare"] - rd["noise"] / rd["pitch"] > row["depthShare"] * DEPTH_SLACK:
        against.append(f"the tooth reads {_fmt(rd['depthShare'])} of the pitch deep, deeper than the {LABEL[row['family']]} form's {_fmt(row['depthShare'])}")
        penalty += 0.3
    if taper_read == "tapered" and row["taper"] == 0:
        against.append("the wall tapers; this thread is parallel")
        penalty += 0.3
    if taper_read == "parallel" and row["taper"] > 0:
        against.append("the wall is parallel; this thread tapers 1:16")
        penalty += 0.3
    out = {"family": row["family"], "designation": row["designation"], "major": row["major"], "pitch": row["pitch"]}
    if row.get("tpi"):
        out["tpi"] = row["tpi"]
    out.update(angle=row["angle"], taper=row["taper"], pitchOff=r3(pitch_off), diameterOff=r3(diameter_off), against=against,
               score=r3(2 * pitch_off + diameter_off + penalty),
               consistent=pitch_off <= pitch_tol and diameter_off <= _diameter_tol(rd, row["major"]) and not against)
    if row.get("note"):
        out["note"] = row["note"]
    return out


def _dedupe(lst):
    seen, out = set(), []
    for s in lst:
        if s["designation"] not in seen:
            seen.add(s["designation"])
            out.append(s)
    return out


def _minor_of(s):
    row = next((r for r in rows_of([s["family"]]) if r["designation"] == s["designation"]), None)
    return row["minorInternal"] if row else s["major"]


def _deciding(tied, rd):
    out = []

    def every(f):
        return [{"designation": s["designation"], "value": f(s)} for s in tied]

    if len({f"{s['pitch']:.4f}" for s in tied}) > 1:
        spread = max(s["pitch"] for s in tied) - min(s["pitch"] for s in tied)
        inch = any(s.get("tpi") for s in tied)
        out.append(({"measure": "Count the crests over 25.4 mm (1 inch) with a ruler or a thread pitch gauge, or measure across 10 crests with calipers" if inch
                     else "Measure across 10 crests with calipers (11 crests, 10 gaps), or try a thread pitch gauge",
                     "expect": every(lambda s: f"{_fmt(10 * s['pitch'])} mm over 10 pitches" + (f", {s['tpi']:g} per inch" if s.get("tpi") else "")),
                     "separation": f"{_fmt(10 * spread)} mm over 10 pitches"}, 10 * spread))

    def d_of(s):
        return _minor_of(s) if rd["internal"] is True else s["major"]

    ds = [d_of(s) for s in tied]
    spread = max(ds) - min(ds)
    if spread > 0.01:
        where = ("the bore across its crests (the minor diameter) with pin gauges or the calipers’ inside jaws" if rd["internal"] is True
                 else "the crests (the major diameter) with calipers, square across the thread")
        out.append(({"measure": f"Measure {where}", "expect": [{"designation": s["designation"], "value": f"{_fmt(d_of(s))} mm"} for s in tied],
                     "separation": f"{_fmt(spread)} mm"}, spread / 2 if spread < 0.1 else spread))
    angles = {s["angle"] for s in tied}
    if len(angles) > 1:
        sp = max(angles) - min(angles)
        out.append(({"measure": "Hold a 55°/60° thread gauge (a screw pitch gauge marked for both, or a centre gauge) against the flanks and look for light",
                     "expect": every(lambda s: f"{s['angle']}°"), "separation": f"{sp}°"}, sp / 20))
    if len({s["taper"] for s in tied}) > 1:
        L = max(rd["length"], 10)
        out.append(({"measure": f"Measure the {'bore' if rd['internal'] is True else 'crests'} at each end of the thread, {_fmt(L)} mm apart, and compare",
                     "expect": every(lambda s: f"{_fmt(L / 16)} mm larger at one end" if s["taper"] > 0 else "the same at both ends"),
                     "separation": f"{_fmt(L / 16)} mm"}, L / 16))
    out.sort(key=lambda x: -x[1])
    return [x[0] for x in out]


def decide(rd, families, pitch_floor=PITCH_FLOOR):
    taper_read = taper_state(rd)
    pitch_tol = max(3 * rd["pitchSigma"] / rd["pitch"], pitch_floor)
    scored = sorted((_score(row, rd, taper_read, pitch_tol) for row in rows_of(families)), key=lambda s: s["score"])
    best = scored[0] if scored else None
    tolerance = {"pitch": r3(pitch_tol), "diameter": r3(_diameter_tol(rd, best["major"] if best else rd["major"]))}
    tied_rows = _dedupe([s for s in scored if s["consistent"]])
    near = best if best and best["pitchOff"] <= NEAR_PITCH and best["diameterOff"] <= NEAR_DIAMETER else None
    if len(tied_rows) >= 2:
        verdict, confidence, top = "ambiguous", None, tied_rows[0]
    elif len(tied_rows) == 1:
        verdict, confidence, top = "match", "high", tied_rows[0]
    elif near:
        verdict, confidence, top = "match", "low", near
    else:
        verdict, confidence, top = "none", None, None
    ruled_out = []
    if verdict == "match":
        cands = _dedupe([s for s in scored if not s["consistent"] and s["against"] and s["pitchOff"] <= pitch_tol and s["diameterOff"] <= _diameter_tol(rd, s["major"])])
        ruled_out = [{"designation": s["designation"], "by": s["against"]} for s in cands if s["designation"] != top["designation"]][:3]
    return {"verdict": verdict, "confidence": confidence, "best": top, "candidates": scored[:6],
            "tied": [s["designation"] for s in tied_rows] if verdict == "ambiguous" else [],
            "deciding": _deciding(tied_rows[:4], rd) if verdict == "ambiguous" else [],
            "ruledOut": ruled_out, "taperRead": taper_read, "tolerance": tolerance}
