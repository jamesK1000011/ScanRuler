# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/flat/fit.ts,
# src/core/fit/circle2d.ts, src/core/fit/ballFit.ts, src/core/fit/linalg.ts
# (solveLinear), src/core/fit/ransac.ts (mulberry32), src/core/flat/simplify.ts,
# src/core/flat/grow.ts (viewChain).
#
# The flat fits: line, circle and arc through 2D points, the robust
# (consensus) variants for points collected off edges, Ramer-Douglas-Peucker
# thinning, and a chain's spacing and scatter. Pure numpy; points are (n, 2)
# arrays in plane millimetres (or image pixels).

import math

import numpy as np


class FitError(Exception):
    """A fit the points cannot give, with a message for the person."""


# ---- linalg -----------------------------------------------------------------------------

def solve_linear(a, b):
    """Gaussian elimination with partial pivoting, as ScanRuler's solveLinear:
    None when a pivot falls under max(|a|, 1) * 1e-13."""
    a = np.array(a, dtype=float)
    x = np.array(b, dtype=float)
    n = len(x)
    tiny = max(float(np.abs(a).max()) if a.size else 0.0, 1.0) * 1e-13
    for col in range(n):
        p = col + int(np.argmax(np.abs(a[col:, col])))
        if abs(a[p, col]) < tiny:
            return None
        if p != col:
            a[[col, p]] = a[[p, col]]
            x[[col, p]] = x[[p, col]]
        piv = a[col, col]
        for r in range(col + 1, n):
            f = a[r, col] / piv
            if f != 0:
                a[r, col:] -= f * a[col, col:]
                x[r] -= f * x[col]
    for col in range(n - 1, -1, -1):
        x[col] = (x[col] - a[col, col + 1:] @ x[col + 1:]) / a[col, col]
    return x


def _cholesky_solve(a, b, tiny=0.0):
    try:
        L = np.linalg.cholesky(a)
    except np.linalg.LinAlgError:
        return None
    if not np.all(np.diag(L) > tiny):
        return None
    y = np.linalg.solve(L, b)
    return np.linalg.solve(L.T, y)


# ---- circle kernel (circle2d.ts + ballFit.ts) ---------------------------------------------

STEP_TOLERANCE = 1e-12
MAX_DAMPING = 1e16
MAX_STEPS = 500


def refine_ball(coords, centre, r):
    """Orthogonal-distance circle/sphere fit by Levenberg-Marquardt from
    (centre, r): the centre and radius making sum (|p - c| - r)^2 least.
    coords (n, dim). None when it runs off to no ball."""
    P = np.asarray(coords, dtype=float)
    dim = P.shape[1]
    m = dim + 1
    c = np.array(centre, dtype=float)

    def cost(cc, rr):
        e = np.sqrt(((P - cc) ** 2).sum(axis=1)) - rr
        return float((e * e).sum())

    s = cost(c, r)
    damping = 1e-3
    for _ in range(MAX_STEPS):
        u = P - c
        d = np.sqrt((u * u).sum(axis=1))
        ok = d >= 1e-12
        u = u[ok] / d[ok, None]
        e = d[ok] - r
        J = np.hstack([-u, -np.ones((len(u), 1))])
        jtj = J.T @ J
        g = J.T @ e
        moved = False
        while damping <= MAX_DAMPING:
            a = jtj.copy()
            a[np.diag_indices(m)] += damping * np.maximum(np.diag(jtj), 1e-300)
            delta = _cholesky_solve(a, -g)
            if delta is None:
                delta = solve_linear(a, -g)
            if delta is None:
                damping *= 10
                continue
            c2 = c + delta[:dim]
            r2 = r + delta[dim]
            s2 = cost(c2, r2)
            if s2 <= s:
                size = float(np.sqrt((delta * delta).sum()))
                c, r, s = c2, r2, s2
                damping = max(damping / 10, 1e-12)
                moved = size >= STEP_TOLERANCE * max(1.0, abs(r))
                break
            damping *= 10
        if not moved:
            break
    if not (np.all(np.isfinite(c)) and math.isfinite(r) and r > 0):
        return None
    return c, float(r)


