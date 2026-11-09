# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/fit/clip.ts, plane.ts,
# sphere.ts, ballFit.ts, circle2d.ts, circle.ts, cylinder.ts, cone.ts,
# torus.ts, ransac.ts, extents.ts, seedOff.ts
#
# The shapes a scan is measured with, each with its Gaussian best fit under
# GOM-style "used points" clipping and its robust (LMedS) estimate on a
# patch round a click. Models are dicts with ScanRuler's own field names:
#   plane    {nx, ny, nz, d}
#   sphere   {cx, cy, cz, r}
#   cylinder {px, py, pz, ax, ay, az, r}
#   cone     {px, py, pz, ax, ay, az, r, phi}
#   torus    {cx, cy, cz, ax, ay, az, R, r}
# Points are an (n, 3) float array P and index arrays into it.

import math

import numpy as np

from .linalg import FitError, cholesky_solve, mulberry32, normalize_or_z, ortho_basis, solve_linear, sym_eigen

# ---- shared ---------------------------------------------------------------


def _idx(idx):
    return np.asarray(idx, dtype=np.int64)


def centroid_of(P, idx):
    return P[_idx(idx)].mean(axis=0)


def rms_of(e):
    e = e[np.isfinite(e)]
    return math.inf if e.size == 0 else float(math.sqrt(np.mean(e * e)))


def clipped_refit(P, idx, k, fit, residual):
    """Gaussian best fit with "used points" clipping: fit, drop residuals past
    k·sigma, refit, until the set is stable (12 rounds at most). k = 0 keeps
    every point. Returns {model, sigma, span, min, max, used} or None."""
    used = _idx(idx)
    result = None
    for _ in range(12):
        model = fit(used)
        if model is None:
            return result
        res = residual(model, P[used])
        fin = np.isfinite(res)
        if not fin.any():
            return result
        r = res[fin]
        sigma = float(math.sqrt(np.mean(r * r)))
        lo, hi = float(r.min()), float(r.max())
        result = {"model": model, "sigma": sigma, "span": hi - lo, "min": lo, "max": hi, "used": used}
        if k <= 0 or sigma < 1e-9:
            return result
        with np.errstate(invalid="ignore"):
            keep = np.abs(res) <= k * sigma
        nk = int(keep.sum())
        if nk == len(used) or nk < 10:
            return result
        used = used[keep]
    return result


def extent_of(P, idx):
    Q = P[_idx(idx)]
    return Q.min(axis=0), Q.max(axis=0)


def ransac_consensus(P, patch, opts, shape):
    """LMedS scaffolding: candidates scored by their median absolute residual
    over an at-most-512-point strided subset; the winner's consensus set is
    everything within 3·1.4826·median (floored at 1e-5 of the patch
    diagonal). Returns {model, inliers, sigmaEst} or None."""
    patch = _idx(patch)
    n = len(patch)
    if n < 30:
        return None
    iterations = opts.get("iterations") or 256
    rand = mulberry32(opts.get("seed", 0x5EED) if opts.get("seed") is not None else 0x5EED)
    lo, hi = extent_of(P, patch)
    diag = float(np.linalg.norm(hi - lo))
    if not diag > 0:
        return None
    initial, generate, residual = shape(diag, rand)
    score_n = min(n, 512)
    stride = n / score_n
    subset = patch[np.floor(np.arange(score_n) * stride).astype(np.int64)]
    S = P[subset]

    def median_residual(m):
        r = np.sort(np.abs(residual(m, S)))
        return float(r[score_n >> 1])

    best_med = math.inf
    best = None
    if initial is not None:
        med = median_residual(initial)
        if med < best_med:
            best_med, best = med, initial
    for _ in range(iterations):
        m = generate()
        if m is None:
            continue
        med = median_residual(m)
        if med < best_med:
            best_med, best = med, m
    if best is None:
        return None
    sigma_est = 1.4826 * best_med
    thr = max(3 * sigma_est, diag * 1e-5)
    with np.errstate(invalid="ignore"):
        ok = np.abs(residual(best, P[patch])) <= thr
    if int(ok.sum()) < 30:
        return None
    return {"model": best, "inliers": patch[ok], "sigmaEst": sigma_est}


# ---- plane ----------------------------------------------------------------


def plane_residual(p, X):
    return X @ np.array([p["nx"], p["ny"], p["nz"]]) - p["d"]


def fit_plane_tls(P, idx):
    idx = _idx(idx)
    if len(idx) < 3:
        return None
    Q = P[idx]
    m = Q.mean(axis=0)
    D = Q - m
    vals, vecs = sym_eigen(D.T @ D)
    if not (vals[1] > 1e-12 * vals[2]) or not (vals[2] > 0):
        return None
    nx, ny, nz = vecs[0]
    if not math.isfinite(nx):
        return None
    return {"nx": float(nx), "ny": float(ny), "nz": float(nz), "d": float(nx * m[0] + ny * m[1] + nz * m[2])}


