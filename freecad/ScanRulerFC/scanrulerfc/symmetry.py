# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/symmetry.ts,
# src/core/alignSymmetry.ts, src/core/deviation/icp.ts (sampleScan, and the
# point-to-plane registration as much as the search needs),
# src/core/deviation/prealign.ts (principalFrame)
#
# The plane the scan is mirror-symmetric about: the scan's samples are
# reflected through a candidate plane, the reflection registered back onto
# the scan, and the plane bisecting each sample and its registered mirror
# image is the next candidate — reflect, register, bisect, until it settles.
# Candidates are the principal planes through the centroid, or a seed.
#
# The scan as a surface is its vertices with their normals here: a mirrored
# sample's distance is to the tangent plane at the nearest vertex. On a scan
# dense enough to measure that is the distance to the surface, to well under
# its noise.

import math

import numpy as np

from .linalg import mulberry32, normalize, sym_eigen
from .model import Refusal

REJECT_MEDIAN_FACTOR = 3
SYMMETRY_MAX_RMS_MM = 0.1
SYMMETRY_MIN_MATCHED = 0.5
ALIGN_SYMMETRY_MAX_RMS_MM = 0.5


class Surface:
    """Closest points on the scan: the nearest vertex, then its tangent
    plane. A k-d tree when SciPy is there, else brute force in blocks."""

    def __init__(self, P, N):
        self.P, self.N = P, N
        self.diag = float(np.linalg.norm(P.max(axis=0) - P.min(axis=0)))
        try:
            from scipy.spatial import cKDTree

            self.tree = cKDTree(P)
        except Exception:
            self.tree = None

    def nearest(self, X):
        if self.tree is not None:
            _d, i = self.tree.query(X)
            return i
        out = np.empty(len(X), dtype=np.int64)
        P2 = (self.P * self.P).sum(axis=1)
        for s in range(0, len(X), 256):
            Q = X[s:s + 256]
            d = P2[None, :] - 2 * Q @ self.P.T
            out[s:s + 256] = np.argmin(d, axis=1)
        return out

    def closest(self, X, reach):
        """Per point: the distance to the surface (inf past reach), the
        closest point and the surface normal there."""
        i = self.nearest(X)
        V, Nn = self.P[i], self.N[i]
        h = ((X - V) * Nn).sum(axis=1)
        q = X - h[:, None] * Nn
        d = np.abs(h)
        euclid = np.linalg.norm(X - V, axis=1)
        d = np.where(euclid <= reach, d, np.inf)
        return d, q, Nn


def sample_scan(P, N, wanted, seed=0x5EED):
    total = len(P)
    count = min(wanted, total)
    stride = total / count
    phase = mulberry32(seed)()
    idx = np.minimum(total - 1, np.floor((np.arange(count) + phase) * stride).astype(np.int64))
    return P[idx], N[idx]


def principal_frame(X):
    c = X.mean(axis=0)
    D = X - c
    _vals, vecs = sym_eigen(D.T @ D / len(X))
    return c, [vecs[2], vecs[1], vecs[0]]


def reflect(X, Nn, n, p):
    d = 2 * (X @ n - float(p @ n))
    e = 2 * (Nn @ n)
    return X - d[:, None] * n, Nn - e[:, None] * n


def _match_threshold(d):
    f = d[np.isfinite(d)]
    if len(f) == 0:
        return 0.0
    return max(REJECT_MEDIAN_FACTOR * float(np.sort(f)[len(f) >> 1]), 1e-6)


def icp(surface, X, Nx, max_iter, max_pair, tol):
    """Point-to-plane registration of X onto the scan: (R, t, matched)."""
    R, t = np.eye(3), np.zeros(3)
    matched = 0
    for _ in range(max_iter):
        Y = X @ R.T + t
        Ny = Nx @ R.T
        d, q, n = surface.closest(Y, max_pair)
        ok = np.isfinite(d) & ((Ny * n).sum(axis=1) >= 0.5)
        if ok.sum() < 6:
            break
        thr = _match_threshold(np.where(ok, d, np.inf))
        ok &= d <= thr
        matched = int(ok.sum())
        if matched < 6:
            break
        Yk, qk, nk = Y[ok], q[ok], n[ok]
        A = np.hstack([np.cross(Yk, nk), nk])
        b = ((qk - Yk) * nk).sum(axis=1)
        try:
            x = np.linalg.solve(A.T @ A + 1e-12 * np.eye(6), A.T @ b)
        except np.linalg.LinAlgError:
            break
        w = x[:3]
        ang = float(np.linalg.norm(w))
        if ang > 1e-15:
            k = w / ang
            K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
            dR = np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K
        else:
            dR = np.eye(3)
        R, t = dR @ R, dR @ t + x[3:]
        if ang < 1e-9 and np.linalg.norm(x[3:]) < tol:
            break
    return R, t, matched


def _bisector(X, Y, keep, current):
    if keep.sum() < 20:
        return None
    D = Y[keep] - X[keep]
    s = np.where(D @ current < 0, -1.0, 1.0)
    n = normalize((D * s[:, None]).sum(axis=0))
    if n is None:
        return None
    return n, ((X[keep] + Y[keep]) / 2).mean(axis=0)


def _residual(surface, X, Nx, n, p, reach):
    M, _ = reflect(X, Nx, n, p)
    d, _q, _n = surface.closest(M, reach)
    thr = _match_threshold(d)
    m = d <= thr
    matched = int(m.sum())
    ss = float((d[m] ** 2).sum())
    return {"rms": math.sqrt(ss / matched) if matched else math.inf, "matched": matched, "capped": math.sqrt((ss + (len(d) - matched) * reach * reach) / max(1, len(d)))}


