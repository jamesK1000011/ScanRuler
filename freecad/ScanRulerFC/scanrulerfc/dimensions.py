# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/core/dimensions.ts,
# src/core/tolerances.ts, src/core/units.ts (fmtLen, mm only),
# src/core/elements/assumed.ts (hasDiameter)
#
# Dimensions between elements and GD&T-like tolerances on them, each a value
# recomputed from the elements' geometry, held to a limit for a verdict.
# Everything in millimetres and degrees.

import math

import numpy as np

from .construct import EXTENT_MARGIN, ref_axis, ref_plane, ref_point, role_of, slot_takes
from .linalg import acute_angle, angle_between, closest_between_lines, foot_on_line, normalize, ortho_basis, param_on_line


def _sl(roles, label, kinds=None):
    d = {"roles": roles, "label": label}
    if kinds:
        d["kinds"] = kinds
    return d


def _t(id_, family, group, label, stem, unit, slots):
    return {"id": id_, "family": family, "group": group, "label": label, "stem": stem, "unit": unit, "slots": slots}


DIMENSIONS = [
    _t("dist-point-point", "dimension", "distance", "Point – Point", "Distance", "mm", [_sl(["point"], "From"), _sl(["point"], "To")]),
    _t("dist-point-axis", "dimension", "distance", "Point – Axis", "Distance", "mm", [_sl(["point"], "Point"), _sl(["axis"], "Axis")]),
    _t("dist-point-plane", "dimension", "distance", "Point – Plane", "Distance", "mm", [_sl(["point"], "Point"), _sl(["plane"], "Plane")]),
    _t("dist-axis-axis", "dimension", "distance", "Axis – Axis", "Distance", "mm", [_sl(["axis"], "Axis A"), _sl(["axis"], "Axis B")]),
    _t("dist-axis-plane", "dimension", "distance", "Axis – Plane", "Distance", "mm", [_sl(["axis"], "Axis"), _sl(["plane"], "Plane")]),
    _t("dist-plane-plane", "dimension", "distance", "Plane – Plane", "Distance", "mm", [_sl(["plane"], "From"), _sl(["plane"], "To")]),
    _t("angle-axis-axis", "dimension", "angle", "Axis – Axis", "Angle", "°", [_sl(["axis"], "Axis A"), _sl(["axis"], "Axis B")]),
    _t("angle-axis-plane", "dimension", "angle", "Axis – Plane", "Angle", "°", [_sl(["axis"], "Axis"), _sl(["plane"], "Plane")]),
    _t("angle-plane-plane", "dimension", "angle", "Plane – Plane", "Angle", "°", [_sl(["plane"], "Plane A"), _sl(["plane"], "Plane B")]),
    _t("size-diameter", "dimension", "size", "Diameter", "Diameter", "mm", [_sl(["point", "axis"], "Feature", ["sphere", "cylinder", "circle"])]),
]
TOLERANCE_TYPES = [
    _t("form-flatness", "tolerance", "form", "Flatness", "Flatness", "mm", [_sl(["plane"], "Plane")]),
    _t("form-cylindricity", "tolerance", "form", "Cylindricity", "Cylindricity", "mm", [_sl(["axis"], "Cylinder", ["cylinder"])]),
    _t("form-circularity", "tolerance", "form", "Circularity", "Circularity", "mm", [_sl(["point"], "Circle", ["circle"])]),
    _t("form-sphericity", "tolerance", "form", "Sphericity", "Sphericity", "mm", [_sl(["point"], "Sphere", ["sphere"])]),
    _t("orient-parallelism", "tolerance", "orientation", "Parallelism", "Parallelism", "mm", [_sl(["plane", "axis"], "Feature"), _sl(["plane", "axis"], "Datum")]),
    _t("orient-perpendicularity", "tolerance", "orientation", "Perpendicularity", "Perpendicularity", "mm", [_sl(["plane", "axis"], "Feature"), _sl(["plane", "axis"], "Datum")]),
    _t("orient-angularity", "tolerance", "orientation", "Angularity", "Angularity", "mm", [_sl(["plane", "axis"], "Feature"), _sl(["plane", "axis"], "Datum")]),
    _t("loc-coaxiality", "tolerance", "location", "Coaxiality", "Coaxiality", "mm", [_sl(["axis", "point"], "Feature", ["cylinder", "cone", "line", "sphere", "circle"]), _sl(["axis"], "Datum axis")]),
]
TYPES = DIMENSIONS + TOLERANCE_TYPES