CURVED_OVER_FLAT = 1.1


def curved_beyond_plane(P, idx, curved_rms):
    plane = fit_plane_tls(P, idx)
    if plane is None:
        return True
    return rms_of(plane_residual(plane, P[_idx(idx)])) >= CURVED_OVER_FLAT * curved_rms


def fit_plane_clipped(P, idx, k):
    r = clipped_refit(P, idx, k, lambda used: fit_plane_tls(P, used), plane_residual)
    return r and {"plane": r["model"], "sigma": r["sigma"], "span": r["span"], "min": r["min"], "max": r["max"], "used": r["used"]}


def ransac_plane(P, patch, opts=None):
    patch = _idx(patch)

    def shape(diag, rand):
        n = len(patch)
        min_area = diag * diag * 1e-4

        def generate():
            i0 = patch[int(rand() * n)]
            i1 = patch[int(rand() * n)]
            i2 = patch[int(rand() * n)]
            if i0 == i1 or i0 == i2 or i1 == i2:
                return None
            a, b, c = P[i0], P[i1], P[i2]
            nrm = np.cross(b - a, c - a)
            ln = float(np.linalg.norm(nrm))
            if not ln > min_area:
                return None
            nrm = nrm / ln
            return {"nx": float(nrm[0]), "ny": float(nrm[1]), "nz": float(nrm[2]), "d": float(nrm @ a)}

        return None, generate, plane_residual

    core = ransac_consensus(P, patch, opts or {}, shape)
    if not core:
        return None
    refined = fit_plane_clipped(P, core["inliers"], 3)
    if not refined:
        return None
    return {"plane": refined["plane"], "inliers": refined["used"], "sigma": max(refined["sigma"], core["sigmaEst"], 1e-9)}


# ---- balls: sphere and circle ---------------------------------------------

STEP_TOLERANCE = 1e-12
MAX_DAMPING = 1e16
MAX_STEPS = 500


def refine_ball(coords, centre, r):
    """Levenberg–Marquardt on Σ(|pᵢ − c| − r)² in 2 or 3 dimensions (points
    best given about their centroid). None when it runs off to no ball."""
    dim = coords.shape[1]
    m = dim + 1
    c = np.array(centre, dtype=float)

    def cost(cc, rr):
        e = np.linalg.norm(coords - cc, axis=1) - rr
        return float(e @ e)

    s = cost(c, r)
    damping = 1e-3
    for _ in range(MAX_STEPS):
        U = coords - c
        d = np.linalg.norm(U, axis=1)
        ok = d >= 1e-12
        U = U[ok] / d[ok][:, None]
        e = d[ok] - r
        J = np.hstack([-U, -np.ones((len(e), 1))])
        jtj = J.T @ J
        g = J.T @ e
        moved = False
        while damping <= MAX_DAMPING:
            a = jtj + np.diag(damping * np.maximum(np.diag(jtj), 1e-300))
            delta = cholesky_solve(a, -g, 0)
            if delta is None:
                delta = solve_linear(a, -g)
            if delta is None:
                damping *= 10
                continue
            c2 = c + delta[:dim]
            r2 = r + delta[dim]
            s2 = cost(c2, r2)
            if s2 <= s:
                size = float(math.sqrt(delta @ delta))
                c, r, s = c2, r2, s2
                damping = max(damping / 10, 1e-12)
                moved = size >= STEP_TOLERANCE * max(1, abs(r))
                break
            damping *= 10
        if not moved:
            break
    if not np.all(np.isfinite(c)) or not math.isfinite(r) or not r > 0:
        return None
    return c, r


def sphere_residual(s, X):
    return np.linalg.norm(X - np.array([s["cx"], s["cy"], s["cz"]]), axis=1) - s["r"]


def fit_sphere_algebraic(P, idx):
    """Coope's linear fit: 2q·a + t = |q|² about the centroid."""
    idx = _idx(idx)
    if len(idx) < 4:
        return None
    m = P[idx].mean(axis=0)
    Q = P[idx] - m
    b = (Q * Q).sum(axis=1)
    A = np.hstack([2 * Q, np.ones((len(Q), 1))])
    u = solve_linear(A.T @ A, A.T @ b)
    if u is None:
        return None
    r2 = u[3] + u[0] ** 2 + u[1] ** 2 + u[2] ** 2
    if not r2 > 0 or not math.isfinite(r2):
        return None
    return {"cx": m[0] + u[0], "cy": m[1] + u[1], "cz": m[2] + u[2], "r": math.sqrt(r2)}


def refine_sphere_geometric(P, idx, init):
    idx = _idx(idx)
    if len(idx) == 0:
        return init
    m = P[idx].mean(axis=0)
    ball = refine_ball(P[idx] - m, [init["cx"] - m[0], init["cy"] - m[1], init["cz"] - m[2]], init["r"])
    if ball is None:
        return init
    c, r = ball
    return {"cx": c[0] + m[0], "cy": c[1] + m[1], "cz": c[2] + m[2], "r": r}


