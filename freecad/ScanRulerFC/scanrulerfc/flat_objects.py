# SPDX-License-Identifier: AGPL-3.0-only
# The parts lying on a flatbed scan, found and measured, and an outline read
# as a profile with its peaks counted (the teeth of a knurl or a gear).
# Ported from ScanRuler by CNC Kitchen: src/core/flat/objects.ts and
# profile.ts. Upstream labels runs by union-find so a 100-megapixel scan
# never needs a label image; here numpy and, where FreeCAD's bundle has it,
# scipy's labelling do the same work on arrays (a run-length fallback when
# scipy is missing). Material is 8-connected and background 4-connected, so
# a hole is a background region that cannot reach the edge. Pixels follow
# the edge detector's convention: row 0 is the bottom of the sheet.

import math

import numpy as np

DX = [1, 1, 0, -1, -1, -1, 0, 1]
DY = [0, 1, 1, 1, 0, -1, -1, -1]
WEST = 4
TAU = 2 * math.pi


def otsu_threshold(gray):
    hist = np.bincount(np.asarray(gray, np.uint8).ravel(), minlength=256).astype(float)
    total = hist.sum()
    v = np.arange(256, dtype=float)
    w0 = np.cumsum(hist)[:255]
    s0 = np.cumsum(v * hist)[:255]
    w1 = total - w0
    ok = (w0 > 0) & (w1 > 0)
    if not ok.any():
        return int(np.nonzero(hist)[0][0]) if hist.any() else 0
    d = np.where(ok, s0 / np.where(w0 > 0, w0, 1) - ((v * hist).sum() - s0) / np.where(w1 > 0, w1, 1), 0)
    between = np.where(ok, w0 * w1 * d * d, -1)
    best = between.max()
    ties = np.nonzero(between >= best * (1 - 1e-12))[0]
    # The run of equally good levels the first best one starts.
    first = int(ties[0])
    last = first
    for t in ties[1:]:
        if t == last + 1:
            last = int(t)
        else:
            break
    return (first + last) // 2


def parts_are_dark(gray, threshold):
    border = np.concatenate([gray[0], gray[-1], gray[1:-1, 0], gray[1:-1, -1]]) if gray.shape[0] > 1 else gray[0]
    return int((border <= threshold).sum()) * 2 <= len(border)


def _label(mask, eight):
    try:
        from scipy import ndimage

        s = np.ones((3, 3), int) if eight else None
        lab, n = ndimage.label(mask, structure=s)
        return lab, n
    except ImportError:
        return _label_runs(mask, eight)


