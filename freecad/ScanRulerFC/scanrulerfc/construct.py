# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/elements/construct.ts,
# src/core/elements/refs.ts, src/core/geometry/centroid.ts
#
# Constructed elements: built from other elements and typed-in numbers. The
# standard metrology reduction decides what each source stands for — a sphere,
# point, circle or torus is a point; a cylinder, cone, line, circle or torus
# an axis; a plane a plane.

import math

import numpy as np

from .linalg import acute_angle, foot_on_line, normalize, ortho_basis


class ConstructionError(Exception):
    pass


ROLE_PROVIDERS = {
    "point": ("point", "sphere", "circle", "torus"),
    "axis": ("line", "cylinder", "cone", "circle", "torus"),
    "plane": ("plane",),
}


def provides_role(kind, role):
    return kind in ROLE_PROVIDERS[role]


def role_of(kind):
    if kind == "plane":
        return "plane"
    if kind in ("line", "cylinder", "cone", "torus"):
        return "axis"
    return "point"


def slot_takes(slot, kind):
    return any(provides_role(kind, r) for r in slot["roles"]) and (not slot.get("kinds") or kind in slot["kinds"])


EXTENT_MARGIN = 1.3


def ref_point(fit):
    return np.asarray(fit["center"], dtype=float) if fit["kind"] in ("point", "sphere", "circle", "torus") else None


def ref_axis(fit):
    k = fit["kind"]
    c = np.asarray(fit["center"], dtype=float)
    if k in ("cylinder", "cone"):
        return {"origin": c, "dir": np.asarray(fit["axis"], dtype=float), "halfLength": fit["length"] / 2}
    if k == "line":
        return {"origin": c, "dir": np.asarray(fit["dir"], dtype=float), "halfLength": fit["length"] / 2}
    if k == "torus":
        return {"origin": c, "dir": np.asarray(fit["axis"], dtype=float), "halfLength": fit["minorRadius"]}
    if k == "circle":
        return {"origin": c, "dir": np.asarray(fit["normal"], dtype=float), "halfLength": fit["radius"]}
    return None


def ref_plane(fit):
    return fit if fit["kind"] == "plane" else None


def _s(role, label, kinds=None):
    d = {"role": role, "label": label}
    if kinds:
        d["kinds"] = kinds
    return d


def _p(key, label, initial=None, hidden=False):
    d = {"key": key, "label": label}
    if initial is not None:
        d["initial"] = initial
    if hidden:
        d["hidden"] = True
    return d


XYZ = [_p("x", "X"), _p("y", "Y"), _p("z", "Z")]
PXYZ = [_p("px", "Point X"), _p("py", "Point Y"), _p("pz", "Point Z")]