def type_info(id_):
    for t in TYPES:
        if t["id"] == id_:
            return t
    raise ValueError(f'Unknown dimension type "{id_}".')


def has_diameter(fit):
    return fit["kind"] in ("sphere", "cylinder", "circle")


def _seat(info, kinds):
    if len(kinds) > len(info["slots"]):
        return None
    taken = [False] * len(info["slots"])
    seats = [0] * len(kinds)

    def place(i):
        if i == len(kinds):
            return True
        k = kinds[i]
        pref = role_of(k)
        order = [s for s, slot in enumerate(info["slots"]) if not taken[s] and slot_takes(slot, k)]
        order.sort(key=lambda s: -int(pref in info["slots"][s]["roles"]))
        for s in order:
            taken[s] = True
            seats[i] = s
            if place(i + 1):
                return True
            taken[s] = False
        return False

    return seats if place(0) else None


def resolve_type(current, kinds):
    cur = type_info(current)
    if _seat(cur, kinds):
        return current
    cands = [t for t in TYPES if t["family"] == cur["family"] and _seat(t, kinds) is not None]
    if not cands:
        return current
    pool = [t for t in cands if t["group"] == cur["group"]] or cands
    homo = next((t for t in pool if all(slot_takes(s, kinds[0]) for s in t["slots"])), None) if len(kinds) == 1 else None
    return (homo or pool[0])["id"]


def assign_refs(type_id, selected):
    """selected: [(id, kind)] in pick order → refs by slot (None for empty)."""
    info = type_info(type_id)
    refs = [None] * len(info["slots"])
    seats = _seat(info, [k for _, k in selected])
    if seats:
        for i, s in enumerate(seats):
            refs[s] = selected[i][0]
        return refs
    for eid, kind in selected:
        for s, slot in enumerate(info["slots"]):
            if refs[s] is None and slot_takes(slot, kind):
                refs[s] = eid
                break
    return refs


# ---- limits and verdicts ----------------------------------------------------


def mm(v):
    return f"{v:.3f} mm"


def _in_unit(v, unit):
    return f"{v:.2f}°" if unit == "°" else mm(v)


def _signed(v, unit):
    return ("+" if v >= 0 else "") + _in_unit(v, unit)


def judge_limit(raw, limit, unit):
    half = (0.01 if unit == "°" else 10 ** -3) / 2

    def past(x):
        return 0.0 if abs(x) < half else x

    if limit["kind"] == "max":
        dev = raw - limit["max"]
        over = past(max(0.0, dev))
        v = {"deviation": dev, "over": over, "pass": over == 0, "allowance": f"limit {_in_unit(limit['max'], unit)}", "delta": f"Δ {_signed(dev, unit)}"}
        if over > 0:
            v["alarm"] = f"{_in_unit(over, unit)} over the limit"
        return v
    hi = limit["nominal"] + limit["plus"]
    lo = limit["nominal"] - limit["minus"]
    dev = raw - limit["nominal"]
    over = past(raw - hi if raw > hi else raw - lo if raw < lo else 0.0)
    v = {"deviation": dev, "over": over, "pass": over == 0, "allowance": f"nominal {_in_unit(limit['nominal'], unit)} +{_in_unit(limit['plus'], unit)} / −{_in_unit(limit['minus'], unit)}", "delta": f"Δ {_signed(dev, unit)}"}
    if over > 0:
        v["alarm"] = f"{_in_unit(over, unit)} over the upper limit"
    elif over < 0:
        v["alarm"] = f"{_in_unit(-over, unit)} under the lower limit"
    return v


def verdict_lines(v):
    if v.get("alarm") and v["deviation"] == v["over"]:
        return [f"{v['allowance']} · {v['alarm']}"]
    first = f"{v['allowance']} · {v['delta']}"
    return [first, v["alarm"]] if v.get("alarm") else [first]


# ---- values -----------------------------------------------------------------

PARALLEL_MAX_DEG = 3
PARALLEL_WARN_DEG = 0.5


def _deg(v):
    return f"{v:.2f}°"


def _bare(v):
    return f"{v:.3f}"


def _sbare(v):
    return ("+" if v >= 0 else "") + _bare(v)


def _invalid(label, why):
    return {"label": label, "invalid": why}


def _spread(fit):
    return (fit["residualMin"], fit["residualMax"]) if fit.get("residualMin") is not None and fit.get("residualMax") is not None else None


