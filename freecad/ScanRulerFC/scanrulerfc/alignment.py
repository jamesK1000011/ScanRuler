# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/alignment.ts,
# src/core/deviation/rigid.ts (as much as alignment needs),
# src/core/scanScale.ts
#
# Datum alignment: carry the part into the global coordinate system using
# measured elements as datums — the 3-2-1 / plane-line-point workflow of CMM
# software — and the scale a scan without a true size is given from lengths
# known on the real part.

import math

import numpy as np

from .construct import ConstructionError, evaluate_construction
from .linalg import acute_angle, normalize, ortho_basis


class AlignmentError(Exception):
    pass


ALIGN_PICK_COUNT = {"primary": 3, "secondary": 2, "origin": 1}
AXES = ("x+", "x-", "y+", "y-", "z+", "z-")
MIN_CLOCK_ANGLE = 0.2


def identity():
    return np.eye(3), np.zeros(3)


def apply(rig, X):
    R, t = rig
    return np.asarray(X, dtype=float) @ R.T + t


def compose(a, b):
    """a after b."""
    return a[0] @ b[0], a[0] @ b[1] + a[1]


def inverse(rig):
    R, t = rig
    return R.T, -R.T @ t


def axis_index(a):
    return "xyz".index(a[0])


def axis_vector(a):
    v = np.zeros(3)
    v[axis_index(a)] = 1 if a[1] == "+" else -1
    return v


def _datum_direction(fit):
    k = fit["kind"]
    if k in ("plane", "circle"):
        return np.asarray(fit["normal"], dtype=float)
    if k == "line":
        return np.asarray(fit["dir"], dtype=float)
    if k in ("cylinder", "cone"):
        return np.asarray(fit["axis"], dtype=float)
    return None


def _rot_axis_angle(axis, angle):
    x, y, z = normalize(axis)
    c, s = math.cos(angle), math.sin(angle)
    t = 1 - c
    return np.array([[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]])


def _reorthonormalize(R):
    u, _s, vt = np.linalg.svd(R)
    out = u @ vt
    if np.linalg.det(out) < 0:
        u[:, -1] *= -1
        out = u @ vt
    return out


def fit_from_picks(slot, picks, model_size, towards=None):
    """The stand-in geometry for a slot filled with points: a plane through
    three (turned to face the way the scan does there), a line through two,
    the point itself."""
    pts = [{"kind": "point", "center": np.asarray(p, dtype=float), "sigma": 0, "usedPoints": 0, "regionSize": 0} for p in picks]
    try:
        if slot == "primary":
            plane = evaluate_construction("plane-three-points", pts, [], model_size)
            out = np.sum(np.asarray(towards), axis=0) if towards else np.zeros(3)
            if float(np.asarray(plane["normal"]) @ out) >= 0:
                return plane
            return dict(plane, normal=-np.asarray(plane["normal"]), basisV=-np.asarray(plane["basisV"]))
        if slot == "secondary":
            return evaluate_construction("line-two-points", pts, [], model_size)
        return pts[0]
    except ConstructionError:
        raise AlignmentError("The three picked points lie on a line — spread them out." if slot == "primary" else "The two picked points coincide — pick them further apart.")


def datum_alignment(primary, secondary=None, origin=None, center_of=None):
    """The rigid transform that carries the part into the system the datums
    define. primary/secondary: {fit, axis}; origin: a fit with a centre."""
    d1raw = _datum_direction(primary["fit"])
    if d1raw is None:
        raise AlignmentError("Levelling needs a direction — use a plane, cylinder, line, or three picked points.")
    d1 = normalize(d1raw)
    e1 = axis_vector(primary["axis"])
    if secondary:
        d2raw = _datum_direction(secondary["fit"])
        if d2raw is None:
            raise AlignmentError("The rotation step needs a direction — use a plane, cylinder, line, or two picked points.")
        if axis_index(secondary["axis"]) == axis_index(primary["axis"]):
            raise AlignmentError("Levelling and rotation cannot use the same axis.")
        if acute_angle(d1, d2raw) < MIN_CLOCK_ANGLE:
            raise AlignmentError("These two directions are parallel — they cannot set the rotation. Use a different element or points.")
        d2 = normalize(d2raw - d1 * float(d2raw @ d1))
        e2 = axis_vector(secondary["axis"])
        R = np.outer(e1, d1) + np.outer(e2, d2) + np.outer(np.cross(e1, e2), np.cross(d1, d2))
    else:
        ax = np.cross(d1, e1)
        sn = float(np.linalg.norm(ax))
        cs = float(d1 @ e1)
        if sn < 1e-12:
            R = _rot_axis_angle(ortho_basis(d1)[0], math.pi) if cs < 0 else np.eye(3)
        else:
            R = _rot_axis_angle(ax, math.atan2(sn, cs))
    R = _reorthonormalize(R)
    c1 = np.asarray(primary["fit"]["center"], dtype=float)
    t = c1 - R @ c1
    constrained = set()

    def zero_at(anchor, coords):
        out = R @ np.asarray(anchor, dtype=float) + t
        for k in coords:
            if k in constrained:
                continue
            t[k] -= out[k]
            constrained.add(k)

    def coords_of(spec):
        k = axis_index(spec["axis"])
        return [k] if spec["fit"]["kind"] == "plane" else [i for i in range(3) if i != k]

    zero_at(c1, coords_of(primary))
    if secondary:
        zero_at(secondary["fit"]["center"], coords_of(secondary))
    if origin is not None:
        zero_at(origin["center"], [0, 1, 2])
    if center_of is not None:
        zero_at(center_of, [0, 1, 2])
    return R, t