# (id, kind, label, slots, params, surface)
METHODS = [
    ("point-coords", "point", "From coordinates", [], XYZ, False),
    ("point-centroid", "point", "Centroid of the scan", [], [dict(p, hidden=True) for p in XYZ], True),
    ("point-midpoint", "point", "Midpoint of two points", [_s("point", "Point A"), _s("point", "Point B")], [], False),
    ("point-line-plane", "point", "Line–plane intersection", [_s("axis", "Line or cylinder"), _s("plane", "Plane")], [], False),
    ("point-center", "point", "Centre of a feature", [_s("point", "Sphere, circle or torus", ["sphere", "circle", "torus"])], [], False),
    ("point-three-planes", "point", "Three-plane intersection", [_s("plane", "Plane A"), _s("plane", "Plane B"), _s("plane", "Plane C")], [], False),
    ("point-line-line", "point", "Line–line intersection", [_s("axis", "Line or axis A"), _s("axis", "Line or axis B")], [_p("gap", "Max gap", 0.1)], False),
    ("point-project", "point", "Projected onto a plane", [_s("point", "Point"), _s("plane", "Onto plane")], [], False),
    ("line-two-points", "line", "Through two points", [_s("point", "Point A"), _s("point", "Point B")], [], False),
    ("line-axis", "line", "Axis of a feature", [_s("axis", "Cylinder, cone, torus or circle")], [], False),
    ("line-plane-plane", "line", "Plane–plane intersection", [_s("plane", "Plane A"), _s("plane", "Plane B")], [], False),
    ("line-plane-point", "line", "Square to a plane through a point", [_s("plane", "Plane"), _s("point", "Through point")], [], False),
    ("line-project", "line", "Projected onto a plane", [_s("axis", "Line or axis"), _s("plane", "Onto plane")], [], False),
    ("line-coords", "line", "From coordinates", [], [_p("dx", "Direction X"), _p("dy", "Direction Y"), _p("dz", "Direction Z")] + PXYZ + [_p("length", "Length")], False),
    ("plane-three-points", "plane", "Through three points", [_s("point", "Point A"), _s("point", "Point B"), _s("point", "Point C")], [], False),
    ("plane-offset", "plane", "Offset from plane", [_s("plane", "Plane")], [_p("offset", "Offset")], False),
    ("plane-midplane", "plane", "Midplane of two planes", [_s("plane", "Plane A"), _s("plane", "Plane B")], [], False),
    ("plane-offset-point", "plane", "Parallel through a point", [_s("plane", "Parallel to"), _s("point", "Through point")], [], False),
    ("plane-line-point", "plane", "Normal to a line through a point", [_s("axis", "Line or axis"), _s("point", "Through point")], [], False),
    ("plane-angle", "plane", "At an angle about an axis", [_s("axis", "Rotation axis"), _s("plane", "Zero-angle plane")], [_p("angle", "Angle (°)", 0)], False),
    ("plane-line-plane", "plane", "Square to a plane through a line", [_s("axis", "Line it contains"), _s("plane", "Square to plane")], [], False),
    ("plane-two-lines", "plane", "Through two lines", [_s("axis", "Line or axis A"), _s("axis", "Line or axis B")], [_p("gap", "Max gap", 0.1)], False),
    ("plane-tangent-sphere", "plane", "Tangent to a sphere", [_s("point", "Sphere", ["sphere"]), _s("point", "Toward point")], [], False),
    ("plane-tangent-cylinder", "plane", "Tangent to a cylinder", [_s("axis", "Cylinder", ["cylinder"]), _s("point", "Toward point")], [], False),
    ("plane-coords", "plane", "From coordinates", [], [_p("nx", "Normal X"), _p("ny", "Normal Y"), _p("nz", "Normal Z")] + PXYZ, False),
    ("plane-symmetry", "plane", "Symmetry plane of the scan", [], [dict(p, hidden=True) for p in [_p("nx", "Normal X"), _p("ny", "Normal Y"), _p("nz", "Normal Z")] + PXYZ + [_p("rms", "Mirror RMS"), _p("matched", "Matched samples"), _p("sampled", "Samples")]], True),
    ("circle-plane-cylinder", "circle", "Plane–cylinder intersection", [_s("plane", "Plane"), _s("axis", "Cylinder", ["cylinder"])], [], False),
    ("circle-plane-sphere", "circle", "Plane–sphere intersection", [_s("plane", "Plane"), _s("point", "Sphere", ["sphere"])], [], False),
    ("circle-coords", "circle", "From coordinates", [], [_p("d", "Diameter"), _p("nx", "Normal X"), _p("ny", "Normal Y"), _p("nz", "Normal Z"), _p("cx", "Center X"), _p("cy", "Center Y"), _p("cz", "Center Z")], False),
]
CREATION_METHODS = [{"id": m[0], "kind": m[1], "label": m[2], "slots": m[3], "params": m[4], "surface": m[5]} for m in METHODS]


def methods_for_kind(kind):
    return [m for m in CREATION_METHODS if m["kind"] == kind]