def diameter_range(fit):
    if not has_diameter(fit):
        return None
    s = _spread(fit)
    return s and (2 * (fit["radius"] + s[0]), 2 * (fit["radius"] + s[1]))


def _to_surface_range(d, plane):
    s = _spread(plane)
    return s and (d - s[1], d - s[0])


def _foot_on_plane(plane, p):
    n = np.asarray(plane["normal"], dtype=float)
    return p - n * float((p - np.asarray(plane["center"])) @ n)


def _over_patch(plane, p):
    r = p - np.asarray(plane["center"])
    return abs(float(r @ plane["basisU"])) <= plane["extentU"] * EXTENT_MARGIN and abs(float(r @ plane["basisV"])) <= plane["extentV"] * EXTENT_MARGIN


def _warn(ws):
    return " ".join(ws) if ws else None


def evaluate(type_id, fits, anchor=None, basic=None, surfaces=None):
    """A dimension's value from its references' geometry, in slot order:
    {label, raw, value, warning?, detail?, invalid?, range?}."""
    if any(t["id"] == type_id for t in TOLERANCE_TYPES):
        return evaluate_tolerance(type_id, fits, basic, surfaces)
    if type_id == "dist-point-point":
        a, b = ref_point(fits[0]), ref_point(fits[1])
        if a is None or b is None:
            return _invalid("Distance", "A reference is not a point.")
        cd = float(np.linalg.norm(b - a))
        d = b - a
        detail = f"ΔX {_sbare(d[0])} · ΔY {_sbare(d[1])} · ΔZ {_sbare(d[2])} mm"
        if fits[0]["kind"] == "sphere" and fits[1]["kind"] == "sphere" and anchor and anchor != "center":
            ra, rb = fits[0]["radius"], fits[1]["radius"]
            if normalize(d) is None:
                return _invalid("Distance", "The two centers coincide.")
            if anchor == "gap":
                v = cd - ra - rb
                return {"label": "Surface gap", "value": mm(v), "raw": v, "detail": detail, "warning": "The fitted spheres overlap — the gap is negative." if v < 0 else None}
            v = cd + ra + rb
            return {"label": "Outer span", "value": mm(v), "raw": v, "detail": detail}
        return {"label": "Center distance", "value": mm(cd), "raw": cd, "detail": detail}
    if type_id == "dist-point-axis":
        p, ax = ref_point(fits[0]), ref_axis(fits[1])
        if p is None or ax is None:
            return _invalid("Distance to axis", "A reference is missing.")
        foot = foot_on_line(p, ax["origin"], ax["dir"])
        t = param_on_line(p, ax["origin"], ax["dir"])
        v = float(np.linalg.norm(p - foot))
        return {"label": "Distance to axis", "value": mm(v), "raw": v, "warning": "The perpendicular foot lies beyond the measured section of the axis." if abs(t) > ax["halfLength"] * EXTENT_MARGIN else None}
    if type_id == "dist-point-plane":
        p, pl = ref_point(fits[0]), ref_plane(fits[1])
        if p is None or pl is None:
            return _invalid("Distance to plane", "A reference is missing.")
        d = float((p - np.asarray(pl["center"])) @ np.asarray(pl["normal"]))
        rng = _to_surface_range(d, pl)
        out = {"label": "Distance to plane", "value": _sbare(d) + " mm", "raw": d, "detail": "Signed along the plane normal: + is outside the surface." + (f" To the measured surface itself {_sbare(rng[0])} to {_sbare(rng[1])} mm." if rng else ""), "warning": None if _over_patch(pl, _foot_on_plane(pl, p)) else "The projection falls outside the measured plane patch."}
        if rng:
            out["range"] = list(rng)
        return out
    if type_id == "dist-axis-axis":
        a, b = ref_axis(fits[0]), ref_axis(fits[1])
        if a is None or b is None:
            return _invalid("Axis distance", "A reference is missing.")
        fold = acute_angle(a["dir"], b["dir"])
        detail = f"Axes {_deg(fold)} apart"
        if fold <= PARALLEL_MAX_DEG:
            foot = foot_on_line(a["origin"], b["origin"], b["dir"])
            t = param_on_line(a["origin"], b["origin"], b["dir"])
            ws = []
            if fold > PARALLEL_WARN_DEG:
                ws.append(f"The axes are {_deg(fold)} off parallel — the value depends on where along the axes it is taken.")
            if abs(t) > b["halfLength"] * EXTENT_MARGIN:
                ws.append("Measured beyond the fitted section of the second axis.")
            v = float(np.linalg.norm(a["origin"] - foot))
            return {"label": "Axis distance", "value": mm(v), "raw": v, "detail": detail, "warning": _warn(ws)}
        pa, pb, t1, t2 = closest_between_lines(a["origin"], a["dir"], b["origin"], b["dir"])
        if abs(t1) > a["halfLength"] * EXTENT_MARGIN or abs(t2) > b["halfLength"] * EXTENT_MARGIN:
            return _invalid("Axis distance", f"The axes are {_deg(fold)} apart and their closest approach lies outside the measured sections.")
        v = float(np.linalg.norm(pa - pb))
        return {"label": "Axis distance", "value": mm(v), "raw": v, "detail": detail, "warning": f"The axes are {_deg(fold)} apart — this is the distance at their closest approach."}
    if type_id == "dist-axis-plane":
        ax, pl = ref_axis(fits[0]), ref_plane(fits[1])
        if ax is None or pl is None:
            return _invalid("Axis to plane", "A reference is missing.")
        tilt = 90 - acute_angle(ax["dir"], pl["normal"])
        if tilt > PARALLEL_MAX_DEG:
            return _invalid("Axis to plane", f"The axis is {_deg(tilt)} off parallel to the plane — there is no single distance. Use an angle dimension instead.")
        d = float((ax["origin"] - np.asarray(pl["center"])) @ np.asarray(pl["normal"]))
        ws = []
        if tilt > PARALLEL_WARN_DEG:
            ws.append(f"The axis is {_deg(tilt)} off parallel — measured at the middle of its fitted section.")
        if not _over_patch(pl, _foot_on_plane(pl, ax["origin"])):
            ws.append("The projection falls outside the measured plane patch.")
        rng = _to_surface_range(d, pl)
        out = {"label": "Axis to plane", "value": _sbare(d) + " mm", "raw": d, "detail": f"To the measured surface itself {_sbare(rng[0])} to {_sbare(rng[1])} mm" if rng else None, "warning": _warn(ws)}
        if rng:
            out["range"] = list(rng)
        return out
    if type_id == "dist-plane-plane":
        a, b = ref_plane(fits[0]), ref_plane(fits[1])
        if a is None or b is None:
            return _invalid("Plane distance", "A reference is missing.")
        fold = acute_angle(a["normal"], b["normal"])
        if fold > PARALLEL_MAX_DEG:
            return _invalid("Plane distance", f"The planes are {_deg(fold)} apart — a distance between non-parallel planes has no meaning. Use an angle dimension instead.")
        s = float((np.asarray(a["center"]) - np.asarray(b["center"])) @ np.asarray(b["normal"]))
        d = abs(s)
        ws = []
        if fold > PARALLEL_WARN_DEG:
            ws.append(f"The planes are {_deg(fold)} off parallel — the value depends on which plane is measured from.")
        if not _over_patch(b, _foot_on_plane(b, np.asarray(a["center"], dtype=float))):
            ws.append("The measured patches do not overlap — the distance is taken at the center of the first plane.")
        sa, sb = _spread(a), _spread(b)
        rng = None
        if sa and sb:
            c = float(np.asarray(a["normal"]) @ np.asarray(b["normal"]))
            sign = -1 if s < 0 else 1
            corners = [sign * (s + sa[i] * c - sb[j]) for i in (0, 1) for j in (0, 1)]
            rng = [min(corners), max(corners)]
        out = {"label": "Plane distance", "value": mm(d), "raw": d, "detail": f"Planes {_deg(fold)} off parallel" + (f" · surface to surface {_bare(rng[0])} – {_bare(rng[1])} mm" if rng else ""), "warning": _warn(ws)}
        if rng:
            out["range"] = rng
        return out
    if type_id == "angle-axis-axis":
        a, b = ref_axis(fits[0]), ref_axis(fits[1])
        if a is None or b is None:
            return _invalid("Axis angle", "A reference is missing.")
        v = acute_angle(a["dir"], b["dir"])
        return {"label": "Axis angle", "value": _deg(v), "raw": v}
    if type_id == "angle-axis-plane":
        ax, pl = ref_axis(fits[0]), ref_plane(fits[1])
        if ax is None or pl is None:
            return _invalid("Axis – plane angle", "A reference is missing.")
        v = 90 - acute_angle(ax["dir"], pl["normal"])
        return {"label": "Axis – plane angle", "value": _deg(v), "raw": v}
    if type_id == "angle-plane-plane":
        a, b = ref_plane(fits[0]), ref_plane(fits[1])
        if a is None or b is None:
            return _invalid("Plane angle", "A reference is missing.")
        v = angle_between(a["normal"], b["normal"])
        return {"label": "Plane angle", "value": _deg(v), "raw": v, "detail": f"Supplement {_deg(180 - v)}" if v > 90 else None}
    if type_id == "size-diameter":
        f = fits[0]
        if not has_diameter(f):
            return _invalid("Diameter", "The reference has no diameter.")
        rng = diameter_range(f)
        out = {"label": "Diameter", "value": mm(2 * f["radius"]), "raw": 2 * f["radius"], "detail": f"Gaussian mean · min {_bare(rng[0])} · max {_bare(rng[1])} mm from the radial extremes of the used points" if rng else None}
        if rng:
            out["range"] = list(rng)
        return out
    return _invalid("Dimension", f'Unknown dimension type "{type_id}".')