def fit_sphere_centre(P, idx, r, start, max_iter=50):
    """The centre of the sphere of radius r that fits best (Gauss–Newton)."""
    X = P[_idx(idx)]
    c = np.array([start["cx"], start["cy"], start["cz"]], dtype=float)
    for _ in range(max_iter):
        D = X - c
        d = np.linalg.norm(D, axis=1)
        ok = d >= 1e-12
        U = D[ok] / d[ok][:, None]
        e = d[ok] - r
        step = solve_linear(U.T @ U, U.T @ e)
        if step is None:
            return None
        c = c + step
        if np.linalg.norm(step) < 1e-10 * max(1, r):
            break
    if not np.all(np.isfinite(c)):
        return None
    return {"cx": c[0], "cy": c[1], "cz": c[2], "r": r}


def fit_sphere_clipped(P, idx, k, held=None):
    def free_fit(used):
        alg = fit_sphere_algebraic(P, used)
        return alg and refine_sphere_geometric(P, used, alg)

    def fit(used):
        free = free_fit(used)
        return fit_sphere_centre(P, used, held, free) if (free and held is not None) else free

    r = clipped_refit(P, idx, k, fit, sphere_residual)
    if not r:
        return None
    out = {"sphere": r["model"], "sigma": r["sigma"], "span": r["span"], "min": r["min"], "max": r["max"], "used": r["used"]}
    if held is not None:
        free = free_fit(r["used"])
        if free:
            out["free"] = free
    return out


def _sphere_from4(p0, p1, p2, p3):
    Q = np.array([p1 - p0, p2 - p0, p3 - p0])
    c = solve_linear(2 * Q, (Q * Q).sum(axis=1))
    if c is None:
        return None
    r = float(np.linalg.norm(c))
    if not math.isfinite(r) or r <= 0:
        return None
    return {"cx": p0[0] + c[0], "cy": p0[1] + c[1], "cz": p0[2] + c[2], "r": r}


def ransac_sphere(P, patch, opts=None):
    patch = _idx(patch)

    def shape(diag, rand):
        n = len(patch)

        def generate():
            ii = [patch[int(rand() * n)] for _ in range(4)]
            if len(set(int(i) for i in ii)) < 4:
                return None
            s = _sphere_from4(*(P[i] for i in ii))
            if s is None or s["r"] > diag * 200 or s["r"] < diag * 0.02:
                return None
            return s

        return None, generate, sphere_residual

    core = ransac_consensus(P, patch, opts or {}, shape)
    if not core:
        return None
    refined = fit_sphere_clipped(P, core["inliers"], 3)
    if not refined:
        return None
    return {"sphere": refined["sphere"], "inliers": refined["used"], "sigma": max(refined["sigma"], core["sigmaEst"], 1e-9)}


def fit_circle2d(pu0, pv0):
    """Best circle through 2D points: Coope start, then LM to convergence.
    (cu, cv, r) or None."""
    pu0 = np.asarray(pu0, dtype=float)
    pv0 = np.asarray(pv0, dtype=float)
    n = len(pu0)
    if n < 3:
        return None
    mu, mv = pu0.mean(), pv0.mean()
    pu, pv = pu0 - mu, pv0 - mv
    b = pu * pu + pv * pv
    A = np.column_stack([2 * pu, 2 * pv, np.ones(n)])
    sol = solve_linear(A.T @ A, A.T @ b)
    if sol is None:
        return None
    cu, cv = sol[0], sol[1]
    r2 = sol[2] + cu * cu + cv * cv
    if not r2 > 0 or not math.isfinite(r2):
        return None
    ball = refine_ball(np.column_stack([pu, pv]), [cu, cv], math.sqrt(r2))
    if ball is None:
        return None
    (cu, cv), r = ball
    return cu + mu, cv + mv, r


def circle_from_points(points):
    """The best-fit circle through picked points: TLS plane, 2D circle in it.
    Raises FitError on degenerate input."""
    X = np.asarray(points, dtype=float)
    n = len(X)
    if n < 3:
        raise FitError("A circle needs at least three points.")
    m = X.mean(axis=0)
    D = X - m
    spread = float((D * D).sum(axis=1).max())
    if not spread > 0:
        raise FitError("The points coincide — they do not define a circle.")
    vals, vecs = sym_eigen(D.T @ D)
    if not vals[1] > 1e-10 * spread:
        raise FitError("The points lie on a line — they do not define a circle.")
    normal = vecs[0]
    u, v = ortho_basis(normal)
    pu, pv, ph = D @ u, D @ v, D @ normal
    fit = fit_circle2d(pu, pv)
    if fit is None:
        raise FitError("Couldn't fit a circle through these points.")
    cu, cv, r = fit
    if normal[2] < 0 or (normal[2] == 0 and (normal[1] < 0 or (normal[1] == 0 and normal[0] < 0))):
        normal = -normal
    er = np.hypot(pu - cu, pv - cv) - r
    return {
        "kind": "circle",
        "center": list(m + cu * u + cv * v),
        "normal": list(normal),
        "radius": r,
        "sigma": float(math.sqrt(np.mean(er * er + ph * ph))),
        "usedPoints": n,
        "regionSize": n,
        "formError": float(er.max() - er.min()),
        "residualMin": float(er.min()),
        "residualMax": float(er.max()),
    }