NO_FIT_STATS = {"sigma": 0.0, "usedPoints": 0, "regionSize": 0}
INTERSECT_MIN_ANGLE = 0.2
SECTION_MAX_TILT = 5


def _plane_at(center, normal, fallback):
    u, v = ortho_basis(normal)
    ext = max(fallback * 0.3, 1)
    return dict(kind="plane", center=np.asarray(center, dtype=float), normal=np.asarray(normal, dtype=float), basisU=u, basisV=v, extentU=ext, extentV=ext, **NO_FIT_STATS)


def _need(v, what):
    if v is None:
        raise ConstructionError(f"Missing {what}.")
    return v


def _point_of(fit, label):
    return _need(ref_point(fit), f"a point from {label}")


def _onto_plane(p, pl):
    n = np.asarray(pl["normal"], dtype=float)
    return p - n * float((p - np.asarray(pl["center"])) @ n)


def _rotate_about(v, axis, angle):
    c, s = math.cos(angle), math.sin(angle)
    return v * c + np.cross(axis, v) * s + axis * float(axis @ v) * (1 - c)


def _plane_through_axis(axis, normal, near, fallback):
    center = foot_on_line(near, axis["origin"], axis["dir"])
    ext = max(fallback * 0.3, 1)
    return dict(kind="plane", center=center, normal=normal, basisU=axis["dir"], basisV=np.cross(normal, axis["dir"]), extentU=max(axis["halfLength"], ext), extentV=ext, **NO_FIT_STATS)


def _mid(a, b):
    return (np.asarray(a) + np.asarray(b)) / 2


def _nearest_approach(fa, fb, max_gap):
    a = _need(ref_axis(fa), "line or axis A")
    b = _need(ref_axis(fb), "line or axis B")
    if acute_angle(a["dir"], b["dir"]) < INTERSECT_MIN_ANGLE:
        return {"parallel": True, "a": a, "b": b}
    if not max_gap >= 0:
        raise ConstructionError("Enter the largest gap the two lines may pass apart and still be taken to cross.")
    w = a["origin"] - b["origin"]
    ab = float(a["dir"] @ b["dir"])
    d = float(a["dir"] @ w)
    e = float(b["dir"] @ w)
    den = 1 - ab * ab
    on_a = a["origin"] + a["dir"] * ((ab * e - d) / den)
    on_b = b["origin"] + b["dir"] * ((e - ab * d) / den)
    if np.linalg.norm(on_a - on_b) > max_gap:
        raise ConstructionError("The lines are skew: at their nearest they pass further apart than Max gap, so they do not cross. Raise Max gap to take the middle of that nearest approach, or check the two references.")
    return {"a": a, "b": b, "onA": on_a, "onB": on_b}


def _pt(c):
    return dict(kind="point", center=np.asarray(c, dtype=float), **NO_FIT_STATS)


def _ln(c, d, length):
    return dict(kind="line", center=np.asarray(c, dtype=float), dir=np.asarray(d, dtype=float), length=float(length), **NO_FIT_STATS)


def _fin(*xs):
    return all(x is not None and math.isfinite(x) for x in xs)