# ---- tolerances -------------------------------------------------------------

WEAK_ARC_DEG = 90
FORM_KIND = {"Flatness": "plane", "Cylindricity": "cylinder", "Circularity": "circle", "Sphericity": "sphere"}


def _rotate(v, k, angle):
    c, s = math.cos(angle), math.sin(angle)
    return v * c + np.cross(k, v) * s + k * float(k @ v) * (1 - c)


def _weak_arc(fit, what):
    if fit["kind"] in ("cylinder", "cone") and fit["coverage"] < WEAK_ARC_DEG:
        return f"The {what} rests on only {round(fit['coverage'])}° of arc, so its axis is weakly placed."
    return None


def _zone_shape(fit):
    if fit["kind"] == "plane":
        return {"kind": "plane", "center": fit["center"], "normal": fit["normal"]}
    if fit["kind"] == "sphere":
        return {"kind": "sphere", "center": fit["center"]}
    if fit["kind"] == "cylinder":
        return {"kind": "cylinder", "center": fit["center"], "axis": fit["axis"]}
    if fit["kind"] == "circle":
        return {"kind": "circle", "center": fit["center"], "normal": fit["normal"]}
    return None


# Minimum zones found, per fit and the number of points: dimensions are
# read again on every change, and a fit's points change only with the fit.
_ZONES = {}