# ---- cylinder ---------------------------------------------------------------


def _axis_frame(c):
    return np.array([c["px"], c["py"], c["pz"]]), np.array([c["ax"], c["ay"], c["az"]])


def cyl_radial(c, X):
    """(e, W unit radial, t) — e NaN on the axis."""
    p, a = _axis_frame(c)
    Q = X - p
    t = Q @ a
    W = Q - t[:, None] * a
    rho = np.linalg.norm(W, axis=1)
    ok = rho > 1e-12
    with np.errstate(invalid="ignore", divide="ignore"):
        e = np.where(ok, rho - c["r"], np.nan)
        Wn = np.where(ok[:, None], W / np.where(ok, rho, 1)[:, None], 0.0)
    return e, Wn, t, rho


def cylinder_residual(c, X):
    return cyl_radial(c, X)[0]


def axis_from_normals(N, idx):
    idx = _idx(idx)
    n = len(idx)
    if n < 3:
        return None
    M = N[idx]
    vals, vecs = sym_eigen(M.T @ M)
    if not vals[1] > 1e-6 * n:
        return None
    return vecs[0]


def fit_cylinder_on_axis(P, idx, axis):
    idx = _idx(idx)
    if len(idx) < 5:
        return None
    d = normalize_or_z(axis)
    u, v = ortho_basis(d)
    m = P[idx].mean(axis=0)
    D = P[idx] - m
    fit = fit_circle2d(D @ u, D @ v)
    if fit is None:
        return None
    cu, cv, r = fit
    p = m + cu * u + cv * v
    return {"px": p[0], "py": p[1], "pz": p[2], "ax": d[0], "ay": d[1], "az": d[2], "r": r}


def _apply_axis_step(c, u, v, step, extra):
    axis = normalize_or_z(np.array([c["ax"], c["ay"], c["az"]]) + step[2] * u + step[3] * v)
    p = np.array([c["px"], c["py"], c["pz"]]) + step[0] * u + step[1] * v
    out = {"px": p[0], "py": p[1], "pz": p[2], "ax": axis[0], "ay": axis[1], "az": axis[2]}
    out.update(extra)
    return out


def refine_cylinder_geometric(P, idx, init, max_iter=60):
    idx = _idx(idx)
    if len(idx) < 6:
        return init
    X = P[idx]
    c = dict(init)
    cost = rms_of(cylinder_residual(c, X))
    if not math.isfinite(cost):
        return init
    lam = 1e-6
    for _ in range(max_iter):
        u, v = ortho_basis([c["ax"], c["ay"], c["az"]])
        e, W, t, _rho = cyl_radial(c, X)
        ok = np.isfinite(e)
        if ok.sum() < 6:
            break
        e, W, t = e[ok], W[ok], t[ok]
        su, sv = W @ u, W @ v
        J = np.column_stack([-su, -sv, -t * su, -t * sv, -np.ones(len(e))])
        jtj, jtf = J.T @ J, J.T @ e
        applied = converged = False
        for _a in range(6):
            mat = jtj.copy()
            mat[np.diag_indices(5)] *= 1 + lam
            step = solve_linear(mat, -jtf)
            if step is None:
                lam *= 10
                continue
            cand = _apply_axis_step(c, u, v, step, {"r": c["r"] + step[4]})
            if not cand["r"] > 0 or not math.isfinite(cand["px"]):
                lam *= 10
                continue
            cc = rms_of(cylinder_residual(cand, X))
            if math.isfinite(cc) and cc <= cost:
                converged = cost - cc < 1e-12 * max(cost, cand["r"])
                c, cost = cand, cc
                lam = max(lam * 0.3, 1e-9)
                applied = True
                break
            lam *= 10
        if not applied or converged:
            break
    return c


def fit_cylinder_clipped(P, idx, init, k):
    state = {"start": init}

    def fit(used):
        s = state["start"]
        seeded = fit_cylinder_on_axis(P, used, [s["ax"], s["ay"], s["az"]]) or s
        c = refine_cylinder_geometric(P, used, seeded)
        if not (c["r"] > 0) or not math.isfinite(c["r"]):
            return None
        state["start"] = c
        return c

    r = clipped_refit(P, idx, k, fit, cylinder_residual)
    return r and {"cylinder": r["model"], "sigma": r["sigma"], "span": r["span"], "min": r["min"], "max": r["max"], "used": r["used"]}