def fit_circle_2d(pts):
    """Best-fit circle (cu, cv, r): Coope's algebraic start about the
    centroid, then the orthogonal-distance refinement. None when the points
    do not determine a circle."""
    P = np.asarray(pts, dtype=float)
    n = len(P)
    if n < 3:
        return None
    mu = P.mean(axis=0)
    Q = P - mu
    pu, pv = Q[:, 0], Q[:, 1]
    b = pu * pu + pv * pv
    suu, suv, svv = (pu * pu).sum(), (pu * pv).sum(), (pv * pv).sum()
    su, sv = pu.sum(), pv.sum()
    a = np.array([[4 * suu, 4 * suv, 2 * su], [4 * suv, 4 * svv, 2 * sv], [2 * su, 2 * sv, n]])
    sol = solve_linear(a, np.array([2 * (pu * b).sum(), 2 * (pv * b).sum(), b.sum()]))
    if sol is None:
        return None
    cu, cv = sol[0], sol[1]
    r2 = sol[2] + cu * cu + cv * cv
    if not (r2 > 0) or not math.isfinite(r2):
        return None
    ball = refine_ball(Q, [cu, cv], math.sqrt(r2))
    if ball is None:
        return None
    (cu, cv), r = ball
    return float(cu + mu[0]), float(cv + mu[1]), r


# ---- the flat fits (flat/fit.ts) -----------------------------------------------------------

def fit_line(points):
    """Total-least-squares line: {kind, center, dir, length, sigma,
    usedPoints, formError}; dir with dx >= 0."""
    P = np.asarray(points, dtype=float)
    n = len(P)
    if n < 2:
        raise FitError("A line needs at least two points.")
    m = P.mean(axis=0)
    Q = P - m
    sxx, sxy, syy = (Q[:, 0] ** 2).sum(), (Q[:, 0] * Q[:, 1]).sum(), (Q[:, 1] ** 2).sum()
    if not ((Q * Q).sum(axis=1).max() > 0):
        raise FitError("The points coincide — they do not define a line.")
    theta = 0.5 * math.atan2(2 * sxy, sxx - syy)
    dx, dy = math.cos(theta), math.sin(theta)
    if dx < 0 or (dx == 0 and dy < 0):
        dx, dy = -dx, -dy
    t = Q[:, 0] * dx + Q[:, 1] * dy
    e = -Q[:, 0] * dy + Q[:, 1] * dx
    tmid = (t.min() + t.max()) / 2
    return {
        "kind": "line",
        "center": [float(m[0] + tmid * dx), float(m[1] + tmid * dy)],
        "dir": [dx, dy],
        "length": float(t.max() - t.min()),
        "sigma": float(math.sqrt((e * e).sum() / n)),
        "usedPoints": n,
        "formError": float(e.max() - e.min()),
    }


def _circle_with_residuals(points, what):
    P = np.asarray(points, dtype=float)
    if len(P) < 3:
        raise FitError(f"A {what} needs at least three points.")
    fit = fit_circle_2d(P)
    if fit is None:
        raise FitError(f"Couldn't fit a {what} through these points.")
    cu, cv, r = fit
    e = np.hypot(P[:, 0] - cu, P[:, 1] - cv) - r
    return fit, float(math.sqrt((e * e).sum() / len(P))), float(e.max() - e.min())


def fit_circle(points):
    (cu, cv, r), sigma, form = _circle_with_residuals(points, "circle")
    return {"kind": "circle", "center": [cu, cv], "radius": r, "sigma": sigma, "usedPoints": len(points), "formError": form}


def fit_arc(points):
    """The circle fit plus the angular extent the points cover: the largest
    gap between neighbouring angles left out."""
    P = np.asarray(points, dtype=float)
    (cu, cv, r), sigma, form = _circle_with_residuals(P, "arc")
    ang = np.sort(np.arctan2(P[:, 1] - cv, P[:, 0] - cu))
    gaps = np.diff(ang)
    gap = ang[0] + 2 * math.pi - ang[-1]
    gap_at = len(ang) - 1
    if len(gaps):
        k = int(np.argmax(gaps))
        if gaps[k] > gap:
            gap, gap_at = float(gaps[k]), k
    start = float(ang[(gap_at + 1) % len(ang)])
    return {"kind": "arc", "center": [cu, cv], "radius": r, "start": start, "sweep": float(2 * math.pi - gap), "sigma": sigma, "usedPoints": len(P), "formError": form}


def flat_point(at):
    return {"kind": "point", "at": [float(at[0]), float(at[1])], "sigma": 0.0, "usedPoints": 0}