def find_symmetry_plane(P, N, seed=None, vertices=None, samples=4000, rounds=5):
    surface = Surface(P, N)
    pos, nrm = (P[vertices], N[vertices]) if vertices is not None and len(vertices) else (P, N)
    X, Nx = sample_scan(pos, nrm, samples)
    if len(X) < 100:
        raise ValueError("Too few points to look for a symmetry.")
    diag = surface.diag
    reach = diag * 0.1
    coarse = sample_scan(pos, nrm, max(600, round(len(X) / 6))) if len(X) > 1200 else (X, Nx)
    if seed is not None:
        n = normalize(seed["normal"])
        if n is None:
            raise ValueError("The seed plane has no direction.")
        cands = [(n, np.asarray(seed["point"], dtype=float))]
    else:
        c, axes = principal_frame(X)
        cands = [(a, c) for a in axes]

    def settle(S, start, passes, fine):
        Xs, Ns = S
        n, p = start
        search = reach
        for _ in range(passes):
            Mx, Mn = reflect(Xs, Ns, n, p)
            R, t, matched = icp(surface, Mx, Mn, 40 if fine else 15, search, diag * (1e-7 if fine else 1e-5))
            if matched < 0.2 * len(Xs):
                break
            moved = Mx @ R.T + t
            d, _q, _n = surface.closest(moved, search)
            thr = _match_threshold(d)
            nxt = _bisector(Xs, moved, d <= thr, n)
            if nxt is None:
                break
            turned = math.acos(min(1.0, abs(float(nxt[0] @ n))))
            shifted = abs(float((nxt[1] - p) @ nxt[0]))
            n, p = nxt
            search = min(reach, max(diag * 0.01, 4 * thr))
            if (turned < 1e-7 and shifted < 1e-6) if fine else (turned < 1e-4 and shifted < diag * 1e-5):
                break
        return n, p

    field = [{"plane": c, "ci": i, "capped": 0.0} for i, c in enumerate(cands)]
    if coarse[0] is not X:
        for f in field:
            f["plane"] = settle(coarse, f["plane"], 3, False)
            f["capped"] = _residual(surface, coarse[0], coarse[1], f["plane"][0], f["plane"][1], reach)["capped"]
        field.sort(key=lambda f: f["capped"])
        field = [f for i, f in enumerate(field) if i == 0 or (i == 1 and f["capped"] <= 1.25 * field[0]["capped"])]
    best = None
    for f in field:
        n, p = settle((X, Nx), f["plane"], rounds, True)
        r = _residual(surface, X, Nx, n, p, reach)
        if best is None or r["capped"] < best["capped"]:
            best = {"normal": n, "point": p, "rms": r["rms"], "matched": r["matched"], "sampled": len(X), "candidate": -1 if seed else f["ci"], "capped": r["capped"]}
    if best is None:
        raise ValueError("No symmetry plane could be found.")
    best.pop("capped")
    return best


def accepted(r, max_rms=SYMMETRY_MAX_RMS_MM):
    return math.isfinite(r["rms"]) and r["rms"] <= max_rms and r["sampled"] > 0 and r["matched"] / r["sampled"] >= SYMMETRY_MIN_MATCHED


def find_symmetry(scan, vertices=None, seed=None):
    """plane-symmetry's search, as the construction takes it."""
    g = scan.graph()
    s = None
    if seed is not None:
        s = {"normal": seed["normal"], "point": seed["center"]}
    try:
        r = find_symmetry_plane(g.P, g.N, s, vertices)
    except ValueError as e:
        raise Refusal("failed", str(e))
    if not accepted(r):
        r["note"] = f"A loose match: the mirror image stands {r['rms']:.3f} mm off the scan (RMS) over {r['matched']} of {r['sampled']} samples — the part is not symmetric about this plane to within {SYMMETRY_MAX_RMS_MM} mm."
    return r


def pose_on_symmetry(axes, origin, plane):
    """The pose with the symmetry plane as one of its coordinate planes: the
    axis nearest its normal turned onto it, the zero point dropped onto it."""
    n0 = normalize(plane["normal"])
    if n0 is None:
        return None
    axes = [np.asarray(a, dtype=float) for a in axes]
    k = 0
    for i in (1, 2):
        if abs(float(axes[i] @ n0)) > abs(float(axes[k] @ n0)):
            k = i
    n = -n0 if float(axes[k] @ n0) < 0 else n0

    def square(v, to):
        return normalize(v - to * float(v @ to))

    if k == 2:
        x = square(axes[0], n)
        out = x is not None and [x, np.cross(n, x), n]
    else:
        z = square(axes[2], n)
        out = z is not None and ([n, np.cross(z, n), z] if k == 0 else [np.cross(n, z), n, z])
    if not out:
        return None
    off = float((np.asarray(origin) - np.asarray(plane["point"])) @ n)
    return {"axes": out, "origin": np.asarray(origin) - n * off, "axis": k, "tiltDeg": math.degrees(math.acos(min(1.0, abs(float(axes[k] @ n0))))), "shiftMm": abs(off)}


def rigid_of_pose(axes, origin):
    """The rigid motion that puts these axes on X, Y, Z and the origin at
    0, 0, 0."""
    R = np.array(axes, dtype=float)
    return R, -R @ np.asarray(origin, dtype=float)