def evaluate_construction(method, refs, params, fallback):
    """The geometry of a constructed element from its sources' geometry and
    its numbers. Raises ConstructionError on degenerate input."""
    p = list(params) + [None] * 10
    if method in ("point-coords", "point-centroid"):
        if not _fin(p[0], p[1], p[2]):
            raise ConstructionError("The centroid has not been measured yet." if method == "point-centroid" else "Enter all three coordinates.")
        return _pt(p[:3])
    if method == "point-midpoint":
        return _pt(_mid(_point_of(refs[0], "point A"), _point_of(refs[1], "point B")))
    if method == "point-line-plane":
        axis = _need(ref_axis(refs[0]), "a line or cylinder axis")
        pl = _need(ref_plane(refs[1]), "the plane")
        n = np.asarray(pl["normal"])
        if 90 - acute_angle(axis["dir"], n) < INTERSECT_MIN_ANGLE:
            raise ConstructionError("The line runs parallel to the plane — they never meet.")
        t = float((np.asarray(pl["center"]) - axis["origin"]) @ n) / float(axis["dir"] @ n)
        return _pt(axis["origin"] + axis["dir"] * t)
    if method == "line-two-points":
        a, b = _point_of(refs[0], "point A"), _point_of(refs[1], "point B")
        d = normalize(b - a)
        if d is None:
            raise ConstructionError("The two points coincide — no line direction.")
        return _ln(_mid(a, b), d, np.linalg.norm(b - a))
    if method == "line-axis":
        axis = _need(ref_axis(refs[0]), "an axis from the cylinder")
        return _ln(axis["origin"], axis["dir"], max(axis["halfLength"] * 2, fallback * 0.1))
    if method == "line-plane-plane":
        pa, pb = _need(ref_plane(refs[0]), "plane A"), _need(ref_plane(refs[1]), "plane B")
        na, nb = np.asarray(pa["normal"]), np.asarray(pb["normal"])
        if acute_angle(na, nb) < INTERSECT_MIN_ANGLE:
            raise ConstructionError("The planes are parallel — they have no intersection line.")
        raw = np.cross(na, nb)
        d = normalize(raw)
        da, db = float(na @ pa["center"]), float(nb @ pb["center"])
        pt = (np.cross(nb, raw) * da + np.cross(raw, na) * db) / float(raw @ raw)
        anchor = foot_on_line(_mid(pa["center"], pb["center"]), pt, d)
        length = max(max(pa["extentU"], pa["extentV"], pb["extentU"], pb["extentV"]) * 2, fallback * 0.05)
        return _ln(anchor, d, length)
    if method == "plane-three-points":
        a, b, c = (_point_of(refs[i], f"point {'ABC'[i]}") for i in range(3))
        ab, ac = b - a, c - a
        raw = np.cross(ab, ac)
        span = max(np.linalg.norm(ab), np.linalg.norm(ac))
        if span < 1e-9 or np.linalg.norm(raw) < 1e-6 * span * span:
            raise ConstructionError("The three points are collinear — they do not span a plane.")
        n = normalize(raw)
        ctr = (a + b + c) / 3
        bu = normalize(ab)
        bv = np.cross(n, bu)
        eu = max(abs(float((q - ctr) @ bu)) for q in (a, b, c))
        ev = max(abs(float((q - ctr) @ bv)) for q in (a, b, c))
        pad = max(eu, ev) * 0.15
        return dict(kind="plane", center=ctr, normal=n, basisU=bu, basisV=bv, extentU=eu + pad, extentV=ev + pad, **NO_FIT_STATS)
    if method == "plane-offset":
        pl = _need(ref_plane(refs[0]), "the source plane")
        if not _fin(p[0]):
            raise ConstructionError("Enter the offset distance.")
        return dict(pl, **NO_FIT_STATS, center=np.asarray(pl["center"]) + np.asarray(pl["normal"]) * p[0])
    if method == "plane-midplane":
        pa, pb = _need(ref_plane(refs[0]), "plane A"), _need(ref_plane(refs[1]), "plane B")
        na, nb = np.asarray(pa["normal"], dtype=float), np.asarray(pb["normal"], dtype=float)
        if 90 - acute_angle(na, nb) < INTERSECT_MIN_ANGLE:
            raise ConstructionError("The planes are perpendicular — no midplane between them.")
        if na @ nb < 0:
            nb = -nb
        sm = na + nb
        n = normalize(sm)
        m = _mid(pa["center"], pb["center"])
        off = (float(sm @ m) - float(na @ pa["center"]) - float(nb @ pb["center"])) / float(np.linalg.norm(sm))
        ctr = m - n * off
        u = normalize(np.asarray(pa["basisU"]) - n * float(np.asarray(pa["basisU"]) @ n))
        bu = u if u is not None else ortho_basis(n)[0]
        return dict(kind="plane", center=ctr, normal=n, basisU=bu, basisV=np.cross(n, bu), extentU=max(pa["extentU"], pb["extentU"]), extentV=max(pa["extentV"], pb["extentV"]), **NO_FIT_STATS)
    if method == "point-center":
        return _pt(_point_of(refs[0], "the feature"))
    if method == "point-three-planes":
        a, b, c = (_need(ref_plane(refs[i]), f"plane {'ABC'[i]}") for i in range(3))
        for x, y, nx, ny in ((a, b, "A", "B"), (a, c, "A", "C"), (b, c, "B", "C")):
            if acute_angle(x["normal"], y["normal"]) < INTERSECT_MIN_ANGLE:
                raise ConstructionError(f"Planes {nx} and {ny} are parallel — the three meet in no point.")
        A, B, C = (np.asarray(q["normal"], dtype=float) for q in (a, b, c))
        bc = np.cross(B, C)
        det = float(A @ bc)
        if abs(det) < math.sin(math.radians(INTERSECT_MIN_ANGLE)):
            raise ConstructionError("The three planes share a line — they meet along it, not at a point.")
        da, db, dc = (float(np.asarray(q["normal"]) @ np.asarray(q["center"])) for q in (a, b, c))
        return _pt((bc * da + np.cross(C, A) * db + np.cross(A, B) * dc) / det)
    if method == "point-line-line":
        near = _nearest_approach(refs[0], refs[1], p[0] if p[0] is not None else 0.1)
        if near.get("parallel"):
            raise ConstructionError("The lines run parallel — they never cross.")
        return _pt(_mid(near["onA"], near["onB"]))
    if method == "point-project":
        return _pt(_onto_plane(_point_of(refs[0], "the point"), _need(ref_plane(refs[1]), "the plane")))
    if method == "line-plane-point":
        pl = _need(ref_plane(refs[0]), "the plane")
        pt = _point_of(refs[1], "the point")
        foot = _onto_plane(pt, pl)
        return _ln(_mid(pt, foot), pl["normal"], max(np.linalg.norm(pt - foot) * 1.2, fallback * 0.1))
    if method == "line-project":
        axis = _need(ref_axis(refs[0]), "a line or an axis")
        pl = _need(ref_plane(refs[1]), "the plane")
        n = np.asarray(pl["normal"])
        along = axis["dir"] - n * float(axis["dir"] @ n)
        if np.linalg.norm(along) < math.sin(math.radians(INTERSECT_MIN_ANGLE)):
            raise ConstructionError("The line stands square to the plane — it projects to a single point: Line–plane intersection gives that point.")
        return _ln(_onto_plane(axis["origin"], pl), normalize(along), max(axis["halfLength"] * 2 * np.linalg.norm(along), fallback * 0.1))
    if method == "line-coords":
        dx, dy, dz, px, py, pz, length = p[:7]
        if not _fin(dx, dy, dz, px, py, pz):
            raise ConstructionError("Enter the direction and a point on the line.")
        d = normalize([dx, dy, dz])
        if d is None:
            raise ConstructionError("The direction must not be zero.")
        return _ln([px, py, pz], d, length if (_fin(length) and length > 0) else fallback * 0.3)
    if method == "plane-offset-point":
        pl = _need(ref_plane(refs[0]), "the plane")
        pt = _point_of(refs[1], "the point")
        n = np.asarray(pl["normal"])
        return dict(pl, **NO_FIT_STATS, center=np.asarray(pl["center"]) + n * float((pt - pl["center"]) @ n))
    if method == "plane-line-point":
        axis = _need(ref_axis(refs[0]), "a line or an axis")
        return _plane_at(_point_of(refs[1], "the point"), axis["dir"], fallback)
    if method == "plane-angle":
        axis = _need(ref_axis(refs[0]), "the rotation axis")
        pl = _need(ref_plane(refs[1]), "the zero-angle plane")
        if not _fin(p[0]):
            raise ConstructionError("Enter the angle.")
        n = np.asarray(pl["normal"], dtype=float)
        zero = normalize(n - axis["dir"] * float(n @ axis["dir"]))
        if zero is None or acute_angle(axis["dir"], n) < INTERSECT_MIN_ANGLE:
            raise ConstructionError("The axis stands square to the zero-angle plane — every plane through it is square to that plane, so none is at 0°. Pick a plane the axis does not pierce square.")
        return _plane_through_axis(axis, _rotate_about(zero, axis["dir"], math.radians(p[0])), pl["center"], fallback)
    if method == "plane-line-plane":
        axis = _need(ref_axis(refs[0]), "the line")
        pl = _need(ref_plane(refs[1]), "the plane")
        n = normalize(np.cross(axis["dir"], pl["normal"]))
        if n is None or acute_angle(axis["dir"], pl["normal"]) < INTERSECT_MIN_ANGLE:
            raise ConstructionError("The line stands square to the plane — every plane through it is square to the plane. At an angle about an axis picks one.")
        return _plane_through_axis(axis, n, pl["center"], fallback)
    if method == "plane-two-lines":
        near = _nearest_approach(refs[0], refs[1], p[0] if p[0] is not None else 0.1)
        a, b = near["a"], near["b"]
        if near.get("parallel"):
            across = b["origin"] - a["origin"]
            off = across - a["dir"] * float(across @ a["dir"])
            n = normalize(np.cross(a["dir"], off))
            if n is None or np.linalg.norm(off) < 1e-6 * max(1, fallback):
                raise ConstructionError("The two lines are one — they do not fix a plane.")
            return _plane_through_axis(a, n, _mid(a["origin"], b["origin"]), fallback)
        n = normalize(np.cross(a["dir"], b["dir"]))
        m = _mid(near["onA"], near["onB"])
        return _plane_through_axis(dict(a, origin=m), n, m, fallback)
    if method == "plane-tangent-sphere":
        sph = refs[0]
        if sph["kind"] != "sphere":
            raise ConstructionError("Missing the sphere.")
        c = np.asarray(sph["center"], dtype=float)
        toward = normalize(_point_of(refs[1], "the point") - c)
        if toward is None:
            raise ConstructionError("The point is the sphere’s centre — it faces no side.")
        return _plane_at(c + toward * sph["radius"], toward, max(fallback, sph["radius"] * 2))
    if method == "plane-tangent-cylinder":
        cyl = refs[0]
        if cyl["kind"] != "cylinder":
            raise ConstructionError("Missing the cylinder.")
        pt = _point_of(refs[1], "the point")
        foot = foot_on_line(pt, cyl["center"], cyl["axis"])
        toward = normalize(pt - foot)
        if toward is None:
            raise ConstructionError("The point lies on the cylinder’s axis — it faces no side.")
        axis = {"origin": np.asarray(cyl["center"]) + toward * cyl["radius"], "dir": np.asarray(cyl["axis"], dtype=float), "halfLength": cyl["length"] / 2}
        return _plane_through_axis(axis, toward, foot + toward * cyl["radius"], fallback)
    if method == "plane-coords":
        nx, ny, nz, px, py, pz = p[:6]
        if not _fin(nx, ny, nz, px, py, pz):
            raise ConstructionError("Enter the normal direction and a point on the plane.")
        n = normalize([nx, ny, nz])
        if n is None:
            raise ConstructionError("The normal direction must not be zero.")
        return _plane_at([px, py, pz], n, fallback)
    if method == "plane-symmetry":
        nx, ny, nz, px, py, pz, rms, matched, sampled = p[:9]
        if not _fin(nx, ny, nz, px, py, pz):
            raise ConstructionError("Find the symmetry plane first.")
        n = normalize([nx, ny, nz])
        if n is None:
            raise ConstructionError("The symmetry plane has no direction.")
        out = _plane_at([px, py, pz], n, fallback)
        out.update(sigma=rms if _fin(rms) else 0.0, usedPoints=int(matched) if _fin(matched) else 0, regionSize=int(sampled) if _fin(sampled) else 0)
        return out
    if method == "circle-plane-cylinder":
        pl = _need(ref_plane(refs[0]), "the plane")
        cyl = refs[1]
        if cyl["kind"] != "cylinder":
            raise ConstructionError("The second reference must be a cylinder.")
        n = np.asarray(pl["normal"], dtype=float)
        tilt = acute_angle(cyl["axis"], n)
        if 90 - tilt < INTERSECT_MIN_ANGLE:
            raise ConstructionError("The cylinder runs parallel to the plane — they never meet.")
        if tilt > SECTION_MAX_TILT:
            raise ConstructionError(f"The cylinder leans {tilt:.1f}° against the plane — the section is an ellipse, not a circle.")
        a = np.asarray(cyl["axis"], dtype=float)
        t = float((np.asarray(pl["center"]) - cyl["center"]) @ n) / float(a @ n)
        return dict(kind="circle", center=np.asarray(cyl["center"]) + a * t, normal=n, radius=cyl["radius"], **NO_FIT_STATS)
    if method == "circle-plane-sphere":
        pl = _need(ref_plane(refs[0]), "the plane")
        sph = refs[1]
        if sph["kind"] != "sphere":
            raise ConstructionError("The second reference must be a sphere.")
        n = np.asarray(pl["normal"], dtype=float)
        d = float((np.asarray(sph["center"]) - pl["center"]) @ n)
        if abs(d) >= sph["radius"]:
            raise ConstructionError("The plane only touches the sphere — the circle would have no size." if abs(d) - sph["radius"] < sph["radius"] * 1e-6 else "The plane misses the sphere — there is no intersection.")
        return dict(kind="circle", center=np.asarray(sph["center"]) - n * d, normal=n, radius=math.sqrt(sph["radius"] ** 2 - d * d), **NO_FIT_STATS)
    if method == "circle-coords":
        d, nx, ny, nz, cx, cy, cz = p[:7]
        if not _fin(d, nx, ny, nz, cx, cy, cz):
            raise ConstructionError("Enter the diameter, the normal direction and the center.")
        if not d > 0:
            raise ConstructionError("The diameter must be positive.")
        n = normalize([nx, ny, nz])
        if n is None:
            raise ConstructionError("The normal direction must not be zero.")
        return dict(kind="circle", center=np.array([cx, cy, cz], dtype=float), normal=n, radius=d / 2, **NO_FIT_STATS)
    raise ConstructionError(f'Unknown construction "{method}".')


def scan_centroid(P, F, selection=None):
    """The centre of the volume a closed scan encloses; an open one gets the
    centre of its surface, and says so; a marking the mean of its points."""
    if selection is not None:
        return P[np.asarray(selection)].mean(axis=0), "the centre of the marked surface"
    t = P[F]
    c0 = P.mean(axis=0)
    a, b, c = t[:, 0] - c0, t[:, 1] - c0, t[:, 2] - c0
    v6 = np.einsum("ij,ij->i", a, np.cross(b, c))
    vol6 = float(v6.sum())
    area = np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)
    lo, hi = P.min(axis=0), P.max(axis=0)
    # A closed edge-manifold mesh has every edge used twice.
    e = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), axis=1)
    _, cnt = np.unique(e, axis=0, return_counts=True)
    closed = bool(np.all(cnt == 2))
    if closed and abs(vol6) > 1e-9 * float(np.prod(hi - lo) or 1):
        cen = ((a + b + c) / 4 * v6[:, None]).sum(axis=0) / vol6 + c0
        return cen, None
    cen = (t.mean(axis=1) * area[:, None]).sum(axis=0) / area.sum()
    return cen, "The scan is open, so this is the centre of its surface, not of a volume."
