# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/fit/linalg.ts, src/core/vec.ts,
# src/core/fit/ransac.ts (mulberry32), src/core/fit/errors.ts
#
# The dense linear algebra behind the fits: linear systems by elimination,
# symmetric eigenproblems (a plane's normal, a cylinder's axis from its
# normals and a best-fit rotation are each an extreme eigenvector of a small
# matrix), the vector helpers and the seeded PRNG that makes fits repeatable.

import math

import numpy as np


class FitError(Exception):
    """A fit that could not be pinned down from where the user clicked. The
    message is shown to the user verbatim, so it says what to try instead."""


def solve_linear(a, b):
    """Gaussian elimination with partial pivoting; None when a pivot falls
    under 1e-13 of the largest entry (or of 1)."""
    a = np.array(a, dtype=float, copy=True)
    x = np.array(b, dtype=float, copy=True)
    n = len(x)
    a = a.reshape(n, n)
    tiny = max(float(np.max(np.abs(a))) if a.size else 0.0, 1.0) * 1e-13
    for col in range(n):
        piv = col + int(np.argmax(np.abs(a[col:, col])))
        best = abs(a[piv, col])
        if not best >= tiny:
            return None
        if piv != col:
            a[[col, piv], col:] = a[[piv, col], col:]
            x[col], x[piv] = x[piv], x[col]
        p = a[col, col]
        f = a[col + 1:, col] / p
        a[col + 1:, col:] -= np.outer(f, a[col, col:])
        x[col + 1:] -= f * x[col]
    for row in range(n - 1, -1, -1):
        x[row] = (x[row] - a[row, row + 1:] @ x[row + 1:]) / a[row, row]
    return x


def cholesky_solve(a, b, tiny=1e-12):
    """A symmetric positive-definite system by Cholesky; None when a pivot
    comes out at or below `tiny`."""
    n = len(b)
    a = np.asarray(a, dtype=float).reshape(n, n)
    L = np.zeros((n, n))
    for j in range(n):
        d = a[j, j] - L[j, :j] @ L[j, :j]
        if not d > tiny:
            return None
        L[j, j] = math.sqrt(d)
        L[j + 1:, j] = (a[j + 1:, j] - L[j + 1:, :j] @ L[j, :j]) / L[j, j]
    y = np.zeros(n)
    for i in range(n):
        y[i] = (b[i] - L[i, :i] @ y[:i]) / L[i, i]
    x = np.zeros(n)
    for i in range(n - 1, -1, -1):
        x[i] = (y[i] - L[i + 1:, i] @ x[i + 1:]) / L[i, i]
    return x


def sym_eigen(m):
    """Eigenvalues ascending, with unit eigenvectors (rows), of a symmetric
    matrix — what ScanRuler's Jacobi sweeps give, to rounding."""
    m = np.asarray(m, dtype=float)
    n = int(round(math.sqrt(m.size)))
    w, v = np.linalg.eigh(m.reshape(n, n))
    vecs = [normalize_or_z(v[:, i]) if n == 3 else v[:, i] / (np.linalg.norm(v[:, i]) or 1) for i in range(n)]
    return [float(x) for x in w], vecs


def normalize_or_z(v):
    v = np.asarray(v, dtype=float)
    ln = float(np.linalg.norm(v))
    if not ln > 1e-20:
        return np.array([0.0, 0.0, 1.0])
    return v / ln


def normalize(v):
    """A unit vector, or None for a zero one (vec.normalize)."""
    v = np.asarray(v, dtype=float)
    ln = float(np.linalg.norm(v))
    if not ln > 1e-12:
        return None
    return v / ln


def ortho_basis(n):
    """Any two unit vectors completing `n` into a right-handed frame."""
    n = np.asarray(n, dtype=float)
    ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
    helper = np.array([1.0, 0, 0]) if (ax <= ay and ax <= az) else (np.array([0, 1.0, 0]) if ay <= az else np.array([0, 0, 1.0]))
    u = normalize_or_z(np.cross(n, helper))
    v = normalize_or_z(np.cross(n, u))
    return u, v


def angle_between(a, b):
    c = max(-1.0, min(1.0, float(np.dot(a, b))))
    return math.degrees(math.acos(c))


def acute_angle(a, b):
    """Angle between two directions folded into 0–90°."""
    c = min(1.0, abs(float(np.dot(a, b))))
    return math.degrees(math.acos(c))


def foot_on_line(p, origin, d):
    p, origin, d = (np.asarray(x, dtype=float) for x in (p, origin, d))
    return origin + d * float(np.dot(p - origin, d))


def param_on_line(p, origin, d):
    return float(np.dot(np.asarray(p, dtype=float) - np.asarray(origin, dtype=float), d))


def closest_between_lines(p1, d1, p2, d2):
    p1, d1, p2, d2 = (np.asarray(x, dtype=float) for x in (p1, d1, p2, d2))
    n = np.cross(d1, d2)
    if np.linalg.norm(n) < 1e-9:
        return p1, foot_on_line(p1, p2, d2), 0.0, param_on_line(p1, p2, d2)
    w = p2 - p1
    d1d2 = float(np.dot(d1, d2))
    det = 1 - d1d2 * d1d2
    t1 = (np.dot(w, d1) - d1d2 * np.dot(w, d2)) / det
    t2 = (d1d2 * np.dot(w, d1) - np.dot(w, d2)) / det
    return p1 + d1 * t1, p2 + d2 * t2, float(t1), float(t2)


def mulberry32(seed):
    """Deterministic PRNG so fits are reproducible for identical input — the
    same stream as ScanRuler's."""
    state = [seed & 0xFFFFFFFF]
    M = 0xFFFFFFFF

    def imul(x, y):
        return (x * y) & M

    def rand():
        a = (state[0] + 0x6D2B79F5) & M
        state[0] = a
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & M) ^ t
        return ((t ^ (t >> 14)) & M) / 4294967296

    return rand