def _cylinder_from2(P, N, i0, i1):
    n0, n1 = N[i0], N[i1]
    raw = np.cross(n0, n1)
    if not np.linalg.norm(raw) > 0.08:
        return None
    d = normalize_or_z(raw)
    u, v = ortho_basis(d)
    p0u, p0v, p1u, p1v = P[i0] @ u, P[i0] @ v, P[i1] @ u, P[i1] @ v
    n0u, n0v, n1u, n1v = n0 @ u, n0 @ v, n1 @ u, n1 @ v
    det = n0u * -n1v - -n1u * n0v
    if abs(det) < 1e-9:
        return None
    du, dv = p1u - p0u, p1v - p0v
    s = (du * -n1v - -n1u * dv) / det
    cu, cv = p0u + s * n0u, p0v + s * n0v
    r = math.hypot(cu - p0u, cv - p0v)
    if not r > 0 or not math.isfinite(r):
        return None
    p = P[i0] + (cu - p0u) * u + (cv - p0v) * v
    return {"px": p[0], "py": p[1], "pz": p[2], "ax": d[0], "ay": d[1], "az": d[2], "r": r}


def ransac_cylinder(P, N, patch, opts=None):
    patch = _idx(patch)

    def shape(diag, rand):
        n = len(patch)

        def plausible(c):
            return c["r"] > diag * 0.01 and c["r"] <= diag * 60

        axis = axis_from_normals(N, patch)
        from_normals = fit_cylinder_on_axis(P, patch, axis) if axis is not None else None

        def generate():
            i0 = patch[int(rand() * n)]
            i1 = patch[int(rand() * n)]
            if i0 == i1:
                return None
            c = _cylinder_from2(P, N, i0, i1)
            return c if c and plausible(c) else None

        return (from_normals if from_normals and plausible(from_normals) else None), generate, cylinder_residual

    core = ransac_consensus(P, patch, opts or {}, shape)
    if not core:
        return None
    refined = fit_cylinder_clipped(P, core["inliers"], core["model"], 3)
    if not refined:
        return None
    if not curved_beyond_plane(P, refined["used"], rms_of(cylinder_residual(refined["cylinder"], P[refined["used"]]))):
        return None
    return {"cylinder": refined["cylinder"], "inliers": refined["used"], "sigma": max(refined["sigma"], core["sigmaEst"], 1e-9)}


# ---- cone -------------------------------------------------------------------


def cone_slant(c, X):
    p, a = _axis_frame(c)
    Q = X - p
    t = Q @ a
    W = Q - t[:, None] * a
    rho = np.linalg.norm(W, axis=1)
    ok = rho > 1e-12
    with np.errstate(invalid="ignore", divide="ignore"):
        e = np.where(ok, math.cos(c["phi"]) * (rho - c["r"]) - math.sin(c["phi"]) * t, np.nan)
        Wn = np.where(ok[:, None], W / np.where(ok, rho, 1)[:, None], 0.0)
    return e, Wn, t, rho


def cone_residual(c, X):
    return cone_slant(c, X)[0]


def cone_normal_signed(c, X, Nn):
    _e, W, _t, _rho = cone_slant(c, X)
    a = np.array([c["ax"], c["ay"], c["az"]])
    S = math.cos(c["phi"]) * W - math.sin(c["phi"]) * a
    s = (S * Nn).sum(axis=1)
    return np.where(np.any(W != 0, axis=1), s, 0.0)


def cone_normal_align(c, X, Nn):
    return np.abs(cone_normal_signed(c, X, Nn))


def _canonical_cone(c):
    if c["phi"] >= 0:
        return c
    c = dict(c)
    c.update(ax=-c["ax"], ay=-c["ay"], az=-c["az"], phi=-c["phi"])
    return c


def cone_axis_from_normals(N, idx):
    idx = _idx(idx)
    n = len(idx)
    if n < 3:
        return None
    M = N[idx] - N[idx].mean(axis=0)
    vals, vecs = sym_eigen(M.T @ M)
    if not vals[1] > 1e-6 * n:
        return None
    return vecs[0]


def fit_cone_on_axis(P, idx, axis):
    idx = _idx(idx)
    n = len(idx)
    if n < 6:
        return None
    d = normalize_or_z(axis)
    u, v = ortho_basis(d)
    m = P[idx].mean(axis=0)
    D = P[idx] - m
    pu, pv = D @ u, D @ v
    fit = fit_circle2d(pu, pv)
    if fit is None:
        return None
    cu, cv, _r = fit
    t = D @ d
    rho = np.hypot(pu - cu, pv - cv)
    st, stt, sr, st_r = t.sum(), (t * t).sum(), rho.sum(), (t * rho).sum()
    det = n * stt - st * st
    tan, r = 0.0, sr / n
    if det > 1e-12 * max(1, stt) * n:
        tan = (n * st_r - st * sr) / det
        r = (sr - tan * st) / n
    if not math.isfinite(r) or not r > 0 or not math.isfinite(tan):
        return None
    p = m + cu * u + cv * v
    return _canonical_cone({"px": p[0], "py": p[1], "pz": p[2], "ax": d[0], "ay": d[1], "az": d[2], "r": r, "phi": math.atan(tan)})


