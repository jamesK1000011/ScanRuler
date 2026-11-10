# SPDX-License-Identifier: AGPL-3.0-only
# The outline of a part seen square onto a plane: where a grid of rays
# meets the scan and where it does not, the line between traced round by
# marching squares, and each loop read as a CAD sketch would draw it —
# straight sides fitted as lines and met at their corners, the rounds
# between them fitted as circles, a whole loop as one circle where it is
# round. Ported from ScanRuler by CNC Kitchen: src/core/geometry/outline.ts.

import math

import numpy as np

from .geom2d import simplify_run
from .shapes import fit_circle2d


def mask_loops(mask, g, min_area=0.0):
    """The loops round the set cells of `mask` (row-major, row 0 at the low
    v) by marching squares over the cell centres, through the midpoints
    between a set cell and an unset one; two set cells touching only at a
    corner kept apart; loops closing less than min_area (mm²) left out.
    Each {points, hole, area}, the largest first."""
    cols, rows = g["cols"], g["rows"]
    M = np.zeros((rows + 2, cols + 2), bool)
    M[1:-1, 1:-1] = np.asarray(mask, bool).reshape(rows, cols)
    W, H = cols + 2, rows + 2

    def at(c, r):
        return bool(M[r + 1, c + 1])

    def hkey(c, r):
        return (r + 1) * W + (c + 1)

    def vkey(c, r):
        return W * H + (r + 1) * W + (c + 1)

    def place(k):
        vertical = k >= W * H
        i = k - W * H if vertical else k
        c = i % W - 1
        r = i // W - 1
        return (c, r + 0.5) if vertical else (c + 0.5, r)

    nxt = {}

    def link(a, b):
        nxt.setdefault(a, []).append(b)
        nxt.setdefault(b, []).append(a)

    # Only the squares where the corners differ.
    A = M[:-1, :-1]
    B = M[:-1, 1:]
    C = M[1:, 1:]
    D = M[1:, :-1]
    mixed = (A != B) | (B != C) | (C != D) | (A != D)
    for rr, cc in zip(*np.nonzero(mixed)):
        c, r = int(cc) - 1, int(rr) - 1
        a, b, cc_, d = at(c, r), at(c + 1, r), at(c + 1, r + 1), at(c, r + 1)
        bottom, top, left, right = hkey(c, r), hkey(c, r + 1), vkey(c, r), vkey(c + 1, r)
        cross = []
        if a != b:
            cross.append(bottom)
        if b != cc_:
            cross.append(right)
        if d != cc_:
            cross.append(top)
        if a != d:
            cross.append(left)
        if len(cross) == 2:
            link(cross[0], cross[1])
        elif len(cross) == 4:
            if a:
                link(bottom, left)
                link(right, top)
            else:
                link(bottom, right)
                link(top, left)
    done = set()
    loops = []
    for start in nxt:
        if start in done:
            continue
        keys = [start]
        done.add(start)
        prev, cur = -1, start
        while True:
            ns = nxt[cur]
            to = ns[0] if ns[0] != prev else (ns[1] if len(ns) > 1 else None)
            if to is None or to == start or to in done:
                break
            done.add(to)
            keys.append(to)
            prev, cur = cur, to
        if len(keys) < 3:
            continue
        pts = np.array([place(k) for k in keys], float)
        loops.append(np.stack([g["u0"] + (pts[:, 0] + 0.5) * g["cell"], g["v0"] + (pts[:, 1] + 0.5) * g["cell"]], 1))
    out = [{"points": p, "area": abs(signed_area(p))} for p in loops]
    out = [l for l in out if l["area"] >= min_area]
    for l in out:
        l["hole"] = sum(1 for o in out if o is not l and o["area"] > l["area"] and inside(l["points"][0], o["points"])) % 2 == 1
    out.sort(key=lambda l: -l["area"])
    return out


def signed_area(p):
    x, y = p[:, 0], p[:, 1]
    xj, yj = np.roll(x, 1), np.roll(y, 1)
    return float((xj * y - x * yj).sum() / 2)


def inside(q, p):
    x = False
    n = len(p)
    j = n - 1
    for i in range(n):
        if (p[i][1] > q[1]) != (p[j][1] > q[1]) and q[0] < (p[j][0] - p[i][0]) * (q[1] - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]:
            x = not x
        j = i
    return x


def circle_through(pts):
    pts = np.asarray(pts, float)
    if len(pts) < 3:
        return None
    c = fit_circle2d(pts[:, 0], pts[:, 1])
    if not c:
        return None
    cu, cv, r = c
    d = np.abs(np.hypot(pts[:, 0] - cu, pts[:, 1] - cv) - r)
    return {"center": (float(cu), float(cv)), "radius": float(r), "rms": float(math.sqrt((d * d).mean())), "max": float(d.max())}