def translation_to_origin(point):
    return np.eye(3), -np.asarray(point, dtype=float)


def transform_fit(fit, rig):
    """The same element geometry carried through a rigid transform."""
    R, t = rig
    out = dict(fit)

    def mv(p):
        return R @ np.asarray(p, dtype=float) + t

    def md(d):
        v = R @ np.asarray(d, dtype=float)
        n = normalize(v)
        return n if n is not None else v

    out["center"] = mv(fit["center"])
    for key in ("dir", "axis", "normal", "basisU", "basisV"):
        if key in fit:
            out[key] = md(fit[key])
    return out


def rigid_json(rig):
    if rig is None:
        return None
    R, t = rig
    ang = math.degrees(math.acos(max(-1.0, min(1.0, (np.trace(R) - 1) / 2))))
    return {"rotation": [[round(float(x), 6) for x in row] for row in R], "translation": [round(float(x), 4) for x in t], "rotationDeg": round(ang, 4), "moveMm": round(float(np.linalg.norm(t)), 4)}


# ---- parallel face (the note align.datum gives) -----------------------------

PARALLEL_REACH = 5
PARALLEL_BAND = 0.3
PARALLEL_BAND_MIN = 0.1


def parallel_face_near(points, center, normal):
    n = normalize(normal)
    if n is None:
        return None
    d = (np.asarray(points) - np.asarray(center)) @ n
    ds = d[np.abs(d) <= PARALLEL_REACH]
    near = np.sort(np.abs(ds[np.abs(ds) <= PARALLEL_BAND]))
    if len(near) == 0:
        return None
    band = min(PARALLEL_BAND, max(PARALLEL_BAND_MIN, 3 * 1.4826 * near[len(near) // 2]))
    own = int((np.abs(ds) <= band).sum())
    offs = np.sort(ds[np.abs(ds) > band])
    best = (0, 0, 0)
    hi = 0
    for lo in range(len(offs)):
        while hi < len(offs) and offs[hi] - offs[lo] <= 2 * band:
            hi += 1
        if hi - lo > best[0]:
            best = (hi - lo, lo, hi)
    if own == 0 or best[0] < 20 or best[0] < 1.5 * own:
        return None
    return {"offset": float(offs[best[1]:best[2]].mean()), "times": best[0] / own}


# ---- scale ------------------------------------------------------------------

SCALE_MIN = 1e-6
SCALE_MAX = 1e6


def factor_problem(f):
    if not math.isfinite(f) or f <= 0:
        return "The factor must be a positive number."
    if f < SCALE_MIN or f > SCALE_MAX:
        return f"A factor of {f} is out of reach — it must lie between {SCALE_MIN} and {SCALE_MAX}."
    if f == 1:
        return "A factor of 1 leaves the scan as it is."
    return None


def combine_references(refs):
    """One factor from several references, averaged by length on the log
    scale; each with its own factor and how far it is off the combined one."""
    if not refs:
        raise ValueError("Give at least one reference length.")
    for r in refs:
        if not math.isfinite(r["measured"]) or r["measured"] <= 0:
            raise ValueError(f"{r['label']} has no length on the scan to scale from.")
        if not math.isfinite(r["true"]) or r["true"] <= 0:
            raise ValueError(f"{r['label']} needs its true length — a positive number.")
    s = sum(r["true"] * math.log(r["true"] / r["measured"]) for r in refs)
    w = sum(r["true"] for r in refs)
    factor = math.exp(s / w)
    weighed = [dict(r, factor=r["true"] / r["measured"], off=(r["true"] / r["measured"]) / factor - 1) for r in refs]
    return {"factor": factor, "references": weighed, "spread": max([0.0] + [abs(r["off"]) for r in weighed])}


LENGTH_KEYS = ("radius", "length", "radius1", "radius2", "majorRadius", "minorRadius", "extentU", "extentV", "sigma", "formError", "residualMin", "residualMax")


def scale_fit(fit, s):
    out = dict(fit)
    out["center"] = np.asarray(fit["center"], dtype=float) * s
    for k in LENGTH_KEYS:
        if fit.get(k) is not None:
            out[k] = fit[k] * s
    if fit.get("held"):
        out["held"] = {"freeDiameter": fit["held"]["freeDiameter"] * s, "shift": fit["held"]["shift"] * s}
    return out


def scale_params(method, p, s):
    def times(a, b):
        return [v * s if a <= i < b else v for i, v in enumerate(p)]

    if method in ("point-coords", "point-centroid"):
        return times(0, 3)
    if method == "plane-offset":
        return times(0, 1)
    if method == "plane-coords":
        return times(3, 6)
    if method == "plane-symmetry":
        return times(3, 7)
    if method == "circle-coords":
        return [v * s if (i == 0 or i >= 4) else v for i, v in enumerate(p)]
    return list(p)