def refine_cone_geometric(P, idx, init, max_iter=60):
    idx = _idx(idx)
    if len(idx) < 7:
        return init
    X = P[idx]
    c = dict(init)
    cost = rms_of(cone_residual(c, X))
    if not math.isfinite(cost):
        return init
    lam = 1e-6
    for _ in range(max_iter):
        u, v = ortho_basis([c["ax"], c["ay"], c["az"]])
        cs, sn = math.cos(c["phi"]), math.sin(c["phi"])
        e, W, t, rho = cone_slant(c, X)
        ok = np.isfinite(e)
        if ok.sum() < 7:
            break
        e, W, t, rho = e[ok], W[ok], t[ok], rho[ok]
        su, sv = W @ u, W @ v
        tilt = t * cs + rho * sn
        J = np.column_stack([-cs * su, -cs * sv, -tilt * su, -tilt * sv, -cs * np.ones(len(e)), -(sn * (rho - c["r"]) + cs * t)])
        jtj, jtf = J.T @ J, J.T @ e
        applied = converged = False
        for _a in range(6):
            mat = jtj.copy()
            mat[np.diag_indices(6)] *= 1 + lam
            step = solve_linear(mat, -jtf)
            if step is None:
                lam *= 10
                continue
            cand = _apply_axis_step(c, u, v, step, {"r": c["r"] + step[4], "phi": c["phi"] + step[5]})
            if not cand["r"] > 0 or not math.isfinite(cand["px"]) or not abs(cand["phi"]) < 1.48:
                lam *= 10
                continue
            cc = rms_of(cone_residual(cand, X))
            if math.isfinite(cc) and cc <= cost:
                converged = cost - cc < 1e-12 * max(cost, cand["r"])
                c, cost = cand, cc
                lam = max(lam * 0.3, 1e-9)
                applied = True
                break
            lam *= 10
        if not applied or converged:
            break
    return _canonical_cone(c)


def fit_cone_clipped(P, idx, init, k):
    state = {"start": init}

    def fit(used):
        s = state["start"]
        seeded = fit_cone_on_axis(P, used, [s["ax"], s["ay"], s["az"]]) or s
        c = refine_cone_geometric(P, used, seeded)
        if not c["r"] > 0 or not math.isfinite(c["r"]) or not math.isfinite(c["phi"]):
            return None
        state["start"] = c
        return c

    r = clipped_refit(P, idx, k, fit, cone_residual)
    return r and {"cone": r["model"], "sigma": r["sigma"], "span": r["span"], "min": r["min"], "max": r["max"], "used": r["used"]}


def _cone_from3(P, N, ids):
    A = N[ids]
    apex = solve_linear(A, (A * P[ids]).sum(axis=1))
    if apex is None:
        return None
    dirs = []
    for i in ids:
        dd = P[i] - apex
        ln = float(np.linalg.norm(dd))
        if not ln > 1e-9:
            return None
        dirs.append(dd / ln)
    raw = np.cross(dirs[1] - dirs[0], dirs[2] - dirs[0])
    if not np.linalg.norm(raw) > 0.02:
        return None
    d = normalize_or_z(raw)
    dot_sum = sum(float(x @ d) for x in dirs)
    if dot_sum < 0:
        d = -d
    phi = math.acos(min(1, abs(dot_sum) / 3))
    if not phi > 0.005 or not phi < 1.48:
        return None
    t_mean = float(np.mean([(P[i] - apex) @ d for i in ids]))
    r = t_mean * math.tan(phi)
    if not r > 0 or not math.isfinite(r):
        return None
    p = apex + t_mean * d
    return {"px": p[0], "py": p[1], "pz": p[2], "ax": d[0], "ay": d[1], "az": d[2], "r": r, "phi": phi}


def ransac_cone(P, N, patch, opts=None):
    patch = _idx(patch)

    def shape(diag, rand):
        n = len(patch)

        def plausible(c):
            return c["r"] > diag * 0.005 and c["r"] <= diag * 60 and abs(c["phi"]) < 1.48

        axis = cone_axis_from_normals(N, patch)
        from_normals = fit_cone_on_axis(P, patch, axis) if axis is not None else None

        def generate():
            ids = [patch[int(rand() * n)] for _ in range(3)]
            if len(set(int(i) for i in ids)) < 3:
                return None
            c = _cone_from3(P, N, np.array(ids))
            return c if c and plausible(c) else None

        return (from_normals if from_normals and plausible(from_normals) else None), generate, cone_residual

    core = ransac_consensus(P, patch, opts or {}, shape)
    if not core:
        return None
    refined = fit_cone_clipped(P, core["inliers"], core["model"], 3)
    if not refined:
        return None
    return {"cone": refined["cone"], "inliers": refined["used"], "sigma": max(refined["sigma"], core["sigmaEst"], 1e-9)}


# ---- torus ------------------------------------------------------------------


