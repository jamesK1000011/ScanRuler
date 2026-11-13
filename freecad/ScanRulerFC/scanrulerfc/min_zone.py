# SPDX-License-Identifier: AGPL-3.0-only
# The minimum zone a form tolerance is judged by (ISO 1101): the narrowest
# pair of parallel planes, concentric spheres or coaxial cylinders (or
# concentric circles in a plane) that holds every point. The least-squares
# fit's peak-to-peak is never smaller, and on a face with a raised corner
# can be a good deal larger, enough to fail a part that is in tolerance.
#
# The fit is moved — a plane's tilt, a sphere's centre, a cylinder's axis —
# to make the residuals' range as small as it goes: a downhill simplex,
# restarted where it stopped, on the few hundred points furthest out on each
# side, then checked against every point, taking in any that stick out.
#
# Ported from ScanRuler by CNC Kitchen: src/core/fit/minZone.ts (0.10.1).

import numpy as np

from .linalg import ortho_basis

EDGE_POINTS = 256
MAX_ROUNDS = 12


def minimum_zone(points, shape):
    """{width, start} of points (n×3) about shape — {kind: plane|circle|sphere|
    cylinder, center, normal | axis}; None with fewer than four points."""
    P = np.asarray(points, dtype=float).reshape(-1, 3)
    n = len(P)
    if n < 4:
        return None
    p = P - np.asarray(shape["center"], dtype=float)
    reach = float(np.linalg.norm(p, axis=1).max())
    dims, residuals = _model(shape, p)
    allidx = np.arange(n)
    x = np.zeros(dims)
    res = residuals(x, allidx)
    start = float(res.max() - res.min())
    if not start > 0 or not reach > 0:
        return {"width": max(start, 0.0), "start": max(start, 0.0)}
    tilts = 2 if shape["kind"] in ("plane", "cylinder") else 0
    steps = np.array([start / reach if d < tilts else start for d in range(dims)])
    work = res
    chosen = _edges(work, set())
    best = start
    for _ in range(MAX_ROUNDS):
        idx = np.fromiter(chosen, dtype=np.int64)

        def f(q, idx=idx):
            r = residuals(q, idx)
            return float(r.max() - r.min())

        found = _descend(f, x, steps)
        work = residuals(found, allidx)
        width = float(work.max() - work.min())
        if width < best:
            best = width
            x = found
        if width <= f(found) * (1 + 1e-9) + 1e-15:
            break
        grown = _edges(work, chosen)
        if len(grown) == len(chosen):
            break
        chosen = grown
    return {"width": best, "start": start}


def _edges(r, chosen):
    n = len(r)
    k = min(EDGE_POINTS, n)
    s = np.sort(r)
    low, high = s[k - 1], s[n - k]
    out = set(chosen)
    out.update(np.nonzero((r <= low) | (r >= high))[0].tolist())
    return out


def _model(shape, p):
    kind = shape["kind"]
    if kind == "sphere":
        return 3, lambda x, idx: np.linalg.norm(p[idx] - x, axis=1)
    if kind == "circle":
        nrm = np.asarray(shape["normal"], dtype=float)
        u, v = ortho_basis(nrm)

        def circle(x, idx):
            q = p[idx] - (x[0] * u + x[1] * v)
            t = q @ nrm
            return np.linalg.norm(q - np.outer(t, nrm), axis=1)

        return 2, circle
    if kind == "plane":
        nrm = np.asarray(shape["normal"], dtype=float)
        u, v = ortho_basis(nrm)

        def plane(x, idx):
            m = nrm + x[0] * u + x[1] * v
            return p[idx] @ (m / np.linalg.norm(m))

        return 2, plane
    ax = np.asarray(shape["axis"], dtype=float)
    u, v = ortho_basis(ax)

    def cylinder(x, idx):
        dvec = ax + x[0] * u + x[1] * v
        dvec = dvec / np.linalg.norm(dvec)
        q = p[idx] - (x[2] * u + x[3] * v)
        t = q @ dvec
        return np.linalg.norm(q - np.outer(t, dvec), axis=1)

    return 4, cylinder


def _descend(f, x0, steps0):
    x = np.array(x0, dtype=float)
    fx = f(x)
    steps = np.array(steps0, dtype=float)
    for restart in range(8):
        y, fy = _simplex(f, x, steps)
        better = fy < fx * (1 - 1e-7)
        if fy < fx:
            x, fx = y, fy
        if not better and restart > 0:
            break
        steps *= 0.5
    return x


def _simplex(f, x0, steps):
    """One Nelder–Mead run, coefficients scaled to the dimension (Gao and Han, 2012)."""
    d = len(x0)
    alpha, beta, gamma, delta = 1.0, 1 + 2 / d, 0.75 - 1 / (2 * d), 1 - 1 / d
    pts = [np.array(x0, dtype=float)]
    for i in range(d):
        q = np.array(x0, dtype=float)
        q[i] += steps[i]
        pts.append(q)
    fs = [f(q) for q in pts]
    for _ in range(200 * d):
        order = sorted(range(d + 1), key=lambda i: fs[i])
        best, worst, second = order[0], order[d], order[d - 1]
        if fs[worst] - fs[best] <= 1e-12 * max(fs[best], 1e-12):
            break
        mid = sum(pts[k] for k in order[:d]) / d

        def at(t, w):
            return mid + t * (w - mid)

        r = at(-alpha, pts[worst])
        fr = f(r)
        if fr < fs[best]:
            e = at(-alpha * beta, pts[worst])
            fe = f(e)
            pts[worst], fs[worst] = (e, fe) if fe < fr else (r, fr)
            continue
        if fr < fs[second]:
            pts[worst], fs[worst] = r, fr
            continue
        outside = fr < fs[worst]
        c = at(-alpha * gamma if outside else gamma, pts[worst])
        fc = f(c)
        if fc < (fr if outside else fs[worst]):
            pts[worst], fs[worst] = c, fc
            continue
        b = pts[best]
        for k in order[1:]:
            pts[k] = b + delta * (pts[k] - b)
            fs[k] = f(pts[k])
    bi = min(range(d + 1), key=lambda i: fs[i])
    return pts[bi], fs[bi]
