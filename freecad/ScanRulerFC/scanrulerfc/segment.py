# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: plugins/reverse/core/segment.ts
# (segmentChain, arcsOfChain, placeSegments) and plugins/reverse/core/sketch.ts
# (unwindAngle).
#
# A slice chain cut into lines and arcs. Ramer-Douglas-Peucker at the noise
# tolerance marks the corners and lays chords along the curves; neighbouring
# runs are merged, best first, while one line - or failing that one arc -
# still explains the joined points; boundaries between a line and an arc are
# slid to where the residuals say; short pieces are asked about as clusters
# (noise, a burr, a blob in a corner, or a feature); and each run is named.
# An arc is held to the noise tolerance, a line to a wave tolerance several
# times that (detail_levels): a scanned wall bows, a round does not.

import math

import numpy as np

from .geom2d import FitError, fit_arc, fit_circle, fit_line, simplify_run, view_chain

TOLERANCE_SCATTERS = 3
TOLERANCE_SPACING = 0.6
MIN_SWEEP = math.radians(6)
LINE_ARC_F_CRIT = 16
LINE_ARC_RADIUS_LENGTHS = 20
LINE_ARC_MIN_SWEEP = math.radians(20)
CURVE_BULGES = 5
WAVE_MIDDLE = 3
WAVE_COARSE = 5
WAVE_LENGTHS = 20
ARC_END_HEADING = math.radians(20)
ARC_TURN_NOISE = math.radians(8)
ARC_TURN_ASKED = math.radians(170)
ARC_TURN_SLACK = math.radians(35)
LINE_END_HEADING = math.radians(15)
DEPART_WINDOW = 5
ARC_DEPART = 2.5
SHORT_WAVES = 5
SHALLOW_SWEEP = math.radians(30)
SHALLOW_BULGES = 3
UNEXPLAINED_SHORTS = 3
SHORT_ARC_SWEEP = math.radians(50)
SHORT_ARC_POINTS = 8
SHORT_ARC_WAVES = 3
MEET_PARALLEL = math.sin(math.radians(8))
ARC_BREAKS = 160
INF = math.inf


def detail_levels(tolerance, detail=0.5):
    d = min(1.0, max(0.0, detail if detail is not None and math.isfinite(detail) else 0.5))
    factor = WAVE_MIDDLE ** (2 * (1 - d)) if d >= 0.5 else WAVE_MIDDLE + (WAVE_COARSE - WAVE_MIDDLE) * (1 - 2 * d)
    wave = tolerance * factor
    return {"wave": wave, "arc": tolerance, "short": SHORT_WAVES * wave}


def _try(fit, pts):
    try:
        return fit(pts)
    except FitError:
        return None


def line_of(pts):
    return _try(fit_line, pts) if len(pts) >= 2 else None


def arc_of(pts):
    if len(pts) < 5:
        return None
    a = _try(fit_arc, pts)
    if not a or not (a["sweep"] >= MIN_SWEEP) or not math.isfinite(a["radius"]):
        return None
    return a


def worst_miss(pts, kind, fit):
    n = len(pts)
    w = min(DEPART_WINDOW, n)
    if kind == "line":
        c, d = fit["center"], fit["dir"]
        miss = (pts[:, 0] - c[0]) * -d[1] + (pts[:, 1] - c[1]) * d[0]
    else:
        c = fit["center"]
        miss = np.hypot(pts[:, 0] - c[0], pts[:, 1] - c[1]) - fit["radius"]
    if n < w or w == 0:
        return 0.0
    cs = np.concatenate([[0.0], np.cumsum(miss)])
    sums = cs[w:] - cs[:-w]
    return float(np.abs(sums).max() / w)


def _turn(a, b):
    return math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])