def torus_residual(t, X):
    c = np.array([t["cx"], t["cy"], t["cz"]])
    a = np.array([t["ax"], t["ay"], t["az"]])
    D = X - c
    h = D @ a
    rho = np.linalg.norm(D - h[:, None] * a, axis=1)
    return np.sqrt((rho - t["R"]) ** 2 + h * h) - t["r"]


def torus_normal_align(t, X, Nn):
    c = np.array([t["cx"], t["cy"], t["cz"]])
    a = np.array([t["ax"], t["ay"], t["az"]])
    D = X - c
    h = D @ a
    Rv = D - h[:, None] * a
    rho = np.linalg.norm(Rv, axis=1)
    ok = rho >= 1e-12
    with np.errstate(invalid="ignore", divide="ignore"):
        Rv = Rv / np.where(ok, rho, 1)[:, None]
        S = D - t["R"] * Rv
        ln = np.linalg.norm(S, axis=1)
        ok &= ln >= 1e-12
        out = np.abs((S * Nn).sum(axis=1) / np.where(ok, ln, 1))
    return np.where(ok, out, 0.0)


def torus_from_shift(P, N, idx, shift):
    idx = _idx(idx)
    n = len(idx)
    if n < 4:
        return None
    S = P[idx] - shift * N[idx]
    m = S.mean(axis=0)
    D = S - m
    vals, vecs = sym_eigen(D.T @ D)
    if not vals[1] > 1e-9 * max(vals[2], 1e-12):
        return None
    axis = vecs[0]
    u, v = ortho_basis(axis)
    fit = fit_circle2d(D @ u, D @ v)
    if fit is None or not fit[2] > 0 or not math.isfinite(fit[2]):
        return None
    cu, cv, R = fit
    c = m + cu * u + cv * v
    return {"cx": c[0], "cy": c[1], "cz": c[2], "ax": axis[0], "ay": axis[1], "az": axis[2], "R": R, "r": abs(shift)}


def _torus_apply(base, p):
    u, v = ortho_basis([base["ax"], base["ay"], base["az"]])
    a = np.array([base["ax"], base["ay"], base["az"]]) + p[3] * u + p[4] * v
    a = a / (np.linalg.norm(a) or 1)
    return {"cx": base["cx"] + p[0], "cy": base["cy"] + p[1], "cz": base["cz"] + p[2], "ax": a[0], "ay": a[1], "az": a[2], "R": base["R"] + p[5], "r": base["r"] + p[6]}


def refine_torus_geometric(P, idx, init, max_iter=40):
    idx = _idx(idx)
    if len(idx) < 8:
        return init
    X = P[idx]
    t = dict(init)
    cost = rms_of(torus_residual(t, X))
    if not math.isfinite(cost):
        return init
    lam = 1e-6
    scale = max(t["R"], t["r"], 1e-3)
    for _ in range(max_iter):
        h = 1e-6 * scale
        e = torus_residual(t, X)
        ok = np.isfinite(e)
        cols = []
        for a in range(7):
            d = h / scale if 3 <= a <= 4 else h
            step = np.zeros(7)
            step[a] = d
            plus = torus_residual(_torus_apply(t, step), X)
            step[a] = -d
            minus = torus_residual(_torus_apply(t, step), X)
            cols.append((plus - minus) / (2 * d))
        J = np.column_stack(cols)[ok]
        e = e[ok]
        jtj, jtf = J.T @ J, J.T @ e
        improved = False
        for _a in range(8):
            if improved:
                break
            damped = jtj.copy()
            damped[np.diag_indices(7)] *= 1 + lam
            delta = solve_linear(damped, -jtf)
            if delta is None:
                lam *= 10
                continue
            nxt = _torus_apply(t, delta)
            if not nxt["R"] > 0 or not nxt["r"] > 0:
                lam *= 10
                continue
            nc = rms_of(torus_residual(nxt, X))
            if nc < cost:
                moved = math.hypot(delta[0], delta[1], delta[2], delta[5], delta[6]) + math.hypot(delta[3], delta[4]) * scale
                t, cost = nxt, nc
                lam = max(lam / 10, 1e-9)
                improved = True
                if moved < 1e-9 * scale:
                    return t
            else:
                lam *= 10
        if not improved:
            break
    return t


def fit_torus_clipped(P, idx, k, init):
    state = {"cur": init}

    def fit(used):
        nxt = refine_torus_geometric(P, used, state["cur"])
        if not nxt["R"] > 0 or not nxt["r"] > 0:
            return None
        state["cur"] = nxt
        return nxt

    r = clipped_refit(P, idx, k, fit, torus_residual)
    if not r:
        return None
    r["torus"] = r["model"]
    return r


