# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/deviation/rigid.ts,
# src/core/deviation/absoluteOrientation.ts, src/core/deviation/prealign.ts,
# src/core/fit/ransac.ts (mulberry32)
#
# The rigid motion every alignment is held as — a rotation and a translation
# in double precision — with the closed-form pose of picked point pairs
# (Horn's quaternion method, never a mirror image) and the principal-axis
# starting poses of an automatic fit. Pure numpy: no FreeCAD needed.

import math

import numpy as np


class Rigid:
    """p -> R.p + t, R a proper rotation (3x3, row-major), t a 3-vector."""

    __slots__ = ("r", "t")

    def __init__(self, r=None, t=None):
        self.r = np.eye(3) if r is None else np.array(r, dtype=float).reshape(3, 3)
        self.t = np.zeros(3) if t is None else np.array(t, dtype=float).reshape(3)

    def copy(self):
        return Rigid(self.r.copy(), self.t.copy())

    def apply(self, pts):
        """Points (n, 3) or (3,) moved."""
        p = np.asarray(pts, dtype=float)
        return p @ self.r.T + self.t

    def rotate(self, vecs):
        """Directions (n, 3) or (3,) turned, the translation left out."""
        return np.asarray(vecs, dtype=float) @ self.r.T

    def to_json(self, digits=6):
        return {
            "rotation": [[round(float(x), digits) for x in row] for row in self.r],
            "translation": [round(float(x), digits) for x in self.t],
            "angleDeg": round(math.degrees(rotation_angle(self)), 4),
        }


def identity():
    return Rigid()


def from_quaternion(w, x, y, z):
    n = math.sqrt(w * w + x * x + y * y + z * z)
    if not (n > 1e-20):
        return identity()
    w, x, y, z = w / n, x / n, y / n, z / n
    return Rigid(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
            [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
            [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)],
        ]
    )


def from_axis_angle(axis, angle):
    length = math.sqrt(sum(float(a) ** 2 for a in axis))
    if not (length > 1e-20) or not (abs(angle) > 1e-20):
        return identity()
    half = angle / 2
    s = math.sin(half) / length
    return from_quaternion(math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s)


def from_twist(w, t):
    """The rotation whose axis-angle vector is w (|w| = angle), plus t."""
    angle = math.sqrt(float(w[0]) ** 2 + float(w[1]) ** 2 + float(w[2]) ** 2)
    m = from_axis_angle(w, angle) if angle > 1e-20 else identity()
    m.t = np.array(t, dtype=float)
    return m


def compose(a, b):
    """a o b: b first, then a."""
    return Rigid(a.r @ b.r, a.r @ b.t + a.t)


def invert(m):
    r = m.r.T.copy()
    return Rigid(r, -(r @ m.t))


def rotation_angle(m):
    """From atan2(sin, cos), exact near the identity where acos is not."""
    r = m.r
    s = math.hypot(math.hypot(r[2, 1] - r[1, 2], r[0, 2] - r[2, 0]), r[1, 0] - r[0, 1]) / 2
    c = (r[0, 0] + r[1, 1] + r[2, 2] - 1) / 2
    return math.atan2(s, c)


def disagreement(a, b, center, radius):
    """How far apart two transforms place a part, mm: the largest distance
    between a(p) and b(p) over a ball of `radius` about `center`."""
    d = a.r - b.r
    at_center = float(np.linalg.norm(d @ np.asarray(center, dtype=float) + a.t - b.t))
    rel = compose(invert(a), b)
    return at_center + 2 * math.sin(rotation_angle(rel) / 2) * radius


def reorthonormalize(m):
    """Nearest proper rotation by Newton iteration R <- (R + R^-T) / 2."""
    r = m.r.copy()
    for _ in range(12):
        det = np.linalg.det(r)
        if not (abs(det) > 1e-12):
            break
        nxt = 0.5 * (r + np.linalg.inv(r).T)
        delta = float(np.abs(nxt - r).sum())
        r = nxt
        if delta < 1e-15:
            break
    return Rigid(r, m.t.copy())


# ---- absolute orientation (Horn) ----


def absolute_orientation(source, target):
    """Best-fit rigid transform taking source onto target, pair by pair:
    {transform, rms, conditioning} or None for fewer than three pairs.
    conditioning is the ratio of the second to the largest eigenvalue of the
    source points' scatter: 0 when they lie on a line."""
    a = np.asarray(source, dtype=float)
    b = np.asarray(target, dtype=float)
    n = min(len(a), len(b))
    if n < 3:
        return None
    a, b = a[:n], b[:n]
    ca, cb = a.mean(axis=0), b.mean(axis=0)
    A, B = a - ca, b - cb
    S = A.T @ B  # S[i][j] = sum a_i b_j
    sxx, sxy, sxz = S[0]
    syx, syy, syz = S[1]
    szx, szy, szz = S[2]
    N = np.array(
        [
            [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
            [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
            [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
            [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
        ]
    )
    w, v = np.linalg.eigh(N)
    q = v[:, 3]  # largest eigenvalue last
    m = from_quaternion(q[0], q[1], q[2], q[3])
    m.t = cb - m.r @ ca
    moved = m.apply(a)
    rms = math.sqrt(float(((moved - b) ** 2).sum()) / n)
    s = np.linalg.eigvalsh(A.T @ A)
    conditioning = float(s[1] / s[2]) if s[2] > 1e-12 else 0.0
    return {"transform": m, "rms": rms, "conditioning": conditioning}


# ---- principal frames and the 24 starting attitudes ----


def _unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-20 else np.array([0.0, 0.0, 1.0])


def principal_frame(xyz):
    """Centroid, unit axes in descending order of scatter (right-handed), and
    the scatter along each."""
    p = np.asarray(xyz, dtype=float).reshape(-1, 3)
    if len(p) == 0:
        return {"centroid": np.zeros(3), "axes": np.eye(3), "spread": np.zeros(3)}
    c = p.mean(axis=0)
    d = p - c
    cov = (d.T @ d) / len(p)
    w, v = np.linalg.eigh(cov)
    a0 = _unit(v[:, 2])
    a1 = v[:, 1]
    a1 = _unit(a1 - np.dot(a0, a1) * a0)
    a2 = _unit(np.cross(a0, a1))
    return {"centroid": c, "axes": np.array([a0, a1, a2]), "spread": np.sqrt(np.maximum(0, w[::-1]))}


def _frame_to_frame(frm, from_axes, to):
    r = to["axes"].T @ np.asarray(from_axes)
    m = Rigid(r)
    m.t = to["centroid"] - r @ frm["centroid"]
    return m


def prealign_candidates(scan, nominal):
    """The 24 attitudes matching the scan's principal axes to the nominal's:
    which scan axis (and sign) maps to the nominal's first, which to its
    second; the third by right-handedness."""
    signed = []
    for axis in scan["axes"]:
        signed.append(axis)
        signed.append(-axis)
    out = []
    for i in range(6):
        for j in range(6):
            if (i >> 1) == (j >> 1):
                continue
            a0, a1 = signed[i], signed[j]
            out.append(_frame_to_frame(scan, [a0, a1, _unit(np.cross(a0, a1))], nominal))
    return out


# ---- ScanRuler's seeded generator ----


def mulberry32(seed):
    """ScanRuler's small seeded generator, bit for bit (fit/ransac.ts)."""
    state = [seed & 0xFFFFFFFF]

    def imul(a, b):
        return ((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF)) & 0xFFFFFFFF

    def rand():
        a = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        state[0] = a
        t = imul(a ^ (a >> 15), 1 | a)
        t = ((t + imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rand
