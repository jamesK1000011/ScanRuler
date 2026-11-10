# SPDX-License-Identifier: AGPL-3.0-only
# A sloped or gently curved patch of scan measured as a surface over its own
# plane: the best plane through the points sets a frame, and the patch is
# fitted as a height over (u, v) — a plane, a bilinear patch (a twisted
# ruled side) or a full quadric (a dome, a bowl, a saddle, a cylinder's
# strip) — each told by its RMS and worst miss, the quadric also by its
# principal curvatures. Ported from ScanRuler by CNC Kitchen:
# src/core/fit/heightSurface.ts.

import math

import numpy as np

from .linalg import ortho_basis

MODELS = ["plane", "bilinear", "quadric"]
NAMES = {"plane": ["a", "b", "c"], "bilinear": ["a", "b", "c", "d"], "quadric": ["a", "b", "c", "d", "e", "f"]}
SIMPLEST_SHARE = 1.1


def patch_frame(P):
    P = np.asarray(P, float)
    if len(P) < 3:
        return None
    o = P.mean(0)
    X = P - o
    w, vec = np.linalg.eigh(X.T @ X)
    if not w[1] > 1e-12 * max(w[2], 1e-30):
        return None
    n = vec[:, 0] / np.linalg.norm(vec[:, 0])
    u, v = ortho_basis(n)
    return {"origin": o, "basisU": np.asarray(u), "basisV": np.asarray(v), "normal": n}


def _terms(model, u, v):
    one = np.ones_like(u)
    if model == "plane":
        return np.column_stack([one, u, v])
    if model == "bilinear":
        return np.column_stack([one, u, v, u * v])
    return np.column_stack([one, u, v, u * u, u * v, v * v])


def _curvature(fr, b, c, d, e, f):
    W = math.sqrt(1 + b * b + c * c)
    E, F, G = 1 + b * b, b * c, 1 + c * c
    L, M, N = 2 * d / W, e / W, 2 * f / W
    det = E * G - F * F
    s11, s12 = (G * L - F * M) / det, (G * M - F * N) / det
    s21, s22 = (E * M - F * L) / det, (E * N - F * M) / det
    tr, dt = s11 + s22, s11 * s22 - s12 * s21
    disc = math.sqrt(max(0.0, tr * tr / 4 - dt))
    ka, kb = tr / 2 + disc, tr / 2 - disc
    if abs(kb) > abs(ka):
        ka, kb = kb, ka
    xu = fr["basisU"] + b * fr["normal"]
    xv = fr["basisV"] + c * fr["normal"]

    def unit(x, fallback):
        n = np.linalg.norm(x)
        return x / n if n > 0 else fallback

    if abs(s12) > 1e-12:
        p = (s12, ka - s11)
    elif abs(s21) > 1e-12:
        p = (ka - s22, s21)
    else:
        p = (1, 0) if abs(s11 - ka) < abs(s22 - ka) else (0, 1)
    axis1 = unit(p[0] * xu + p[1] * xv, fr["basisU"])
    tn = unit(np.cross(xu, xv), fr["normal"])
    axis2 = unit(np.cross(tn, axis1), fr["basisV"])
    tiny = 1e-5
    shape = "flat" if abs(ka) < tiny else "cylinder" if abs(kb) < tiny else "dome" if ka * kb > 0 else "saddle"
    return {"k1": ka, "k2": kb, "r1": 1 / ka if abs(ka) > tiny else None, "r2": 1 / kb if abs(kb) > tiny else None,
            "axis1": axis1.tolist(), "axis2": axis2.tolist(), "shape": shape}


def fit_height(P, fr, model):
    P = np.asarray(P, float)
    k = len(NAMES[model])
    if len(P) < k + 1:
        return None
    D = P - fr["origin"]
    u, v, h = D @ fr["basisU"], D @ fr["basisV"], D @ fr["normal"]
    A = _terms(model, u, v)
    try:
        x = np.linalg.solve(A.T @ A, A.T @ h)
    except np.linalg.LinAlgError:
        return None
    if not np.all(np.isfinite(x)):
        return None
    e = h - A @ x
    out = {"model": model, "coefficients": {n: float(c) for n, c in zip(NAMES[model], x)}, "rms": float(math.sqrt((e * e).mean())), "worst": float(np.abs(e).max())}
    if model == "quadric":
        out["curvature"] = _curvature(fr, *map(float, x[1:6]))
    return out


def fit_models(P, models=MODELS):
    fr = patch_frame(P)
    if fr is None:
        return None
    fits = [f for f in (fit_height(P, fr, m) for m in models) if f]
    if not fits:
        return {"frame": fr, "fits": fits, "best": None}
    lowest = min(f["rms"] for f in fits)
    order = [m for m in MODELS if any(f["model"] == m for f in fits)]
    best = next((m for m in order if next(f for f in fits if f["model"] == m)["rms"] <= SIMPLEST_SHARE * lowest + 1e-9), None)
    return {"frame": fr, "fits": fits, "best": best}