def ransac_torus(P, N, patch, opts=None):
    opts = opts or {}
    patch = _idx(patch)

    def shape(diag, rand):
        n = len(patch)
        subset = min(n, 48)
        call = [0]

        def generate():
            k = call[0]
            call[0] += 1
            frac = ((k >> 1) % 40) / 39
            shift = (-1 if k & 1 else 1) * diag * 0.02 * math.pow(100, frac)
            local = min(n, max(subset * 2, 300))
            idx = np.array([patch[int(rand() * local)] for _ in range(subset)])
            t = torus_from_shift(P, N, idx, shift)
            if t is None or not t["R"] > 1e-6 or t["R"] > diag * 50:
                return None
            pol = refine_torus_geometric(P, idx, t, 8)
            return pol if (pol["R"] > 1e-6 and pol["R"] <= diag * 50) else t

        return None, generate, torus_residual

    core = ransac_consensus(P, patch, {"iterations": opts.get("iterations") or 320, "seed": opts.get("seed")}, shape)
    if not core:
        return None
    refined = fit_torus_clipped(P, core["inliers"], 3, core["model"])
    if not refined:
        return None
    return {"torus": refined["torus"], "inliers": refined["used"], "sigma": max(refined["sigma"], core["sigmaEst"], 1e-9)}


def canonical_torus(t, N, idx):
    s = float((N[_idx(idx)] @ np.array([t["ax"], t["ay"], t["az"]])).sum())
    if s < 0:
        t = dict(t)
        t.update(ax=-t["ax"], ay=-t["ay"], az=-t["az"])
    return t


def torus_coverage(t, P, idx):
    u, v = ortho_basis([t["ax"], t["ay"], t["az"]])
    D = P[_idx(idx)] - np.array([t["cx"], t["cy"], t["cz"]])
    a = D @ np.array([t["ax"], t["ay"], t["az"]])
    pu, pv = D @ u, D @ v
    rho = np.hypot(pu, pv)
    spine = set(np.round(np.degrees(np.arctan2(pv, pu)) / 5).astype(int).tolist())
    tube = set(np.round(np.degrees(np.arctan2(a, rho - t["R"])) / 5).astype(int).tolist())
    return min(360, len(tube) * 5), min(360, len(spine) * 5)


# ---- extents and seeds ------------------------------------------------------

COVERAGE_SAMPLES = 20000


def axial_extents(P, region, c):
    """(coverage°, minT, maxT): 360° less the widest empty gap round the axis,
    and the axial reach."""
    p, a = _axis_frame(c)
    u, v = ortho_basis(a)
    Q = P[_idx(region)] - p
    t = Q @ a
    if len(t) == 0:
        return 0.0, math.inf, -math.inf
    step = max(1, math.ceil(len(t) / COVERAGE_SAMPLES))
    S = Q[::step]
    ang = np.sort(np.arctan2(S @ v, S @ u))
    if len(ang) < 2:
        return 0.0, float(t.min()), float(t.max())
    widest = max(ang[0] + 2 * math.pi - ang[-1], float(np.max(np.diff(ang))))
    return max(0.0, 360 - math.degrees(widest)), float(t.min()), float(t.max())


def seed_off(fit, point, normal):
    """How far a seed lies off a fitted surface along its normal, and how far
    its own normal turns from the surface's there (0–90°)."""
    nrm = np.asarray(normal, dtype=float)
    ln = float(np.linalg.norm(nrm))
    if not ln > 0:
        return None
    n = nrm / ln
    x = np.asarray(point, dtype=float)

    def deg(cs):
        return math.degrees(math.acos(min(1.0, abs(float(cs)))))

    k = fit["kind"]
    if k == "plane":
        return {"offMm": float((x - fit["center"]) @ fit["normal"]), "deg": deg(n @ fit["normal"])}
    if k == "sphere":
        d = x - fit["center"]
        r = float(np.linalg.norm(d))
        return {"offMm": r - fit["radius"], "deg": deg(d @ n / r)} if r > 1e-12 else None
    if k == "cylinder":
        d = x - fit["center"]
        a = np.asarray(fit["axis"])
        w = d - (d @ a) * a
        rho = float(np.linalg.norm(w))
        return {"offMm": rho - fit["radius"], "deg": deg(w @ n / rho)} if rho > 1e-12 else None
    if k == "cone":
        c = {"px": fit["center"][0], "py": fit["center"][1], "pz": fit["center"][2], "ax": fit["axis"][0], "ay": fit["axis"][1], "az": fit["axis"][2], "r": fit["radius"], "phi": math.radians(fit["halfAngle"])}
        off = float(cone_residual(c, x[None])[0])
        return {"offMm": off, "deg": deg(cone_normal_align(c, x[None], n[None])[0])} if math.isfinite(off) else None
    if k == "torus":
        t = {"cx": fit["center"][0], "cy": fit["center"][1], "cz": fit["center"][2], "ax": fit["axis"][0], "ay": fit["axis"][1], "az": fit["axis"][2], "R": fit["majorRadius"], "r": fit["minorRadius"]}
        return {"offMm": float(torus_residual(t, x[None])[0]), "deg": deg(torus_normal_align(t, x[None], n[None])[0])}
    return None