def mulberry32(seed):
    a = [seed & 0xFFFFFFFF]

    def rand():
        a[0] = (a[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = a[0]
        t = _imul(t ^ (t >> 15), 1 | t)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rand


def _imul(a, b):
    return (a * b) & 0xFFFFFFFF


RANSAC_ROUNDS = 96
INLIER_BAND = 3


def _consensus(P, residuals_of):
    rand = mulberry32(7)
    best_median = math.inf
    best = None
    for _ in range(RANSAC_ROUNDS):
        res = residuals_of(rand)
        if res is None:
            continue
        med = float(np.sort(np.abs(res))[len(res) // 2])
        if med < best_median:
            best_median, best = med, res
    if best is None:
        return np.ones(len(P), dtype=bool)
    band = max(INLIER_BAND * 1.4826 * best_median, 0.35)
    return np.abs(best) <= band


def fit_line_region(points):
    P = np.asarray(points, dtype=float)
    if len(P) < 8:
        raise FitError("The region caught too few edge points for a line.")

    def res(rand):
        a = P[int(rand() * len(P))]
        b = P[int(rand() * len(P))]
        d = b - a
        L = math.hypot(d[0], d[1])
        if L < 1e-9:
            return None
        return ((P[:, 0] - a[0]) * d[1] - (P[:, 1] - a[1]) * d[0]) / L

    keep = _consensus(P, res)
    if keep.sum() < 8:
        raise FitError("The region caught too few edge points for a line.")
    return fit_line(P[keep])


def _circle_res(P, rand):
    s = np.array([P[int(rand() * len(P))] for _ in range(3)])
    # Three points: the circumscribed circle (Coope is exact there).
    f = fit_circle_2d(s)
    if f is None:
        return None
    return np.hypot(P[:, 0] - f[0], P[:, 1] - f[1]) - f[2]


def fit_circle_region(points):
    P = np.asarray(points, dtype=float)
    if len(P) < 12:
        raise FitError("The region caught too few edge points for a circle.")
    keep = _consensus(P, lambda r: _circle_res(P, r))
    if keep.sum() < 12:
        raise FitError("The region caught too few edge points for a circle.")
    return fit_circle(P[keep])


def fit_arc_region(points):
    P = np.asarray(points, dtype=float)
    if len(P) < 12:
        raise FitError("The region caught too few edge points for an arc.")
    keep = _consensus(P, lambda r: _circle_res(P, r))
    if keep.sum() < 12:
        raise FitError("The region caught too few edge points for an arc.")
    return fit_arc(P[keep])


# ---- thinning (simplify.ts) ---------------------------------------------------------------

def simplify_run(points, lo, hi, tolerance):
    """Ramer-Douglas-Peucker over points[lo:hi] ((n, 2)): the indices worth
    keeping so the polyline stays within `tolerance`; both ends kept."""
    n = hi - lo
    if n <= 0:
        return []
    if n <= 2 or not (tolerance > 0):
        return list(range(lo, hi))
    P = np.asarray(points, dtype=float)[lo:hi]
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ax, ay = P[a]
        dx, dy = P[b, 0] - ax, P[b, 1] - ay
        L = math.hypot(dx, dy)
        seg = P[a + 1:b]
        px, py = seg[:, 0] - ax, seg[:, 1] - ay
        d = np.abs(px * dy - py * dx) / L if L > 1e-12 else np.hypot(px, py)
        i = int(np.argmax(d))
        if d[i] > tolerance:
            w = a + 1 + i
            keep[w] = True
            stack.append((a, w))
            stack.append((w, b))
    return [lo + i for i in np.nonzero(keep)[0].tolist()]


# ---- a chain's statistics (grow.ts viewChain) -------------------------------------------

SCATTER_FLOOR = 0.05
SCATTER_FROM_MEDIAN = 1 / (0.6745 * math.sqrt(1.5))
SAMPLE = 2048


def _median(v):
    if len(v) == 0:
        return 0.0
    s = np.sort(np.asarray(v))
    return float(s[len(s) >> 1])


def view_chain(chain):
    """(points, closed, spacing, scatter): a loop's closing duplicate dropped,
    the median point spacing, and the noise read off second differences."""
    C = np.asarray(chain, dtype=float)
    n0 = len(C)
    step = max(1, n0 // SAMPLE)
    idx = np.arange(step, n0, step)
    gaps = np.hypot(*(C[idx] - C[idx - step]).T) / step if len(idx) else np.zeros(0)
    spacing = _median(gaps) or 1.0
    pts = C
    closed = False
    if n0 >= 4:
        gap = math.hypot(*(C[0] - C[-1]))
        if gap <= 2 * spacing:
            closed = True
            if gap < 0.01 * spacing:
                pts = C[:-1]
    n = len(pts)
    step2 = max(1, n // SAMPLE)
    i = np.arange(1, n - 1, step2)
    seconds = np.zeros(0)
    if len(i):
        a = pts[i + 1] - pts[i - 1]
        L = np.hypot(a[:, 0], a[:, 1])
        b = pts[i] - pts[i - 1]
        ok = L >= 1e-9
        seconds = np.abs(a[ok, 0] * b[ok, 1] - a[ok, 1] * b[ok, 0]) / L[ok]
    scatter = max(_median(seconds) * SCATTER_FROM_MEDIAN, SCATTER_FLOOR * spacing)
    return pts.copy(), closed, spacing, scatter