def runs_along(pts, arc):
    n = len(pts)
    k = max(1, min(4, n // 4))
    cx, cy = arc["center"]

    def off(a, b):
        ch = b - a
        rad = np.array([(a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cy])
        lc, lr = math.hypot(*ch), math.hypot(*rad)
        if lc < 1e-12 or lr < 1e-12:
            return 0.0
        return math.asin(min(1.0, abs(ch @ rad) / (lc * lr)))

    if off(pts[0], pts[k]) > ARC_END_HEADING or off(pts[n - 1 - k], pts[n - 1]) > ARC_END_HEADING:
        return False
    mid = n >> 1
    head = pts[k] - pts[0]
    middle = pts[min(n - 1, mid + k)] - pts[max(0, mid - k)]
    tail = pts[n - 1] - pts[n - 1 - k]
    into, out = _turn(head, middle), _turn(middle, tail)
    if abs(into) > ARC_TURN_NOISE and abs(out) > ARC_TURN_NOISE and into * out < 0:
        return False
    claimed = arc["sweep"] * (1 - k / n)
    if claimed > ARC_TURN_ASKED:
        return True
    return abs(abs(_turn(head, tail)) - claimed) <= ARC_TURN_SLACK


def heads_along(pts, line):
    n = len(pts)
    k = max(1, min(4, n // 4))
    dx, dy = line["dir"]

    def off(a, b):
        ch = b - a
        lc = math.hypot(*ch)
        if lc < 1e-12:
            return 0.0
        return math.asin(min(1.0, abs(ch[0] * -dy + ch[1] * dx) / lc))

    return off(pts[0], pts[k]) <= LINE_END_HEADING and off(pts[n - 1 - k], pts[n - 1]) <= LINE_END_HEADING


def judged_piece_of(pts, tol):
    """(kind, fit, score) for the better piece over a run, or None."""
    line = line_of(pts)
    if line:
        if tol["line"] == INF:
            return ("line", line, 0.0)
        allowed = tol["arc"] + (tol["line"] - tol["arc"]) * min(1.0, line["length"] / (WAVE_LENGTHS * tol["line"]))
        if line["sigma"] <= allowed / 2 and heads_along(pts, line):
            worst = worst_miss(pts, "line", line)
            if worst <= allowed:
                return ("line", line, max(2 * line["sigma"] / allowed, worst / allowed))
    arc = arc_of(pts)
    if arc:
        if tol["arc"] == INF:
            return ("arc", arc, 0.0)
        if arc["sigma"] <= tol["arc"] and runs_along(pts, arc):
            worst = worst_miss(pts, "arc", arc)
            if worst <= ARC_DEPART * tol["arc"]:
                return ("arc", arc, max(arc["sigma"] / tol["arc"], worst / (ARC_DEPART * tol["arc"])))
    return None


ANYTHING = {"line": INF, "arc": INF}


def piece_of(pts, tol):
    j = judged_piece_of(pts, tol)
    return (j[0], j[1]) if j else None


def bulge_of(arc):
    return arc["radius"] * (1 - math.cos(arc["sweep"] / 2))


def classify(pts, tol, scatter):
    piece = piece_of(pts, tol) or piece_of(pts, ANYTHING)
    if not piece:
        return None
    if piece[0] == "line" and len(pts) >= 6:
        circle = _try(fit_circle, pts)
        if circle:
            noise = max(circle["sigma"], 0.5 * scatter)
            gain = len(pts) * (piece[1]["sigma"] ** 2 - circle["sigma"] ** 2)
            if gain > LINE_ARC_F_CRIT * noise * noise and circle["radius"] < LINE_ARC_RADIUS_LENGTHS * piece[1]["length"]:
                arc = arc_of(pts)
                if arc and (arc["sweep"] >= LINE_ARC_MIN_SWEEP or bulge_of(arc) >= CURVE_BULGES * tol["arc"]) and runs_along(pts, arc):
                    piece = ("arc", arc)
    if piece[0] == "arc" and piece[1]["sweep"] < SHALLOW_SWEEP and math.isfinite(tol["line"]):
        b = bulge_of(piece[1])
        if b < min(SHALLOW_BULGES * tol["line"], CURVE_BULGES * tol["arc"]):
            line = line_of(pts)
            if line:
                piece = ("line", line)
    return piece


def meet_of(a, b, near):
    """Where two pieces' carriers cross nearest `near`; None for two lines
    running alongside each other."""
    near = np.asarray(near, dtype=float)

    def nearest(cands):
        return min(cands, key=lambda c: math.hypot(c[0] - near[0], c[1] - near[1]))

    (ka, fa), (kb, fb) = a, b
    if ka == "line" and kb == "line":
        da, db = fa["dir"], fb["dir"]
        den = da[0] * db[1] - da[1] * db[0]
        if abs(den) < MEET_PARALLEL:
            return None
        w = (fb["center"][0] - fa["center"][0], fb["center"][1] - fa["center"][1])
        t = (w[0] * db[1] - w[1] * db[0]) / den
        return (fa["center"][0] + da[0] * t, fa["center"][1] + da[1] * t)
    if ka == "arc" and kb == "arc":
        ca, cb = np.array(fa["center"]), np.array(fb["center"])
        d = float(np.linalg.norm(cb - ca))
        if d < 1e-9:
            return None
        u = (cb - ca) / d
        r1, r2 = fa["radius"], fb["radius"]
        along = (r1 * r1 - r2 * r2 + d * d) / (2 * d)
        h2 = r1 * r1 - along * along
        foot = ca + u * along
        if h2 <= 0:
            return tuple(foot)
        h = math.sqrt(h2)
        return nearest([(foot[0] - u[1] * h, foot[1] + u[0] * h), (foot[0] + u[1] * h, foot[1] - u[0] * h)])
    line = fa if ka == "line" else fb
    arc = fa if ka == "arc" else fb
    lc, ld, ac = np.array(line["center"]), np.array(line["dir"]), np.array(arc["center"])
    t = float((ac - lc) @ ld)
    foot = lc + ld * t
    off = float(np.linalg.norm(ac - foot))
    if off >= arc["radius"]:
        return tuple(foot)
    h = math.sqrt(arc["radius"] ** 2 - off * off)
    return nearest([tuple(foot + ld * h), tuple(foot - ld * h)])


def chain_statistics(chain):
    pts, closed, spacing, scatter = view_chain(chain)
    return spacing, scatter, closed, pts


def arcs_of_chain(chain, count, tolerance=None):
    """A chain as `count` arcs end to end, the breaks where the arcs together
    sit closest on the points (dynamic programming)."""
    spacing, scatter, _closed, points = chain_statistics(chain)
    n = len(points)
    pieces = max(1, int(count))
    if n < 5 * pieces:
        raise FitError(f"The chain has {n} points — too few for {pieces} arc{'' if pieces == 1 else 's'}, five each at least.")
    tol = tolerance if tolerance is not None else max(TOLERANCE_SCATTERS * scatter, TOLERANCE_SPACING * spacing)
    stride = max(1, math.ceil(n / ARC_BREAKS))
    at = list(range(0, n - 1, stride)) + [n - 1]
    m = len(at)
    costs = {}

    def arc_cost(a, b):
        key = (a, b)
        if key in costs:
            return costs[key]
        run = points[at[a]:at[b] + 1]
        fit = arc_of(run) if len(run) >= 5 else None
        out = None
        if fit:
            e = np.hypot(run[:, 0] - fit["center"][0], run[:, 1] - fit["center"][1]) - fit["radius"]
            out = (float((e * e).sum()), fit)
        costs[key] = out
        return out

    best = [[INF] * m for _ in range(pieces)]
    frm = [[-1] * m for _ in range(pieces)]
    for k in range(pieces):
        for b in range(1, m):
            if k == 0:
                c = arc_cost(0, b)
                best[0][b] = c[0] if c else INF
                continue
            for a in range(k, b):
                if not math.isfinite(best[k - 1][a]):
                    continue
                c = arc_cost(a, b)
                if not c:
                    continue
                tot = best[k - 1][a] + c[0]
                if tot < best[k][b]:
                    best[k][b] = tot
                    frm[k][b] = a
    if not math.isfinite(best[pieces - 1][m - 1]):
        raise FitError(f"The chain cannot be cut into {pieces} arcs — at least one stretch of it is straight or too short.")
    ends = [m - 1]
    for k in range(pieces - 1, 0, -1):
        ends.insert(0, frm[k][ends[0]])
    ends.insert(0, 0)
    segs = []
    for k in range(pieces):
        lo, hi = at[ends[k]], at[ends[k + 1]]
        segs.append({"kind": "arc", "lo": lo, "hi": hi, "points": points[lo:hi + 1], "fit": arc_cost(ends[k], ends[k + 1])[1]})
    return {"segments": segs, "points": points, "closed": False, "scatter": scatter, "spacing": spacing, "tolerance": tol}


def segment_chain(chain, tolerance=None, detail=None, min_points=None, min_length=None):
    """Cut a chain into lines and arcs. Raises FitError on a chain too short."""
    spacing, scatter, closed, points = chain_statistics(chain)
    n = len(points)
    if n < 4:
        raise FitError("The chain has too few points to fit anything to.")
    tolerance = tolerance if tolerance is not None else max(TOLERANCE_SCATTERS * scatter, TOLERANCE_SPACING * spacing)
    lv = detail_levels(tolerance, 0.5 if detail is None else detail)
    tol = {"line": lv["wave"], "arc": lv["arc"]}
    min_points = max(3, min_points if min_points is not None else 4)
    min_length = min_length if min_length is not None else lv["short"]

    if closed:
        far = int(np.argmax(np.hypot(*(points[1:] - points[0]).T))) + 1
        first = simplify_run(points, 0, far + 1, tolerance)
        second = simplify_run(points, far, n, tolerance)
        breaks = first + second[1:] + [n]
    else:
        breaks = simplify_run(points, 0, n, tolerance)

    def mod(i):
        return i % n

    runs = [{"lo": breaks[k], "hi": breaks[k + 1]} for k in range(len(breaks) - 1)]
    masked = np.zeros(n, dtype=bool)

    def points_of(r):
        idx = [mod(i) for i in range(r["lo"], r["hi"] + 1)]
        idx = [i for i in idx if not masked[i]]
        return points[idx] if idx else np.zeros((0, 2))

    def following(a, b):
        k = math.ceil((a["hi"] - b["lo"]) / n)
        return {"lo": b["lo"] + k * n, "hi": b["hi"] + k * n}

    def union_of(a, b):
        f = following(a, b)
        lo, hi = a["lo"], f["hi"]
        if hi - lo > n:
            hi = lo + n
        while lo >= n:
            lo -= n
            hi -= n
        return {"lo": lo, "hi": hi}

    fits = {}

    def piece_over(r):
        key = (r["lo"], r["hi"])
        if key not in fits:
            pts = points_of(r)
            fits[key] = judged_piece_of(pts, tol) if len(pts) else None
        return fits[key]

    def merge_at(i, count=1):
        union = runs[i]
        for k in range(1, count + 1):
            union = union_of(union, runs[(i + k) % len(runs)])
        drop = {(i + k) % len(runs) for k in range(1, count + 1)}
        if runs[(i + count) % len(runs)].get("cornerAfter"):
            union["cornerAfter"] = True
        runs[i] = union
        for j in sorted(drop, reverse=True):
            runs.pop(j)

    # ---- merge neighbours while one piece still explains them
    merged = True
    while merged and len(runs) > 1:
        merged = False
        best, best_score = -1, INF
        pair_count = len(runs) if closed else len(runs) - 1
        for i in range(pair_count):
            if closed and len(runs) == 2 and i == 1:
                break
            j = piece_over(union_of(runs[i], runs[(i + 1) % len(runs)]))
            if j and j[2] < best_score:
                best_score, best = j[2], i
        if best >= 0:
            merge_at(best)
            merged = True

    # ---- the boundaries settle where the residuals say
    def kind_of(r):
        p = classify(points_of(r), tol, scatter)
        return p[0] if p else "line"

    def fit_as(pts, kind):
        return line_of(pts) if kind == "line" else arc_of(pts)

    for _ in range(3):
        moved = False
        pair_count = len(runs) if closed else len(runs) - 1
        i = 0
        while i < pair_count and len(runs) > 1:
            j = (i + 1) % len(runs)
            a = runs[i]
            b = following(a, runs[j])
            i += 1
            if b["lo"] != a["hi"]:
                continue
            span = min(a["hi"] - a["lo"], b["hi"] - b["lo"], 16)
            if span < 2:
                continue
            ka, kb = kind_of(a), kind_of(b)
            if ka == kb:
                continue
            best_k, best_cost = a["hi"], INF
            for k in range(a["hi"] - span, a["hi"] + span + 1):
                if k - a["lo"] + 1 < min_points or b["hi"] - k + 1 < min_points:
                    continue
                left = fit_as(points_of({"lo": a["lo"], "hi": k}), ka)
                right = fit_as(points_of({"lo": k, "hi": b["hi"]}), kb)
                if not left or not right:
                    continue
                cost = left["sigma"] ** 2 * (k - a["lo"] + 1) + right["sigma"] ** 2 * (b["hi"] - k + 1)
                if cost < best_cost:
                    best_cost, best_k = cost, k
            if best_k != a["hi"]:
                moved = True
                runs[i - 1] = {"lo": a["lo"], "hi": best_k}
                shift = b["lo"] - runs[j]["lo"]
                runs[j] = {"lo": best_k - shift, "hi": b["hi"] - shift}
        if not moved:
            break

    # ---- short pieces: noise, a burr, a blob, or a feature
    def path_length(r):
        idx = [mod(i) for i in range(r["lo"], r["hi"] + 1)]
        p = points[idx]
        return float(np.hypot(*np.diff(p, axis=0).T).sum()) if len(p) > 1 else 0.0

    def is_short(r):
        if r.get("kept"):
            return False
        count = r["hi"] - r["lo"] + 1
        if count < min_points:
            return True
        length = path_length(r)
        if length >= UNEXPLAINED_SHORTS * min_length:
            return False
        if piece_over(r) is None:
            return True
        piece = classify(points_of(r), tol, scatter)
        if piece and piece[0] == "arc":
            if piece[1]["radius"] < SHORT_ARC_WAVES * tol["line"]:
                return True
            if length >= min_length:
                return False
            return not (piece[1]["sweep"] >= SHORT_ARC_SWEEP and count >= SHORT_ARC_POINTS)
        return length < min_length

    for _guard in range(4 * n):
        if len(runs) <= 1:
            break
        count = len(runs)
        short = [is_short(r) for r in runs]
        if not any(short):
            break
        if all(short):
            for r in runs:
                r["kept"] = True
            break
        first = -1
        for k in range(count):
            before = short[(k - 1) % count] if closed else (k > 0 and short[k - 1])
            if short[k] and not before:
                first = k
                break
        size = 1
        while size < count and short[(first + size) % count] and (closed or first + size < count):
            size += 1
        members = [runs[(first + k) % count] for k in range(size)]
        has_prev = closed or first > 0
        has_next = closed or first + size < count
        p = (first - 1) % count
        q = (first + size) % count
        cluster = members[0]
        for k in range(1, size):
            cluster = union_of(cluster, members[k])
        length = sum(path_length(r) for r in members)

        def keep():
            if size == 1:
                members[0]["kept"] = True
                return
            merge_at(first, size - 1)
            hit = next((r for r in runs if r["lo"] == cluster["lo"] and r["hi"] == cluster["hi"]), None)
            if hit:
                hit["kept"] = True
                hit["cluster"] = True
            else:
                for r in runs:
                    if is_short(r):
                        r["kept"] = True

        if length >= UNEXPLAINED_SHORTS * min_length or (closed and p == q):
            keep()
            continue
        if not has_prev or not has_next:
            j = q if has_next else p
            joined = union_of(cluster, runs[j]) if has_next else union_of(runs[j], cluster)
            if piece_over(joined):
                merge_at(first if has_next else j, size)
            elif length < min_length:
                for k in range(cluster["lo"] + (1 if has_prev else 0), cluster["hi"] - (1 if has_next else 0) + 1):
                    masked[mod(k)] = True
                del runs[first:first + size]
                fits.clear()
            else:
                keep()
            continue
        a, b = runs[p], runs[q]
        allr = union_of(union_of(a, cluster), b)
        if piece_over(allr):
            merge_at(p, size + 1)
            continue
        inner = [mod(k) for k in range(cluster["lo"] + 1, cluster["hi"]) if not masked[mod(k)]]
        for k in inner:
            masked[k] = True
        fits.clear()
        if piece_over(allr):
            merge_at(p, size + 1)
            continue
        pa = classify(points_of(a), tol, scatter)
        pb = classify(points_of(b), tol, scatter)
        meet = meet_of(pa, pb, points[mod((cluster["lo"] + cluster["hi"]) >> 1)]) if pa and pb and pa[0] == "line" and pb[0] == "line" else None
        reach = max(length, min_length)
        if meet and math.hypot(*(np.array(meet) - points[mod(cluster["lo"])])) <= reach and math.hypot(*(np.array(meet) - points[mod(cluster["hi"])])) <= reach:
            a["cornerAfter"] = True
            for k in sorted(((first + k) % count for k in range(size)), reverse=True):
                runs.pop(k)
            continue
        for k in inner:
            masked[k] = False
        fits.clear()
        keep()

    # ---- name each run
    segs = []
    for r in runs:
        pts = points_of(r)
        if r.get("cluster") and len(pts) >= 8:
            pts = pts[len(pts) >> 2: len(pts) - (len(pts) >> 2)]
        line = line_of(pts) if r.get("cluster") else None
        piece = ("line", line) if line else classify(pts, tol, scatter)
        if not piece:
            continue
        seg = {"kind": piece[0], "lo": r["lo"], "hi": r["hi"], "points": pts, "fit": piece[1]}
        if r.get("cornerAfter"):
            seg["cornerAfter"] = True
        segs.append(seg)
    if not segs:
        raise FitError("No line or arc could be fitted to the chain.")
    return {"segments": segs, "points": points, "closed": closed, "scatter": scatter, "spacing": spacing, "tolerance": tolerance}


def unwind_angle(angle, start):
    two = 2 * math.pi
    a = math.fmod(angle - start, two)
    if a < 0:
        a += two
    return start + a


def place_segments(cut):
    """Each segment as the sketch entity it becomes: a line between the
    projections of its run's ends; an arc counter-clockwise (start, sweep),
    with which end the run starts at ("a" the CCW start or "b")."""
    out = []
    for seg in cut["segments"]:
        first, last = seg["points"][0], seg["points"][-1]
        f = seg["fit"]
        if seg["kind"] == "line":
            c, d = np.array(f["center"]), np.array(f["dir"])

            def project(p):
                return c + d * float((p - c) @ d)

            out.append({"kind": "line", "a": project(first), "b": project(last), "from": "a", "to": "b", "seg": seg})
            continue
        c = f["center"]

        def ang(p):
            return math.atan2(p[1] - c[1], p[0] - c[0])

        ta, tb, tm = ang(first), ang(last), ang(seg["points"][len(seg["points"]) >> 1])
        ccw_sweep = unwind_angle(tb, ta) - ta
        ccw = unwind_angle(tm, ta) - ta <= ccw_sweep
        if ccw:
            start, sweep = ta, (ccw_sweep if ccw_sweep > 1e-9 else 2 * math.pi)
        else:
            start, sweep = tb, 2 * math.pi - ccw_sweep
        out.append({"kind": "arc", "c": np.array(c, dtype=float), "r": f["radius"], "start": start, "sweep": sweep, "from": "a" if ccw else "b", "to": "b" if ccw else "a", "seg": seg})
    return out


# ---- a fitted chain as a closed sequence of curves (this port's own: ScanRuler's
# sketch fit infers its corners in the reverse plugin's sketch solver) ----------------------------------------

def profile_curves(cut):
    """The pieces of a segmented chain joined end to end as curves on the
    sheet: [("line", a, b) | ("arc", c, r, a0, a1) CCW | ("circle", c, r)],
    each with its start and end vertex in chain order — corners made where
    neighbouring carriers meet (segment.ts meetOf), a short bridging line
    where they do not."""
    placed = place_segments(cut)
    closed = cut["closed"]
    if len(placed) == 1 and placed[0]["kind"] == "arc" and closed and placed[0]["sweep"] > 1.5 * math.pi:
        e = placed[0]
        return [{"kind": "circle", "c": e["c"], "r": e["r"]}], True

    def ends(e):
        if e["kind"] == "line":
            return np.array(e["a"]), np.array(e["b"])
        p0 = e["c"] + e["r"] * np.array([math.cos(e["start"]), math.sin(e["start"])])
        p1 = e["c"] + e["r"] * np.array([math.cos(e["start"] + e["sweep"]), math.sin(e["start"] + e["sweep"])])
        return (p0, p1) if e["from"] == "a" else (p1, p0)

    def carrier(e):
        if e["kind"] == "line":
            d = np.array(e["b"]) - np.array(e["a"])
            d = d / (np.linalg.norm(d) or 1)
            return ("line", {"center": list(e["a"]), "dir": list(d)})
        return ("arc", {"center": list(e["c"]), "radius": e["r"]})

    def length(e):
        return float(np.linalg.norm(np.array(e["b"]) - np.array(e["a"]))) if e["kind"] == "line" else e["r"] * e["sweep"]

    n = len(placed)
    starts = [ends(e)[0] for e in placed]
    stops = [ends(e)[1] for e in placed]
    joints = {}
    pairs = range(n) if closed else range(n - 1)
    for i in pairs:
        j = (i + 1) % n
        if n == 1:
            continue
        near = (stops[i] + starts[j]) / 2
        gap = float(np.linalg.norm(stops[i] - starts[j]))
        reach = max(2 * gap, 0.5 * min(length(placed[i]), length(placed[j])), 3 * cut["tolerance"])
        m = meet_of(carrier(placed[i]), carrier(placed[j]), near)
        if m is not None and np.linalg.norm(np.array(m) - near) <= reach:
            joints[i] = np.array(m, dtype=float)
    # Each piece's ends: at the joint where there is one, kept where not; an
    # arc's end put on its circle at the joint's angle.
    curves = []
    for i, e in enumerate(placed):
        s = joints.get((i - 1) % n) if (closed or i > 0) else None
        t = joints.get(i)
        s = starts[i] if s is None else s
        t = stops[i] if t is None else t
        if e["kind"] == "line":
            curves.append({"kind": "line", "s": s, "t": t})
        else:
            c, r = e["c"], e["r"]
            a_s = math.atan2(s[1] - c[1], s[0] - c[0])
            a_t = math.atan2(t[1] - c[1], t[0] - c[0])
            ccw = e["from"] == "a"
            a0, a1 = (a_s, a_t) if ccw else (a_t, a_s)
            sweep = (a1 - a0) % (2 * math.pi)
            if sweep < 1e-9:
                sweep = 2 * math.pi
            a1 = a0 + sweep
            p0 = c + r * np.array([math.cos(a0), math.sin(a0)])
            p1 = c + r * np.array([math.cos(a1), math.sin(a1)])
            curves.append({"kind": "arc", "c": c, "r": r, "a0": a0, "a1": a1, "s": p0 if ccw else p1, "t": p1 if ccw else p0, "ccw": ccw})
    # Lines take the arcs' ends at a joint, so the wire closes exactly.
    m = len(curves)
    for i in (range(m) if closed else range(m - 1)):
        j = (i + 1) % m
        A, B = curves[i], curves[j]
        if A["kind"] == "arc" and B["kind"] == "line":
            B["s"] = A["t"]
        elif A["kind"] == "line" and B["kind"] == "arc":
            A["t"] = B["s"]
    out = []
    for i in range(m):
        out.append(curves[i])
        if closed or i < m - 1:
            j = (i + 1) % m
            g = float(np.linalg.norm(curves[i]["t"] - curves[j]["s"]))
            if g > 1e-6:
                out.append({"kind": "line", "s": curves[i]["t"], "t": curves[j]["s"], "bridge": True})
    return out, closed