def line_through(pts):
    """The total-least-squares line through the points."""
    pts = np.asarray(pts, float)
    m = pts.mean(0)
    x, y = pts[:, 0] - m[0], pts[:, 1] - m[1]
    angle = 0.5 * math.atan2(2 * (x * y).sum(), (x * x).sum() - (y * y).sum())
    d = (math.cos(angle), math.sin(angle))
    off = x * d[1] - y * d[0]
    return {"at": (float(m[0]), float(m[1])), "dir": d, "rms": float(math.sqrt((off * off).mean())), "max": float(np.abs(off).max())}


def meet(a, b):
    den = a["dir"][0] * b["dir"][1] - a["dir"][1] * b["dir"][0]
    if abs(den) < math.sin(math.radians(4)):
        return None
    t = ((b["at"][0] - a["at"][0]) * b["dir"][1] - (b["at"][1] - a["at"][1]) * b["dir"][0]) / den
    return (a["at"][0] + t * a["dir"][0], a["at"][1] + t * a["dir"][1])


def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) if l2 > 0 else 0.0
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def touch(a, b, tolerance):
    line = a["line"] if a["kind"] == "line" else b["line"] if b["kind"] == "line" else None
    arc = a["circle"] if a["kind"] == "arc" else b["circle"] if b["kind"] == "arc" else None
    if not line or not arc:
        return None
    c = arc["center"]
    t = (c[0] - line["at"][0]) * line["dir"][0] + (c[1] - line["at"][1]) * line["dir"][1]
    foot = (line["at"][0] + t * line["dir"][0], line["at"][1] + t * line["dir"][1])
    return foot if abs(math.hypot(c[0] - foot[0], c[1] - foot[1]) - arc["radius"]) <= tolerance else None


def smooth_trace(traced):
    t = np.asarray(traced, float)
    return (np.roll(t, 1, 0) + 2 * t + np.roll(t, -1, 0)) / 4


SPAN_MAX = 40