def _zone_width(fit, surface):
    key = (id(fit), len(surface))
    if key not in _ZONES:
        from .min_zone import minimum_zone

        shape = _zone_shape(fit)
        z = minimum_zone(surface, shape) if shape else None
        if len(_ZONES) > 512:
            _ZONES.clear()
        _ZONES[key] = z["width"] if z else None
    return _ZONES[key]


def _form(label, fit, surface=None):
    """The minimum zone of the points the fit rests on (min_zone); else the
    zone the fit took when it was made (a circle through picks), else the
    least-squares peak to peak, which only bounds it from above."""
    if fit is None:
        return _invalid(label, "A reference is missing.")
    if fit["kind"] != FORM_KIND[label]:
        return _invalid(label, f"{label} is a property of a {FORM_KIND[label]}.")
    if fit.get("formError") is None:
        return _invalid(label, "The element carries no form error: it was constructed, not measured on the scan.")
    from_surface = _zone_width(fit, surface) if surface is not None and len(surface) >= 4 else None
    width = from_surface if from_surface is not None else fit.get("zoneWidth")
    if width is not None:
        pts = len(surface) if from_surface is not None else fit.get("usedPoints", 0)
        return {"label": label, "value": mm(width), "raw": width, "detail": f"Minimum zone · {pts:,} points · {mm(fit['formError'])} peak to peak about the best fit"}
    return {"label": label, "value": mm(fit["formError"]), "raw": fit["formError"], "detail": f"Peak to peak about the best fit · {fit['usedPoints']:,} points"}


def _oriented(fit):
    if fit is None:
        return None
    if fit["kind"] == "plane":
        return {"kind": "plane", "dir": np.asarray(fit["normal"], dtype=float), "plane": fit}
    ax = ref_axis(fit)
    return {"kind": "axis", "dir": ax["dir"], "axis": ax} if ax else None