def _label_runs(mask, eight):
    """Run-length labelling by union-find, for bundles without scipy."""
    h, w = mask.shape
    reach = 1 if eight else 0
    starts, ends, rows = [], [], []
    row_first = [0]
    for r in range(h):
        m = np.concatenate([[False], mask[r], [False]])
        d = np.diff(m.astype(np.int8))
        s, e = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0] - 1
        starts += s.tolist()
        ends += e.tolist()
        rows += [r] * len(s)
        row_first.append(len(starts))
    parent = list(range(len(starts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for r in range(1, h):
        i, ie = row_first[r - 1], row_first[r]
        j, je = row_first[r], row_first[r + 1]
        while i < ie and j < je:
            if ends[i] + reach < starts[j]:
                i += 1
            elif ends[j] + reach < starts[i]:
                j += 1
            else:
                a, b = find(i), find(j)
                if a != b:
                    parent[max(a, b)] = min(a, b)
                if ends[i] < ends[j]:
                    i += 1
                else:
                    j += 1
    lab = np.zeros((h, w), np.int32)
    ids = {}
    for k in range(len(starts)):
        root = find(k)
        if root not in ids:
            ids[root] = len(ids) + 1
        lab[rows[k], starts[k]:ends[k] + 1] = ids[root]
    return lab, len(ids)


def _trace(material, col0, row0, sx, sy, pixels):
    h, w = material.shape

    def inside(c, r):
        return 0 <= c < w and 0 <= r < h and material[r, c]

    def nxt(c, r, frm):
        for t in range(8):
            d = (frm + t) & 7
            if inside(c + DX[d], r + DY[d]):
                return d
        return -1

    out = [((col0 + 0.5) * sx, (row0 + 0.5) * sy)]
    k0 = nxt(col0, row0, WEST)
    if k0 < 0:
        return np.array(out)
    c, r, k = col0, row0, k0
    for _ in range(8 * pixels + 16):
        c += DX[k]
        r += DY[k]
        k = nxt(c, r, (k + 5) & 7 if k & 1 else (k + 6) & 7)
        if c == col0 and r == row0 and k == k0:
            break
        out.append(((c + 0.5) * sx, (r + 0.5) * sy))
    return np.array(out)


def convex_hull(P):
    P = np.unique(np.asarray(P, float), axis=0)
    if len(P) <= 2:
        return P

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def chain(pts):
        st = []
        for p in pts:
            while len(st) >= 2 and cross(st[-2], st[-1], p) <= 0:
                st.pop()
            st.append(p)
        return st[:-1]

    return np.array(chain(P) + chain(P[::-1]))


def axial(a):
    while a > math.pi / 2:
        a -= math.pi
    while a <= -math.pi / 2:
        a += math.pi
    return a


def feret(outline, sx, sy):
    c = convex_hull(outline)
    hx, hy = sx / 2, sy / 2
    corners = np.concatenate([c + [-hx, -hy], c + [hx, -hy], c + [hx, hy], c + [-hx, hy]])
    H = convex_hull(corners)
    h = len(H)
    mn, mn_a, mx, mx_a = math.inf, 0.0, 0.0, 0.0
    j = 1
    for i in range(h):
        e = H[(i + 1) % h] - H[i]

        def reach(k):
            return e[0] * (H[k % h][1] - H[i][1]) - e[1] * (H[k % h][0] - H[i][0])

        while reach(j + 1) > reach(j):
            j = (j + 1) % h
        width = reach(j) / math.hypot(*e)
        if width < mn:
            mn, mn_a = width, math.atan2(e[0], -e[1])
        for a, b in ((i, j), (i + 1, j), (i, j + 1), (i + 1, j + 1)):
            d = H[b % h] - H[a % h]
            L = math.hypot(*d)
            if L > mx:
                mx, mx_a = L, math.atan2(d[1], d[0])
    return {"max": mx, "maxAngle": axial(mx_a), "min": mn, "minAngle": axial(mn_a)}


def reading_order(centroids, heights):
    n = len(centroids)
    if not n:
        return []
    tol = 0.5 * sorted(heights)[n >> 1]
    order, row, total = [], [], 0.0
    for i in sorted(range(n), key=lambda i: -centroids[i][1]):
        y = centroids[i][1]
        if row and total / len(row) - y > tol:
            order += sorted(row, key=lambda k: centroids[k][0])
            row, total = [], 0.0
        row.append(i)
        total += y
    return order + sorted(row, key=lambda k: centroids[k][0])


def find_objects(gray, sx, sy, min_area, threshold=None, dark=None, min_hole_area=None):
    """gray: (rows, cols) uint8, row 0 the bottom of the sheet."""
    gray = np.asarray(gray, np.uint8)
    t = otsu_threshold(gray) if threshold is None else int(threshold)
    dark = parts_are_dark(gray, t) if dark is None else dark
    material = gray <= t if dark else gray > t
    px_area = sx * sy
    min_hole = min_area if min_hole_area is None else min_hole_area
    lab, n = _label(material, True)
    if not n:
        return {"threshold": t, "dark": dark, "objects": [], "labels": lab, "keep": {}}
    counts = np.bincount(lab.ravel(), minlength=n + 1)
    keep_ids = [i for i in range(1, n + 1) if counts[i] * px_area >= min_area]
    # Holes: background regions (4-connected) not touching the border.
    blab, bn = _label(~material, False)
    holes = {}
    if bn:
        edge = set(np.unique(np.concatenate([blab[0], blab[-1], blab[:, 0], blab[:, -1]])).tolist())
        bcounts = np.bincount(blab.ravel(), minlength=bn + 1)
        flat = blab.ravel()
        first = np.full(bn + 1, -1)
        nz = np.nonzero(flat)[0]
        # The first pixel of each hole in raster order (lowest row, leftmost).
        u, idx = np.unique(flat[nz], return_index=True)
        first[u] = nz[idx]
        cols = lab.shape[1]
        for b in range(1, bn + 1):
            if b in edge or bcounts[b] * px_area < min_hole or first[b] < 0:
                continue
            r, c = divmod(int(first[b]), cols)
            if c > 0:
                owner = int(lab[r, c - 1])
                holes[owner] = holes.get(owner, 0) + 1
    rows, cols = np.indices(lab.shape)
    objs = []
    for i in keep_ids:
        m = lab == i
        rr, cc = rows[m], cols[m]
        npx = len(rr)
        mu, mv = cc.mean(), rr.mean()
        m20 = sx * sx * (((cc - mu) ** 2).mean() + 1 / 12)
        m02 = sy * sy * (((rr - mv) ** 2).mean() + 1 / 12)
        m11 = sx * sy * ((cc - mu) * (rr - mv)).mean()
        r0 = int(rr.min())
        c0 = int(cc[rr == r0].min())
        outline = _trace(m, c0, r0, sx, sy, npx)
        area = npx * px_area
        objs.append({"label": i, "area": area, "holes": holes.get(i, 0),
                     "box": {"min": [cc.min() * sx, rr.min() * sy], "max": [(cc.max() + 1) * sx, (rr.max() + 1) * sy]},
                     "centroid": [sx * (mu + 0.5), sy * (mv + 0.5)], "axisAngle": axial(0.5 * math.atan2(2 * m11, m20 - m02)),
                     "feret": feret(outline, sx, sy), "equivalentDiameter": math.sqrt(4 * area / math.pi), "outline": outline,
                     "height": sy * (rr.max() - rr.min() + 1)})
    order = reading_order([o["centroid"] for o in objs], [o["height"] for o in objs])
    objs = [objs[k] for k in order]
    return {"threshold": t, "dark": bool(dark), "objects": objs, "labels": lab, "keep": {o["label"]: k for k, o in enumerate(objs)}}


# ---- profile -----------------------------------------------------------------

POINTS_PER_BIN, MIN_SAMPLES, MAX_SAMPLES = 2, 8, 4096
SPREAD_FRACTION = 0.3


def _bin(members, pos, val, lo, span, bins):
    value = np.full(bins, -np.inf)
    source = np.full(bins, -1)
    position = np.zeros(bins)
    for i in members:
        k = min(bins - 1, max(0, int((pos[i] - lo) / span * bins))) if span > 0 else 0
        if val[i] > value[k]:
            value[k], source[k], position[k] = val[i], i, pos[i]
    return {"value": value, "source": source, "position": position, "lo": lo, "width": span / bins}


def _bridged(b, circular):
    n = len(b["value"])
    out = b["value"].copy()
    data = np.nonzero(b["source"] >= 0)[0].tolist()
    if not data:
        return np.zeros(n)

    def fill(frm, to):
        v0, v1 = b["value"][frm], b["value"][to % n]
        for k in range(frm + 1, to):
            out[k % n] = v0 + (v1 - v0) * (k - frm) / (to - frm)

    for d in range(len(data) - 1):
        fill(data[d], data[d + 1])
    if circular:
        fill(data[-1], data[0] + n)
    else:
        out[:data[0]] = b["value"][data[0]]
        out[data[-1] + 1:] = b["value"][data[-1]]
    return out


def _local_maxima(x):
    out, last, i = [], len(x) - 1, 1
    while i < last:
        if x[i - 1] < x[i]:
            ahead = i + 1
            while ahead < last and x[ahead] == x[i]:
                ahead += 1
            if x[ahead] < x[i]:
                out.append((i + ahead - 1) >> 1)
                i = ahead
        i += 1
    return out


def _prominence(x, p):
    h = x[p]
    top = p
    while top > 0 and x[top - 1] == h:
        top -= 1
    left = h
    i = top - 1
    while i >= 0 and x[i] < h:
        left = min(left, x[i])
        i -= 1
    right = h
    i = p + 1
    while i < len(x) and x[i] <= h:
        right = min(right, x[i])
        i += 1
    return h - max(left, right)


def _peaks(signal, circular):
    n = len(signal)
    if not circular:
        return [(b, _prominence(signal, b)) for b in _local_maxima(signal)]
    lowest = int(np.argmin(signal))
    turn = np.array([signal[(lowest + k) % n] for k in range(n + 1)])
    return [((lowest + k) % n, _prominence(turn, k)) for k in _local_maxima(turn)]


def _nearest_data(b, k, circular, sign):
    n = len(b["value"])
    if b["source"][k] >= 0:
        return k
    for d in range(1, n):
        best = -1
        for s in (k - d, k + d):
            j = s % n if circular else s
            if j < 0 or j >= n or b["source"][j] < 0:
                continue
            if best < 0 or sign * (b["value"][j] - b["value"][best]) > 0:
                best = j
        if best >= 0:
            return best
    return -1


def _spread(b):
    v = np.sort(b["value"][b["source"] >= 0])
    if not len(v):
        return 0.0
    return float(v[round(0.95 * (len(v) - 1))] - v[round(0.05 * (len(v) - 1))])


def _empty():
    return {"peaks": [], "valleys": [], "pitch": None, "max": 0.0, "min": 0.0, "peakMean": None, "valleyMean": None, "samples": []}


def _tooth_middle(signal, k, level, lo, width):
    def crossing(d):
        j = k
        while 0 <= j + d < len(signal):
            a, c = signal[j], signal[j + d]
            if c < level:
                return j + d * (a - level) / (a - c)
            j += d
        return None

    l, r = crossing(-1), crossing(1)
    return None if l is None or r is None else lo + ((l + r) / 2 + 0.5) * width


def _read_side(P, b, prominence, circular):
    n = len(b["value"])
    have = b["source"] >= 0
    if not have.any():
        return _empty()
    samples = [[float(b["position"][k]), float(b["value"][k])] for k in range(n) if have[k]]

    def point_at(k, p):
        i = b["source"][k]
        return {"at": P[i].tolist(), "position": float(b["position"][k]), "value": float(b["value"][k]), "prominence": float(p)}

    signal = _bridged(b, circular)
    found = {}
    for binn, p in _peaks(signal, circular):
        if p < prominence:
            continue
        k = _nearest_data(b, binn, circular, 1)
        if k >= 0 and (k not in found or p > found[k]):
            found[k] = p
    bins = sorted(found)
    peaks = [point_at(k, found[k]) for k in bins]
    valleys = []
    gaps = len(bins) if circular else len(bins) - 1
    for g in range(max(0, gaps)):
        a = bins[g]
        c = bins[g + 1] if g + 1 < len(bins) else bins[0] + n
        deepest = -1
        for j in range(a + 1, c):
            k = j % n
            if have[k] and (deepest < 0 or b["value"][k] < b["value"][deepest]):
                deepest = k
        if deepest < 0:
            deepest = a if b["value"][a] <= b["value"][c % n] else c % n
        valleys.append(point_at(deepest, min(b["value"][a], b["value"][c % n]) - b["value"][deepest]))
    pitch = None
    if len(peaks) >= 2:
        if circular:
            pitch = TAU / len(peaks)
        else:
            sp = [peaks[i]["position"] - peaks[i - 1]["position"] for i in range(1, len(peaks))]
            step = float(np.median(sp))
            index = [round((p["position"] - peaks[0]["position"]) / step) for p in peaks]
            middle = []
            for i, k in enumerate(bins):
                lows = [v["value"] for v in (valleys[i - 1] if i > 0 else None, valleys[i] if i < len(valleys) else None) if v]
                low = max(lows) if lows else -math.inf
                m = _tooth_middle(signal, k, (b["value"][k] + low) / 2, b["lo"], b["width"])
                middle.append(peaks[i]["position"] if m is None else m)
            mi, mp = np.mean(index), np.mean(middle)
            sxx = sum((x - mi) ** 2 for x in index)
            pitch = float(sum((x - mi) * (m - mp) for x, m in zip(index, middle)) / sxx) if sxx > 0 else step
    vals = b["value"][have]
    return {"peaks": peaks, "valleys": valleys, "pitch": pitch, "max": float(vals.max()), "min": float(vals.min()),
            "peakMean": float(np.mean([p["value"] for p in peaks])) if peaks else None,
            "valleyMean": float(np.mean([v["value"] for v in valleys])) if valleys else None, "samples": samples}


def outline_profile(P, about, floor, samples=None, prominence=None):
    P = np.asarray(P, float)
    count = len(P)

    def bins_for(m):
        return max(3, int(samples)) if samples else min(MAX_SAMPLES, max(MIN_SAMPLES, round(m / POINTS_PER_BIN)))

    def prom_from(sides):
        return prominence if prominence is not None else max(SPREAD_FRACTION * max([0.0] + [_spread(s) for s in sides]), floor)

    if about["kind"] == "radial":
        d = P - np.asarray(about["center"], float)
        ang = np.arctan2(d[:, 1], d[:, 0]) % TAU
        ang[ang >= TAU] = 0
        b = _bin(range(count), ang, np.hypot(d[:, 0], d[:, 1]), 0.0, TAU, bins_for(count))
        p = prom_from([b])
        return {"kind": "radial", "prominence": p, "sides": [_read_side(P, b, p, True)]}
    o = np.asarray(about["origin"], float)
    u = np.asarray(about["dir"], float)
    if not np.linalg.norm(u) > 0:
        raise ValueError("The profile axis needs a direction.")
    u = u / np.linalg.norm(u)
    d = P - o
    across = u[0] * d[:, 1] - u[1] * d[:, 0]
    pos = d @ u
    val = np.abs(across)
    sides = []
    for members in (np.nonzero(across >= 0)[0], np.nonzero(across < 0)[0]):
        if not len(members):
            sides.append(None)
            continue
        lo, hi = float(pos[members].min()), float(pos[members].max())
        sides.append(_bin(members, pos, val, lo, hi - lo, bins_for(len(members)) if hi > lo else 1))
    p = prom_from([s for s in sides if s is not None])
    return {"kind": "axial", "prominence": p, "sides": [_read_side(P, s, p, False) if s else _empty() for s in sides]}