def loop_shape(traced, tolerance, cell):
    """A traced loop read as a sketch to within tolerance: the fewest lines
    and arcs that follow it (a line taken over an arc that fits as well),
    lines met at corners, an arc between two lines that meet as that
    corner's round, or one circle where the whole loop is round. Returns
    {points, rounds [{at, radius, center}], arcs [{from, radius, center,
    mid}], circle?, worst, worstAt?}."""
    traced = np.asarray(traced, float)
    n = len(traced)
    loop = smooth_trace(traced)
    fine = max(tolerance / 2, 0.3 * cell)
    whole = circle_through(loop)
    if whole and whole["rms"] <= fine and whole["max"] <= tolerance:
        return {"points": [], "rounds": [], "arcs": [], "circle": {"center": whole["center"], "radius": whole["radius"], "rms": whole["rms"]}, "worst": whole["max"]}
    far = int(np.argmax(np.hypot(loop[:, 0] - loop[0, 0], loop[:, 1] - loop[0, 1])))
    flat = np.vstack([loop, loop[:1]])
    thinned = simplify_run(flat, 0, far + 1, fine) + simplify_run(flat, far, n + 1, fine)[1:-1]
    m = len(thinned)
    if m < 3:
        return {"points": [tuple(loop[i]) for i in thinned], "rounds": [], "arcs": [], "worst": 0.0}

    def end(k):
        return thinned[k + 1] if k + 1 < m else thinned[0] + n

    def side_len(k):
        a, b = loop[thinned[k]], loop[end(k) % n]
        return math.hypot(b[0] - a[0], b[1] - a[1])

    longest = max(range(m), key=side_len)
    start = round((thinned[longest] + end(longest)) / 2) % n
    kept = [start] + sorted(i + n if i <= start else i for i in thinned) + [start + n]
    kept = [i for k, i in enumerate(kept) if k == 0 or i != kept[k - 1]]
    M = len(kept) - 1

    def points_of(i, j):
        return loop[np.arange(kept[i], kept[j] + 1) % n]

    size = float(max(np.ptp(loop[:, 0]), np.ptp(loop[:, 1])))
    tight = max(fine / 2, 0.3 * cell)

    def piece_of(i, j):
        pts = points_of(i, j)
        line = line_through(pts)
        straight = line["rms"] <= fine and line["max"] <= tolerance
        if len(pts) >= 5 and not (straight and line["rms"] <= tight):
            c = circle_through(pts)
            if c and c["rms"] <= tight and c["max"] <= tolerance and c["radius"] < size / 2 and (not straight or c["rms"] < line["rms"] / 2):
                return {"kind": "arc", "circle": c, "from": i, "to": j}
        return {"kind": "line", "line": line, "from": i, "to": j} if straight else None

    best = [math.inf] * (M + 1)
    back = [None] * (M + 1)
    best[0] = 0
    for j in range(1, M + 1):
        misses = 0
        i = j - 1
        while i >= max(0, j - SPAN_MAX) and misses < 3:
            p = piece_of(i, j)
            if not p:
                misses += 1
                i -= 1
                continue
            misses = 0
            if best[i] + 1 < best[j]:
                best[j] = best[i] + 1
                back[j] = p
            i -= 1
    pieces = []
    j = M
    while j > 0:
        p = back[j]
        if not p:
            return {"points": [tuple(loop[k % n]) for k in kept[:M]], "rounds": [], "arcs": [], "worst": fine}
        pieces.insert(0, p)
        j = p["from"]
    if len(pieces) > 2 and pieces[0]["kind"] == "line" and pieces[-1]["kind"] == "line":
        last = pieces[-1]
        line = line_through(np.vstack([points_of(last["from"], M), points_of(0, pieces[0]["to"])]))
        if line["rms"] <= fine and line["max"] <= tolerance:
            pieces.pop()
            pieces[0] = {"kind": "line", "line": line, "from": last["from"] - M, "to": pieces[0]["to"]}
    for k, p in enumerate(pieces):
        if p["kind"] != "line":
            continue
        pts = np.vstack([points_of(p["from"] + M, M), points_of(0, p["to"])]) if p["from"] < 0 else points_of(p["from"], p["to"])
        trim = int(len(pts) * 0.2)
        if len(pts) - 2 * trim < 5:
            continue
        line = line_through(pts[trim:len(pts) - trim])
        off = np.abs((pts[:, 0] - line["at"][0]) * line["dir"][1] - (pts[:, 1] - line["at"][1]) * line["dir"][0]).max()
        if off <= tolerance:
            pieces[k] = {**p, "line": line}
    P = len(pieces)

    def at(k):
        return pieces[k % P]

    def round_on(k):
        p, a, b = at(k), at(k - 1), at(k + 1)
        if p["kind"] != "arc" or P < 3 or a["kind"] != "line" or b["kind"] != "line":
            return None
        corner = meet(a["line"], b["line"])
        if not corner:
            return None
        c = p["circle"]["center"]
        out = math.hypot(corner[0] - c[0], corner[1] - c[1])
        arc = points_of(p["from"], p["to"])
        mid = arc[len(arc) >> 1]
        toward = ((mid[0] - c[0]) * (corner[0] - c[0]) + (mid[1] - c[1]) * (corner[1] - c[1])) / (math.hypot(mid[0] - c[0], mid[1] - c[1]) * out)
        return corner if toward > 0.95 and p["circle"]["radius"] < out < 4 * p["circle"]["radius"] else None

    points, rounds, arcs = [], [], []
    for k in range(P):
        p = at(k)
        corner = round_on(k)
        if corner and p["kind"] == "arc":
            rounds.append({"at": len(points), "radius": p["circle"]["radius"], "center": p["circle"]["center"]})
            points.append(corner)
            continue
        if p["kind"] == "line" and round_on(k - 1):
            continue
        prev = at(k - 1)
        met = meet(prev["line"], p["line"]) if p["kind"] == "line" and prev["kind"] == "line" else touch(p, prev, tolerance) if p["kind"] != prev["kind"] else None
        if p["kind"] == "arc":
            arc = points_of(p["from"], p["to"])
            arcs.append({"from": len(points), "radius": p["circle"]["radius"], "center": p["circle"]["center"], "mid": tuple(arc[len(arc) >> 1])})
        points.append(met if met else tuple(loop[kept[(p["from"] + M) % M] % n]))
    two_pi = 2 * math.pi
    for a in arcs:
        c = a["center"]
        ang = lambda q: math.atan2(q[1] - c[1], q[0] - c[0])
        a0 = ang(points[a["from"]])
        turn = lambda x: x % two_pi
        ccw = turn(ang(points[(a["from"] + 1) % len(points)]) - a0)
        sweep = ccw if turn(ang(a["mid"]) - a0) < ccw else ccw - two_pi
        mm = a0 + sweep / 2
        a["mid"] = (c[0] + a["radius"] * math.cos(mm), c[1] + a["radius"] * math.sin(mm))
    worst, worst_at = 0.0, None
    for p in traced:
        d = math.inf
        for i in range(len(points)):
            d = min(d, seg_dist(p, points[i], points[(i + 1) % len(points)]))
        for r in rounds + arcs:
            d = min(d, abs(math.hypot(p[0] - r["center"][0], p[1] - r["center"][1]) - r["radius"]))
        if d > worst:
            worst, worst_at = d, (float(p[0]), float(p[1]))
    return {"points": points, "rounds": rounds, "arcs": arcs, "worst": worst, **({"worstAt": worst_at} if worst_at else {})}