def _orientation(label, basic, fits, surfaces):
    feat, datum = _oriented(fits[0]), _oriented(fits[1] if len(fits) > 1 else None)
    if not feat or not datum:
        return _invalid(label, "A reference is missing.")
    f = -feat["dir"] if feat["dir"] @ datum["dir"] < 0 else feat["dir"]
    turn = ((basic % 180) + 180) % 180
    folded = 180 - turn if turn > 90 else turn
    rho = math.radians(folded if feat["kind"] == datum["kind"] else 90 - folded)
    hinge = normalize(np.cross(datum["dir"], f))
    if hinge is None:
        hinge = ortho_basis(datum["dir"])[0]
    ideal = _rotate(datum["dir"], hinge, rho)
    zone = ideal if feat["kind"] == "plane" else np.cross(hinge, ideal)
    off = acute_angle(f, ideal)
    ws = []
    if feat["kind"] == "plane":
        surf = surfaces[0] if surfaces else None
        if surf is not None and len(surf) >= 1:
            d = np.asarray(surf) @ zone
            raw = float(d.max() - d.min()) if d.max() > d.min() else 0.0
        else:
            pl = feat["plane"]
            raw = 2 * (abs(float(np.asarray(pl["basisU"]) @ zone)) * pl["extentU"] + abs(float(np.asarray(pl["basisV"]) @ zone)) * pl["extentV"])
            ws.append("Read off the corners of the drawn patch — the feature has no measured surface.")
    else:
        ax = feat["axis"]
        a = ax["origin"] - ax["dir"] * ax["halfLength"]
        b = ax["origin"] + ax["dir"] * ax["halfLength"]
        raw = abs(float((b - a) @ zone))
    for w in (_weak_arc(fits[0], "feature"), _weak_arc(fits[1], "datum")):
        if w:
            ws.append(w)
    detail = f"{off:.3f}° off parallel" if label == "Parallelism" else f"{off:.3f}° off square" if label == "Perpendicularity" else f"{off:.3f}° off the basic {basic:.2f}°"
    return {"label": label, "value": mm(raw), "raw": raw, "detail": detail, "warning": _warn(ws)}


def _coaxiality(fits):
    feat = fits[0]
    datum = ref_axis(fits[1]) if len(fits) > 1 and fits[1] else None
    if not feat or not datum:
        return _invalid("Coaxiality", "A reference is missing.")
    centre = ref_point(feat) if feat["kind"] in ("sphere", "circle", "point") else None
    axis = None if centre is not None else ref_axis(feat)
    if centre is None and axis is None:
        return _invalid("Coaxiality", "The feature has neither an axis nor a centre.")
    label = "Concentricity" if centre is not None else "Coaxiality"
    probes = [centre] if centre is not None else [axis["origin"] - axis["dir"] * axis["halfLength"], axis["origin"] + axis["dir"] * axis["halfLength"]]
    offs = [float(np.linalg.norm(p - foot_on_line(p, datum["origin"], datum["dir"]))) for p in probes]
    beyond = any(abs(param_on_line(p, datum["origin"], datum["dir"])) > datum["halfLength"] * EXTENT_MARGIN for p in probes)
    raw = 2 * max(offs)
    ws = ["The feature reaches beyond the measured section of the datum axis."] if beyond else []
    for w in (_weak_arc(feat, "feature"), _weak_arc(fits[1], "datum")):
        if w:
            ws.append(w)
    return {"label": label, "value": f"Ø {mm(raw)}", "raw": raw, "detail": f"Centre {mm(offs[0])} off the datum axis" if centre is not None else f"Axis ends {mm(offs[0])} and {mm(offs[1])} off the datum axis", "warning": _warn(ws)}


def evaluate_tolerance(type_id, fits, basic=None, surfaces=None):
    f0 = fits[0] if fits else None
    if type_id == "form-flatness":
        return _form("Flatness", f0, surfaces[0] if surfaces else None)
    if type_id == "form-cylindricity":
        return _form("Cylindricity", f0, surfaces[0] if surfaces else None)
    if type_id == "form-circularity":
        return _form("Circularity", f0, surfaces[0] if surfaces else None)
    if type_id == "form-sphericity":
        return _form("Sphericity", f0, surfaces[0] if surfaces else None)
    if type_id == "orient-parallelism":
        return _orientation("Parallelism", 0, fits, surfaces)
    if type_id == "orient-perpendicularity":
        return _orientation("Perpendicularity", 90, fits, surfaces)
    if type_id == "orient-angularity":
        if basic is None or not math.isfinite(basic):
            return _invalid("Angularity", "Type the basic angle the feature is drawn at.")
        return _orientation("Angularity", basic, fits, surfaces)
    if type_id == "loc-coaxiality":
        return _coaxiality(fits)
    return _invalid("Tolerance", f'Unknown tolerance type "{type_id}".')
