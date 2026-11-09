# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/commands/core/element.ts,
# dimension.ts, scan.ts (query, nearest), segment.ts, scanScale.ts, align.ts,
# session.ts (report.get), src/commands/state.ts (describeElement,
# describeDimension), src/core/summary.ts (buildSummary), src/core/fit/seedOff.ts
#
# What the measuring tools do to the session, without Agent Link: the
# elements fitted and constructed on the scan, the dimensions between them,
# the alignment and the scale, the report. Each refusal is a Refusal(code,
# message) the tool families turn into Agent Link's ToolError.

import csv
import io
import math

import numpy as np

from . import alignment as A
from . import construct as C
from . import dimensions as D
from . import grow as G
from . import segment as SEG
from .linalg import FitError, normalize
from .shapes import circle_from_points, seed_off


class Refusal(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


KIND_NAMES = {"point": "Point", "line": "Line", "plane": "Plane", "sphere": "Sphere", "cylinder": "Cylinder", "cone": "Cone", "circle": "Circle", "torus": "Torus"}
FIT_KINDS = ("plane", "sphere", "cylinder", "cone", "torus", "point", "circle")
SURFACE_KINDS = ("plane", "sphere", "cylinder", "cone", "torus")
ALL_KINDS = ("point", "line", "plane", "sphere", "cylinder", "cone", "circle", "torus")
WORLD = {"XY": [0.0, 0.0, 1.0], "YZ": [1.0, 0.0, 0.0], "XZ": [0.0, 1.0, 0.0], "ZX": [0.0, 1.0, 0.0], "YX": [0.0, 0.0, 1.0], "ZY": [1.0, 0.0, 0.0]}


def js(x, places=6):
    """JSON-ready: numpy to lists and floats, rounded."""
    if isinstance(x, dict):
        return {k: js(v, places) for k, v in x.items() if v is not None}
    if isinstance(x, (list, tuple)):
        return [js(v, places) for v in x]
    if isinstance(x, np.ndarray):
        return [js(v, places) for v in x.tolist()]
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        x = float(x)
        return round(x, places) if math.isfinite(x) else None
    return x


def require_scan(st):
    if st["scan"] is None:
        raise Refusal("no_scan", "No scan is open — open one with scan_open first.")
    return st["scan"]


def model_size(scan):
    """Half the box diagonal — ScanRuler's modelSize."""
    return float(np.linalg.norm(scan.V.max(axis=0) - scan.V.min(axis=0))) / 2


# ---- places on the scan -----------------------------------------------------


def resolve_location(scan, at):
    g = scan.graph()
    try:
        if "vertex" in at:
            return g.spot(vertex=int(at["vertex"]))
        if "point" in at:
            return g.spot(point=at["point"])
    except ValueError as e:
        raise Refusal("invalid_input", str(e))
    raise Refusal("invalid_input", "A place is { vertex } or { point: [x, y, z] }.")


def query(scan, box=None, near=None, normal=None, limit=1000):
    """The vertices in a box or a ball, facing a way if asked: all matching,
    and every step-th of them up to limit."""
    if (box is None) == (near is None):
        raise Refusal("invalid_input", "Give box or near — one of them.")
    g = scan.graph()
    P = g.P
    if box:
        lo, hi = np.asarray(box["min"], dtype=float), np.asarray(box["max"], dtype=float)
        if not np.all(lo <= hi):
            raise Refusal("invalid_input", "The box’s min lies past its max.")
        ok = np.all((P >= lo) & (P <= hi), axis=1)
    else:
        ok = np.linalg.norm(P - np.asarray(near["at"], dtype=float), axis=1) <= near["radius"]
    if normal:
        d = normalize(normal["dir"])
        if d is None:
            raise Refusal("invalid_input", "normal.dir: give a direction, not a zero vector.")
        ok &= g.N @ d >= math.cos(math.radians(normal.get("withinDeg", 30)))
    every = np.nonzero(ok)[0]
    step = max(1, math.ceil(len(every) / limit))
    return every, every[::step], step


# ---- elements ---------------------------------------------------------------


def _next_name(st, kind):
    c = st["counters"].get(kind, 0) + 1
    st["counters"][kind] = c
    return f"{KIND_NAMES[kind]} {c}"


def find_element(st, ref):
    els = st["elements"]
    if isinstance(ref, bool):
        ref = int(ref)
    if isinstance(ref, (int, float)) and not isinstance(ref, str):
        hit = [e for e in els if e["id"] == int(ref)]
        if not hit:
            raise Refusal("not_found", f"There is no element {int(ref)}.")
        return hit[0]
    want = str(ref).strip().lower()
    hit = [e for e in els if e["name"].strip().lower() == want]
    if not hit and want.isdigit():
        return find_element(st, int(want))
    if not hit:
        raise Refusal("not_found", f'There is no element named "{ref}".')
    if len(hit) > 1:
        raise Refusal("invalid_input", f'{len(hit)} elements are named "{ref}" — name it by its id.')
    return hit[0]


def measured(st, ref, kinds=None):
    el = find_element(st, ref)
    if el.get("fit") is None:
        raise Refusal("invalid_state", f"{el['name']} has no geometry.")
    if kinds and el["kind"] not in kinds:
        raise Refusal("invalid_input", f"{el['name']} is a {el['kind']}; this takes a {' or '.join(kinds)}.")
    return el


def cutoff_label(k):
    return "all points" if k == 0 else f"{k} sigma cut-off"


def describe_element(el, full=True):
    src = el["source"]
    if src["type"] == "fitted":
        s = {"type": "fitted", "method": "gaussian", "sigmaCutoff": src["settings"]["sigma"], "cutoff": cutoff_label(src["settings"]["sigma"])}
        if src["settings"].get("knownDiameter") is not None:
            s["knownDiameter"] = src["settings"]["knownDiameter"]
        if src.get("selection") is not None:
            s["markedPoints"] = len(src["selection"])
        else:
            s["seeds"] = list(src["seeds"])
    elif src["type"] == "picked":
        s = {"type": "picked"}
    else:
        s = {"type": "constructed", "method": src["method"], "refs": list(src["refs"]), "params": list(src["params"])}
        if src.get("selection") is not None:
            s["markedPoints"] = len(src["selection"])
    fit = {k: v for k, v in (el.get("fit") or {}).items() if k != "region"}
    out = {"id": el["id"], "name": el["name"], "kind": el["kind"], "status": "done" if el.get("fit") else "failed", "visible": el["visible"], "fit": fit or None, "source": s}
    if el.get("assumed") is not None:
        out["assumed"] = el["assumed"]
    if el.get("note"):
        out["note"] = el["note"]
    return js(out)


def _add(st, kind, fit, source, region=None, name=None):
    el = {"id": st["next"], "name": None, "kind": kind, "fit": fit, "source": source, "visible": True, "region": region}
    st["next"] += 1
    el["name"] = name if name else _next_name(st, kind)
    if name:
        st["counters"][kind] = st["counters"].get(kind, 0) + 1
    st["elements"].append(el)
    return el


def _finish(el, assumed):
    if assumed is not None:
        if el["kind"] not in ("sphere", "cylinder", "circle"):
            raise Refusal("invalid_input", f"A {el['kind']} has no diameter to assume.")
        el["assumed"] = assumed


SEED_OFF_SIGMA = 3.5
SEED_OFF_DEG = 25


def _seeds_answer(spots, kind, region, fit):
    def spot_json(s):
        return {"vertex": s["vertex"], "point": s["point"], "distance": s["distance"]}

    if len(spots) < 2:
        return [spot_json(s) for s in spots], None
    members = set(int(v) for v in region)
    read = []
    for i, s in enumerate(spots):
        inr = any(v in members for v in s["triangle"])
        read.append({"n": i + 1, "spot": s, "in": inr, "off": seed_off(fit, s["point"], s["normal"])})
    seeds = [dict(spot_json(r["spot"]), inRegion=r["in"], **({"offMm": round(r["off"]["offMm"], 3), "deg": round(r["off"]["deg"], 1)} if r["off"] else {})) for r in read]
    out = [r for r in read if not r["in"]]
    if not out:
        return seeds, None
    sigma = fit.get("sigma", 0)

    def elsewhere(r):
        return r["off"] is not None and (abs(r["off"]["offMm"]) > SEED_OFF_SIGMA * sigma + 0.01 or r["off"]["deg"] > SEED_OFF_DEG)

    def where(r):
        return f"{round(abs(r['off']['offMm']), 2)} mm off it, turned {round(r['off']['deg'], 1)}°" if r["off"] else "where it has no normal"

    frm = [r["n"] for r in read if r["in"]]
    grew = f"the {kind} grew from seed{'s' if len(frm) > 1 else ''} {', '.join(map(str, frm))}" if frm else f"the {kind} grew from none of the seeds"
    far = [r for r in out if elsewhere(r)]
    near = [r for r in out if not elsewhere(r)]
    parts = []
    if far:
        parts.append(f"seeds lie on two surfaces? {grew}; {'; '.join('seed %d lies %s' % (r['n'], where(r)) for r in far)} — fit each on its own, or mark both (scan_segment {{ mark: [ids] }}) and fit the marked (element_fit_marked {{ marked: true }}).")
    if near:
        parts.append(f"{'; '.join('seed %d lies on it (%s)' % (r['n'], where(r)) for r in near)} but outside the region it grew to — at its rim, or on a part the growing did not reach: fit it alone to see.")
    return seeds, " ".join(parts)


def _region_answer(scan, region):
    g = scan.graph()
    Q = g.P[region]
    tri_in = np.isin(g.F, region).all(axis=1)
    t = g.P[g.F[tri_in]]
    area = float(np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1).sum() / 2) if len(t) else 0.0
    return {"area": round(area, 1), "box": {"min": js(Q.min(axis=0), 2), "max": js(Q.max(axis=0), 2)}}


def _guide_of(a):
    kind = a["kind"]
    side, radius, axis, within = a.get("side"), a.get("radius"), a.get("axis"), a.get("within")
    if side is None and radius is None and axis is None and within is None:
        return None
    if kind in ("point", "circle"):
        raise Refusal("invalid_input", f"A {kind} is picked, not grown — side, radius, axis and within do not apply.")
    if (side is not None or radius is not None) and kind not in ("sphere", "cylinder", "cone"):
        raise Refusal("invalid_input", f"side and radius are for a sphere, cylinder or cone, not a {kind}.")
    if axis is not None and kind not in ("cylinder", "cone"):
        raise Refusal("invalid_input", f"axis is for a cylinder or cone, not a {kind}.")
    if axis is not None and not math.hypot(*axis) > 0:
        raise Refusal("invalid_input", "axis: give a direction, not a zero vector.")
    if radius and radius.get("min") is not None and radius.get("max") is not None and radius["min"] > radius["max"]:
        raise Refusal("invalid_input", "radius: min lies past max.")
    if within and not all(within["min"][k] <= within["max"][k] for k in range(3)):
        raise Refusal("invalid_input", "within: the box’s min lies past its max.")
    return {k: v for k, v in (("side", side), ("radius", radius), ("axis", axis), ("within", within)) if v is not None}


def _settings(a):
    s = {"method": "gaussian", "sigma": a.get("sigma", 3)}
    if a.get("knownDiameter") is not None:
        s["knownDiameter"] = a["knownDiameter"]
    return s


def _fit_out(fit):
    region = fit.pop("region", None)
    return fit, (np.asarray(region, dtype=np.int64) if region is not None else None)


def element_fit(st, a):
    scan = require_scan(st)
    kind = a["kind"]
    if kind not in FIT_KINDS:
        raise Refusal("invalid_input", f"kind: one of {', '.join(FIT_KINDS)}.")
    guide = _guide_of(a)
    if a.get("knownDiameter") is not None and kind != "sphere":
        raise Refusal("invalid_input", f"knownDiameter is for a sphere, not a {kind}.")
    if a.get("at") is None:
        raise Refusal("invalid_input", "Give at — the place on the scan.")
    places = a["at"] if isinstance(a["at"], list) else [a["at"]]
    if kind == "point" and len(places) != 1:
        raise Refusal("invalid_input", "A point is one place.")
    if kind == "circle" and len(places) < 3:
        raise Refusal("invalid_input", "A circle needs three places or more.")
    if a.get("mark") and kind in ("point", "circle"):
        raise Refusal("invalid_input", f"A {kind} is picked, not grown — it has no region to mark.")
    spots = [resolve_location(scan, p) for p in places]
    if kind == "point":
        el = _add(st, "point", {"kind": "point", "center": spots[0]["point"], "sigma": 0.0, "usedPoints": 0, "regionSize": 0}, {"type": "picked"}, None, a.get("name"))
        return {"element": describe_element(el), "seeds": [{"vertex": s["vertex"], "point": s["point"], "distance": s["distance"]} for s in spots]}
    if kind == "circle":
        try:
            fit = circle_from_points([s["point"] for s in spots])
        except FitError as e:
            raise Refusal("failed", str(e))
        el = _add(st, "circle", fit, {"type": "picked", "points": [s["point"] for s in spots]}, None, a.get("name"))
        _finish(el, a.get("assumed"))
        return {"element": describe_element(el), "seeds": [{"vertex": s["vertex"], "point": s["point"], "distance": s["distance"]} for s in spots]}
    seeds = []
    for s in spots:
        for v in s["triangle"]:
            if v not in seeds:
                seeds.append(v)
    settings = _settings(a)
    try:
        fit = G.FROM_SEED[kind](scan.graph(), seeds, settings, guide)
    except FitError as e:
        raise Refusal("failed", str(e))
    fit, region = _fit_out(fit)
    if a.get("assumed") is not None and kind not in ("sphere", "cylinder"):
        raise Refusal("invalid_input", f"A {kind} has no diameter to assume.")
    el = _add(st, kind, fit, {"type": "fitted", "seeds": seeds, "settings": settings}, region, a.get("name"))
    _finish(el, a.get("assumed"))
    seed_rows, warning = _seeds_answer(spots, kind, region, fit)
    out = {"element": describe_element(el), "seeds": js(seed_rows), "region": _region_answer(scan, region)}
    if warning:
        out["warning"] = warning
    if a.get("mark"):
        st["marked"] = {"vertices": region, "from": f"element_fit {el['name']}"}
        out["marked"] = {"points": int(len(region)), "from": st["marked"]["from"]}
    return out


def element_fit_marked(st, a):
    scan = require_scan(st)
    kind = a["kind"]
    if kind not in SURFACE_KINDS:
        raise Refusal("invalid_input", f"kind: one of {', '.join(SURFACE_KINDS)}.")
    if a.get("knownDiameter") is not None and kind != "sphere":
        raise Refusal("invalid_input", f"knownDiameter is for a sphere, not a {kind}.")
    given = [a.get("vertices") is not None, a.get("marked") is True, a.get("box") is not None]
    if sum(given) != 1:
        raise Refusal("invalid_input", "Give vertices, marked: true or box — one of them.")
    if a.get("normal") and not a.get("box"):
        raise Refusal("invalid_input", "normal goes with box.")
    n = len(scan.V)
    if a.get("vertices") is not None:
        bad = [v for v in a["vertices"] if v >= n]
        if bad:
            raise Refusal("invalid_input", f"The scan has no vertex {bad[0]} — it has {n}.")
        sel = np.asarray(a["vertices"], dtype=np.int64)
    elif a.get("box"):
        sel, _, _ = query(scan, box=a["box"], normal=a.get("normal"), limit=max(1, n))
        if len(sel) < 3:
            raise Refusal("invalid_input", f"Only {len(sel)} scan points lie in the box{' facing that way' if a.get('normal') else ''} — a surface needs more.")
    else:
        if not st.get("marked"):
            raise Refusal("invalid_state", "Nothing is marked — mark with scan_query { mark: true }, scan_segment { mark } or element_fit { mark: true }.")
        sel = np.asarray(st["marked"]["vertices"], dtype=np.int64)
    settings = _settings(a)
    try:
        fit = G.ON_SELECTION[kind](scan.graph(), sel, settings)
    except FitError as e:
        raise Refusal("failed", str(e))
    fit, region = _fit_out(fit)
    el = _add(st, kind, fit, {"type": "fitted", "seeds": [], "selection": sel, "settings": settings}, region, a.get("name"))
    _finish(el, a.get("assumed"))
    out = {"element": describe_element(el)}
    if a.get("box"):
        out["points"] = int(len(sel))
    return out


def _coordinate_plane(st, axis_name, made):
    params = WORLD[axis_name] + [0.0, 0.0, 0.0]
    for e in st["elements"]:
        s = e["source"]
        if s["type"] == "constructed" and s["method"] == "plane-coords" and len(s["params"]) == 6 and all(abs(v - params[i]) < 1e-9 for i, v in enumerate(s["params"])):
            return e["id"]
    name = f"{axis_name} plane"
    taken = any(e["name"].strip().lower() == name.lower() for e in st["elements"])
    scan = st["scan"]
    fit = C.evaluate_construction("plane-coords", [], params, model_size(scan))
    el = _add(st, "plane", fit, {"type": "constructed", "method": "plane-coords", "refs": [], "params": params}, None, None if taken else name)
    made.append({"id": el["id"], "name": el["name"]})
    return el["id"]


def element_construct(st, a, symmetry=None):
    scan = require_scan(st)
    kind, method_id = a["kind"], a["method"]
    methods = C.methods_for_kind(kind)
    method = next((m for m in methods if m["id"] == method_id), None)
    if method is None:
        if method_id in ("fit", "pick", "circle-points"):
            raise Refusal("invalid_input", f'"{method_id}" works on the scan — use element_fit.')
        raise Refusal("invalid_input", f'A {kind} has no method "{method_id}" — it has {", ".join(m["id"] for m in methods) or "none to construct"}.')
    refs = a.get("refs") or []
    if len(refs) != len(method["slots"]):
        n = len(method["slots"])
        raise Refusal("invalid_input", f"{method['label']} takes {n} source element{'' if n == 1 else 's'} ({', '.join(s['label'] for s in method['slots']) or 'none'}), not {len(refs)}.")
    sources = []
    for ref, slot in zip(refs, method["slots"]):
        world = None
        if isinstance(ref, str) and ref.strip().upper() in WORLD and not any(e["name"].strip().lower() == ref.strip().lower() for e in st["elements"]):
            world = ref.strip().upper()
        el = None if world else measured(st, ref)
        k = el["kind"] if el else "plane"
        if not C.provides_role(k, slot["role"]) or (slot.get("kinds") and k not in slot["kinds"]):
            raise Refusal("invalid_input", f"{el['name'] if el else world} cannot be “{slot['label']}” — that takes a {' or '.join(slot.get('kinds') or [slot['role']])}.")
        sources.append(el["id"] if el else world)
    typed = [p for p in method["params"] if not p.get("hidden")]
    given = a.get("params") or []
    if isinstance(given, dict):
        values = []
        for p in typed:
            v = given.get(p["key"])
            if v is None and p.get("initial") is not None:
                v = p["initial"]
            if not isinstance(v, (int, float)) or not math.isfinite(v):
                raise Refusal("invalid_input", f"params.{p['key']} ({p['label']}) is required.")
            values.append(float(v))
    else:
        values = [float(v) for v in given]
        # A number the method starts with (Max gap) may be left out.
        if len(values) < len(typed) and all(p.get("initial") is not None for p in typed[len(values):]):
            values += [p["initial"] for p in typed[len(values):]]
    if len(values) != len(typed):
        raise Refusal("invalid_input", f"{method['label']} takes {len(typed)} number{'' if len(typed) == 1 else 's'} ({', '.join(p['key'] for p in typed) or 'none'}), not {len(values)}.")
    if method_id not in ("point-centroid", "plane-symmetry") and (a.get("vertices") is not None or a.get("seed") is not None):
        raise Refusal("invalid_input", f"{method['label']} takes no marked surface and no seed.")
    made = []
    ids = [s if isinstance(s, int) else _coordinate_plane(st, s, made) for s in sources]
    fits = [find_element(st, i)["fit"] for i in ids]
    note = None
    sym = None
    sel = np.asarray(a["vertices"], dtype=np.int64) if a.get("vertices") is not None else None
    if method_id == "point-centroid":
        cen, note = C.scan_centroid(scan.V, scan.F, sel)
        values = [float(x) for x in cen]
    elif method_id == "plane-symmetry":
        if symmetry is None:
            raise Refusal("not_implemented", "plane-symmetry is not ported yet.")
        seed_fit = None
        if a.get("seed") is not None:
            sref = a["seed"]
            if isinstance(sref, str) and sref.strip().upper() in WORLD:
                seed_fit = {"kind": "plane", "center": [0.0, 0.0, 0.0], "normal": WORLD[sref.strip().upper()]}
            else:
                seed_fit = measured(st, sref, ["plane"])["fit"]
        sym = symmetry(scan, sel, seed_fit)
        values = list(sym["normal"]) + list(sym["point"]) + [sym["rms"], sym["matched"], sym["sampled"]]
        note = sym.get("note")
    try:
        fit = C.evaluate_construction(method_id, fits, values, model_size(scan))
    except C.ConstructionError as e:
        raise Refusal("invalid_input", f"{method['label']}: {e}")
    src = {"type": "constructed", "method": method_id, "refs": ids, "params": values}
    if sel is not None:
        src["selection"] = sel
    el = _add(st, kind, fit, src, None, a.get("name"))
    if note:
        el["note"] = note
    _finish(el, a.get("assumed"))
    out = {"element": describe_element(el)}
    if made:
        out["made"] = made
    if sym:
        out["symmetry"] = js({"rms": sym["rms"], "matched": sym["matched"], "sampled": sym["sampled"], "note": sym.get("note")})
    return out


def element_rename(st, ref, name):
    el = find_element(st, ref)
    if not name.strip():
        raise Refusal("invalid_input", "name: give a name.")
    el["name"] = name
    return {"element": describe_element(el)}


def element_remove(st, ref):
    el = find_element(st, ref)
    gone = {el["id"]}
    grew = True
    while grew:
        grew = False
        for e in st["elements"]:
            if e["id"] not in gone and e["source"]["type"] == "constructed" and gone & set(e["source"]["refs"]):
                gone.add(e["id"])
                grew = True
    removed = [{"id": e["id"], "name": e["name"]} for e in st["elements"] if e["id"] in gone]
    dims = [{"id": d["id"], "name": d["name"]} for d in st["dimensions"] if gone & set(d["refs"])]
    st["elements"] = [e for e in st["elements"] if e["id"] not in gone]
    st["dimensions"] = [d for d in st["dimensions"] if not gone & set(d["refs"])]
    return {"removed": removed, "dimensionsRemoved": dims}


def element_set_visible(st, a):
    if a.get("all"):
        for e in st["elements"]:
            e["visible"] = a["visible"]
        return {"elements": [{"id": e["id"], "name": e["name"], "visible": e["visible"]} for e in st["elements"]]}
    if a.get("element") is None:
        raise Refusal("invalid_input", "Name an element, or pass all: true.")
    el = find_element(st, a["element"])
    el["visible"] = a["visible"]
    return {"element": {"id": el["id"], "name": el["name"], "visible": el["visible"]}}


# ---- moving the part --------------------------------------------------------

COORD_POINT = {"point-coords": (0, None), "plane-coords": (3, 0), "line-coords": (3, 0), "circle-coords": (4, 1)}


def _move_params(src, rig):
    m = src["method"]
    if m not in COORD_POINT:
        if m in ("point-centroid",):
            src["params"] = [float(x) for x in A.apply(rig, np.asarray(src["params"][:3])[None])[0]]
        elif m == "plane-symmetry" and len(src["params"]) >= 6:
            p = list(src["params"])
            p[0:3] = [float(x) for x in rig[0] @ np.asarray(p[0:3])]
            p[3:6] = [float(x) for x in A.apply(rig, np.asarray(p[3:6])[None])[0]]
            src["params"] = p
        return
    at, d = COORD_POINT[m]
    p = list(src["params"])
    p[at:at + 3] = [float(x) for x in A.apply(rig, np.asarray(p[at:at + 3])[None])[0]]
    if d is not None:
        p[d:d + 3] = [float(x) for x in rig[0] @ np.asarray(p[d:d + 3])]
    src["params"] = p


def transform_all(st, rig):
    """Carry the scan and everything measured on it through a rigid motion."""
    scan = st["scan"]
    R, t = A.compose(rig, (scan.R, scan.t))
    scan.set_pose(scan.k, R, t)
    for e in st["elements"]:
        if e.get("fit"):
            e["fit"] = A.transform_fit(e["fit"], rig)
        if e["source"]["type"] == "constructed":
            _move_params(e["source"], rig)
        if e["source"].get("points"):
            e["source"]["points"] = A.apply(rig, e["source"]["points"]).tolist()


def scale_all(st, s):
    scan = st["scan"]
    scan.set_pose(scan.k * s, scan.R, scan.t * s)
    for e in st["elements"]:
        if e.get("fit"):
            e["fit"] = A.scale_fit(e["fit"], s)
        if e["source"]["type"] == "constructed":
            e["source"]["params"] = A.scale_params(e["source"]["method"], e["source"]["params"], s)


def applied(scan):
    if np.allclose(scan.R, np.eye(3)) and np.allclose(scan.t, 0):
        return None
    return scan.R, scan.t


def _slot_fit(st, slot, value, scan):
    if "element" in value:
        return measured(st, value["element"])["fit"]
    if "plane" in value:
        n = normalize(value["plane"]["normal"])
        if n is None:
            raise Refusal("invalid_input", "plane.normal: give a direction, not a zero vector.")
        return C.evaluate_construction("plane-coords", [], list(n) + list(value["plane"]["origin"]), model_size(scan))
    pts = value.get("points") or ([value["point"]] if "point" in value else [])
    if len(pts) != A.ALIGN_PICK_COUNT[slot]:
        c = A.ALIGN_PICK_COUNT[slot]
        raise Refusal("invalid_input", f"The {slot} slot takes {c} point{'' if c == 1 else 's'}.")
    towards = [scan.graph().spot(point=p)["normal"] for p in pts] if slot == "primary" else None
    try:
        return A.fit_from_picks(slot, pts, model_size(scan), towards)
    except A.AlignmentError as e:
        raise Refusal("invalid_input", str(e))


def align_datum(st, a):
    scan = require_scan(st)
    if not a.get("primary") and not a.get("origin"):
        raise Refusal("invalid_input", "Give a primary (levelling) datum, an origin, or both.")
    first = applied(scan) is None
    prim = _slot_fit(st, "primary", a["primary"], scan) if a.get("primary") else None
    sec = _slot_fit(st, "secondary", a["secondary"], scan) if a.get("secondary") else None
    org = _slot_fit(st, "origin", a["origin"], scan) if a.get("origin") else None
    if org is not None and C.ref_point(org) is None and org["kind"] not in ("point",):
        raise Refusal("invalid_input", "The zero point takes a point, sphere, circle or torus.")
    pax, sax = a.get("primaryAxis", "z-"), a.get("secondaryAxis", "x+")
    owned = set()
    for spec, ax in ((prim, pax), (sec, sax)):
        if spec is not None:
            k = A.axis_index(ax)
            owned |= {k} if spec["kind"] == "plane" else {i for i in range(3) if i != k}
    open_coords = [i for i in range(3) if i not in owned]
    centre = None
    centred = []
    if first and prim is not None and org is None and not a.get("keepFree"):
        lo, hi = scan.V.min(axis=0), scan.V.max(axis=0)
        centre = (lo + hi) / 2
        centred = ["xyz"[i] for i in open_coords]
    parallel = None
    if prim is not None and prim["kind"] == "plane":
        g = scan.graph()
        facing = g.N @ np.asarray(prim["normal"]) >= math.cos(math.radians(5))
        pts = g.P[facing]
        if len(pts) > 20000:
            pts = pts[:: math.ceil(len(pts) / 20000)]
        found = A.parallel_face_near(pts, prim["center"], prim["normal"])
        if found:
            off, times = round(found["offset"], 2), round(found["times"], 1)
            parallel = {"offset": off, "times": times, "note": f"A face parallel to the levelling plane, {abs(off)} mm {'behind it' if off < 0 else 'out from it'} along its outward normal, has about {times}× its area on the scan. If the part stands on that face, level on it instead."}
    try:
        if prim is not None:
            rig = A.datum_alignment({"fit": prim, "axis": pax}, {"fit": sec, "axis": sax} if sec is not None else None, org, centre)
        else:
            if sec is not None:
                raise Refusal("invalid_input", "A rotation datum needs a levelling one.")
            rig = A.translation_to_origin(org["center"])
    except A.AlignmentError as e:
        raise Refusal("invalid_input", str(e))
    before = np.asarray(org["center"], dtype=float) if org is not None else None
    transform_all(st, rig)
    out = {"applied": A.rigid_json(rig)}
    total = applied(scan)
    if not first:
        out["appliedAlignment"] = A.rigid_json(total)
    if centred:
        out["centred"] = centred
    if before is not None:
        at = A.apply(rig, before[None])[0]
        off = [i for i in range(3) if i in owned and abs(at[i]) > 1e-3]
        o = {"set": ["xyz"[i] for i in open_coords], "at": js(at, 4)}
        if off:
            o["note"] = f"The datums own {' and '.join('xyz'[i] for i in off)}: the origin point stands at {', '.join('%s %s' % ('xyz'[i], round(float(at[i]), 4)) for i in off)}. To put it at 0, 0, 0, call align_datum again with origin alone (the same place) — that moves the datums off zero along those axes."
        out["origin"] = o
    if parallel:
        out["parallelFace"] = parallel
    out["elements"] = len(st["elements"])
    return out


def align_clear(st):
    scan = require_scan(st)
    total = applied(scan)
    if total is None:
        raise Refusal("invalid_state", "The part is in scan coordinates already.")
    transform_all(st, A.inverse(total))
    scan.set_pose(scan.k, np.eye(3), np.zeros(3))
    return {"appliedAlignment": None, "elements": len(st["elements"])}


def apply_rigid(st, rig, extra=None):
    """An alignment found by a search (auto, symmetry), applied."""
    first = applied(st["scan"]) is None
    transform_all(st, rig)
    out = {"applied": A.rigid_json(rig)}
    if not first:
        out["appliedAlignment"] = A.rigid_json(applied(st["scan"]))
    out.update(extra or {})
    out["elements"] = len(st["elements"])
    return out


def _reference(st, r):
    t = r.get("true")
    if not (isinstance(t, (int, float)) and t > 0):
        raise Refusal("invalid_input", "Each reference needs true: its length on the real part, mm, above 0.")
    if "points" in r:
        a, b = (np.asarray(p, dtype=float) for p in r["points"])
        m = float(np.linalg.norm(b - a))
        if not m > 0:
            raise Refusal("invalid_input", "The two points of a reference coincide.")
        return {"label": "Two points", "measured": m, "true": t}
    if "element" in r:
        el = measured(st, r["element"], ["sphere", "cylinder", "circle"])
        return {"label": f"{el['name']} Ø", "measured": 2 * el["fit"]["radius"], "true": t}
    d = find_dimension(st, r["dimension"])
    info = D.type_info(d["type"])
    if info["family"] != "dimension" or info["unit"] == "°":
        raise Refusal("invalid_input", f"{d['name']} is not a length — give a distance or a diameter.")
    v = evaluate_dimension(st, d)["value"]
    if v.get("raw") is None or not v["raw"] > 0:
        raise Refusal("invalid_state", f"{d['name']} has no value to scale from{(' — ' + v['invalid']) if v.get('invalid') else ''}.")
    return {"label": d["name"], "measured": v["raw"], "true": t}


def scan_scale(st, a):
    scan = require_scan(st)
    if (a.get("factor") is None) == (a.get("references") is None):
        raise Refusal("invalid_input", "Give either factor or references — one of them.")
    comb = None
    if a.get("references") is not None:
        try:
            comb = A.combine_references([_reference(st, r) for r in a["references"]])
        except ValueError as e:
            raise Refusal("invalid_input", str(e))
    k = comb["factor"] if comb else a["factor"]
    prob = A.factor_problem(k)
    if prob:
        raise Refusal("invalid_input", prob)
    before = 2 * model_size(scan)
    out = {"factor": round(k, 6)}
    if comb:
        out["references"] = [{"label": r["label"], "measured": round(r["measured"], 4), "true": round(r["true"], 4), "factor": round(r["factor"], 6), "offPct": round(r["off"] * 100, 3)} for r in comb["references"]]
        if len(comb["references"]) > 1:
            out["spreadPct"] = round(comb["spread"] * 100, 3)
    if a.get("dryRun"):
        out.update(dryRun=True, size={"before": round(before, 3), "after": round(before * k, 3)})
        return out
    scale_all(st, k)
    prev = st.get("scaled")
    st["scaled"] = {"factor": (prev["factor"] if prev else 1.0) * k, "references": [{"label": r["label"], "measured": r["measured"], "true": r["true"]} for r in (comb["references"] if comb else [])]}
    out.update(size={"before": round(before, 3), "after": round(2 * model_size(scan), 3)}, scan=scan.summary())
    return out


# ---- dimensions -------------------------------------------------------------


def find_dimension(st, ref):
    ds = st["dimensions"]
    if isinstance(ref, (int, float)) and not isinstance(ref, (str, bool)):
        hit = [d for d in ds if d["id"] == int(ref)]
        label = int(ref)
    else:
        hit = [d for d in ds if d["name"].strip().lower() == str(ref).strip().lower()]
        if not hit and str(ref).strip().isdigit():
            return find_dimension(st, int(str(ref).strip()))
        label = f'named "{ref}"'
    if not hit:
        raise Refusal("not_found", f"There is no dimension {label}.")
    if len(hit) > 1:
        raise Refusal("invalid_input", f'{len(hit)} dimensions are named "{ref}" — name it by its id.')
    return hit[0]


def _surface(st, eid):
    el = next((e for e in st["elements"] if e["id"] == eid), None)
    if el is None or el.get("region") is None:
        return None
    return st["scan"].V[el["region"]]


def evaluate_dimension(st, d):
    info = D.type_info(d["type"])
    els = [next((e for e in st["elements"] if e["id"] == i), None) for i in d["refs"]]
    title = " → ".join(e["name"] if e else "?" for e in els)
    if all(e is not None and e.get("fit") for e in els):
        surfaces = [_surface(st, i) for i in d["refs"]] if info["family"] == "tolerance" else None
        value = D.evaluate(d["type"], [e["fit"] for e in els], d.get("anchor"), d.get("basic"), surfaces)
    else:
        value = {"label": info["label"], "invalid": "A referenced element is unavailable."}
    verdict = None
    if d.get("limit") and value.get("raw") is not None and not value.get("invalid"):
        verdict = D.judge_limit(value["raw"], d["limit"], info["unit"])
    return {"dim": d, "title": title, "value": value, "verdict": verdict}


def describe_dimension(st, d):
    row = evaluate_dimension(st, d)
    info = D.type_info(d["type"])
    v = row["value"]
    out = {"id": d["id"], "name": d["name"], "type": d["type"], "family": info["family"], "title": row["title"], "refs": list(d["refs"]), "label": v["label"], "value": None if v.get("invalid") else v.get("raw"), "unit": info["unit"], "display": v.get("value"), "visible": d.get("visible", True)}
    for k in ("anchor", "limit", "basic"):
        if d.get(k) is not None and not (k == "anchor" and d[k] == "center"):
            out[k] = d[k]
    if row["verdict"]:
        vd = row["verdict"]
        out["verdict"] = {"pass": vd["pass"], "deviation": vd["deviation"], "over": vd["over"], "allowance": vd["allowance"], **({"alarm": vd["alarm"]} if vd.get("alarm") else {})}
    for k in ("detail", "warning", "invalid", "range"):
        if v.get(k) is not None:
            out[k] = v[k]
    return js(out)


def dimension_add(st, a):
    require_scan(st)
    ids = [t["id"] for t in D.TYPES]
    if a.get("type") is not None and a["type"] not in ids:
        raise Refusal("invalid_input", f'There is no dimension type "{a["type"]}" — there are {", ".join(ids)}.')
    els = [measured(st, r) for r in a["refs"]]
    if a.get("type"):
        info = D.type_info(a["type"])
        refs = D.assign_refs(a["type"], [(e["id"], e["kind"]) for e in els])
        if any(r is None for r in refs) or len(els) != len(info["slots"]):
            raise Refusal("invalid_input", f"A {info['label']} {'tolerance' if info['family'] == 'tolerance' else 'dimension'} takes {' and '.join(s['label'] for s in info['slots'])} — {', '.join(e['name'] for e in els)} do not seat in it.")
        tid = a["type"]
    else:
        # The viewport's way: each element clicked in turn, the type
        # following what has been picked.
        tid = "dist-point-point"
        picked = []
        for e in els:
            if any(p[0] == e["id"] for p in picked):
                continue
            picked.append((e["id"], e["kind"]))
            tid = D.resolve_type(tid, [p[1] for p in picked])
        refs = D.assign_refs(tid, picked)
        if any(r is None for r in refs) or any(e["id"] not in refs for e in els):
            raise Refusal("invalid_input", f"{' and '.join(e['name'] for e in els)} make no dimension on their own — name a type.")
    info = D.type_info(tid)
    d = {"id": st["dimNext"], "type": tid, "name": None, "refs": refs, "visible": True}
    if a.get("anchor"):
        d["anchor"] = a["anchor"]
    if a.get("limit"):
        d["limit"] = a["limit"]
    if a.get("basic") is not None:
        d["basic"] = a["basic"]
    preview = evaluate_dimension(st, d)["value"]
    if preview.get("invalid"):
        raise Refusal("invalid_input", f"{info['label']}: {preview['invalid']}")
    st["dimNext"] += 1
    key = "dim:" + info["stem"].lower()
    c = st["counters"].get(key, 0) + 1
    st["counters"][key] = c
    d["name"] = a.get("name") or f"{info['stem']} {c}"
    st["dimensions"].append(d)
    return {"dimension": describe_dimension(st, d)}


def dimension_set_limit(st, ref, limit):
    d = find_dimension(st, ref)
    if limit is None:
        d.pop("limit", None)
    else:
        d["limit"] = limit
    return {"dimension": describe_dimension(st, d)}


def dimension_set_basic(st, ref, basic):
    d = find_dimension(st, ref)
    if basic is None:
        d.pop("basic", None)
    else:
        d["basic"] = basic
    return {"dimension": describe_dimension(st, d)}


def dimension_remove(st, ref):
    d = find_dimension(st, ref)
    st["dimensions"] = [x for x in st["dimensions"] if x["id"] != d["id"]]
    return {"removed": {"id": d["id"], "name": d["name"]}}


# ---- the report -------------------------------------------------------------


def _vec(v):
    return "(" + ", ".join(f"{x:.4f}" for x in v) + ")"


def _form_label(kind):
    return {"plane": "flatness", "cylinder": "cylindricity", "sphere": "sphericity", "circle": "circularity"}.get(kind)


def report_text(st):
    """The plain-text summary of everything measured (buildSummary, mm)."""
    scan = st["scan"]

    def name_of(i):
        e = next((x for x in st["elements"] if x["id"] == i), None)
        return e["name"] if e else "?"

    def ln(v):
        return f"{v:.4f} mm"

    lines = [f"ScanRuler — {scan.name if scan else '(no scan)'}", "Method: Gaussian best-fit", ""]
    for el in st["elements"]:
        lines.append(el["name"])
        s = el["source"]
        if s["type"] == "constructed":
            lines.append(f"  constructed: {s['method']} from {', '.join(name_of(i) for i in s['refs']) or 'numbers'}{(' ' + str([round(x, 4) for x in s['params']])) if s['params'] else ''}")
        f = el.get("fit")
        if not f:
            lines.append("  no geometry")
            continue
        k = f["kind"]
        if k == "sphere":
            lines.append(f"  diameter: {ln(f['radius'] * 2)}{' (known, held by the fit)' if f.get('held') else ''}")
            lines.append(f"  center: {_vec(f['center'])}")
            if f.get("held"):
                lines.append(f"  free fit: diameter {ln(f['held']['freeDiameter'])}, centre {ln(f['held']['shift'])} from the held one")
        elif k == "cylinder":
            lines += [f"  diameter: {ln(f['radius'] * 2)}", f"  axis point: {_vec(f['center'])}", f"  axis direction: {_vec(f['axis'])}", f"  length: {ln(f['length'])}, arc: {round(f['coverage'])}°"]
        elif k == "cone":
            lines += [f"  apex angle: {f['halfAngle'] * 2:.3f}° (half-angle {f['halfAngle']:.3f}°)", f"  diameter: {f['radius1'] * 2:.4f} → {ln(f['radius2'] * 2)}", f"  axis point: {_vec(f['center'])}", f"  axis direction: {_vec(f['axis'])}", f"  length: {ln(f['length'])}, arc: {round(f['coverage'])}°"]
        elif k == "torus":
            lines += [f"  tube radius: {ln(f['minorRadius'])}, ring radius: {ln(f['majorRadius'])}", f"  centre: {_vec(f['center'])}", f"  axis direction: {_vec(f['axis'])}", f"  tube arc: {round(f['tubeCoverage'])}°, round the ring: {round(f['spineCoverage'])}°"]
        elif k == "plane":
            lines += [f"  point: {_vec(f['center'])}", f"  normal: {_vec(f['normal'])}", f"  patch: {f['extentU'] * 2:.2f} × {f['extentV'] * 2:.2f} mm"]
        elif k == "circle":
            lines += [f"  diameter: {ln(f['radius'] * 2)}", f"  center: {_vec(f['center'])}", f"  normal: {_vec(f['normal'])}"]
        elif k == "point":
            lines.append(f"  point: {_vec(f['center'])}")
        else:
            lines += [f"  point: {_vec(f['center'])}", f"  direction: {_vec(f['dir'])}"]
        if f.get("usedPoints", 0) > 0:
            cut = f" ({cutoff_label(s['settings']['sigma'])})" if s["type"] == "fitted" else ""
            lines.append(f"  sigma: {ln(f['sigma'])}, used points: {f['usedPoints']} of {f['regionSize']}{cut}")
            if f.get("formError") is not None:
                lines.append(f"  {_form_label(k) or 'form'} (peak-to-peak): {ln(f['formError'])}")
            if f.get("residualMin") is not None:
                lines.append(f"  residual min / max: {'−' if f['residualMin'] < 0 else '+'}{abs(f['residualMin']):.4f} / {'−' if f['residualMax'] < 0 else '+'}{abs(f['residualMax']):.4f} mm")
                rng = D.diameter_range(f)
                if rng:
                    lines.append(f"  diameter min / max: {rng[0]:.4f} / {ln(rng[1])} (radial extremes)")
        if el.get("assumed") is not None and D.has_diameter(f) and el["assumed"] != 2 * f["radius"]:
            lines.append(f"  assumed diameter: {ln(el['assumed'])}")
    rows = [evaluate_dimension(st, d) for d in st["dimensions"]]
    if rows:
        lines.append("")
    checked = passed = 0
    for r in rows:
        d, v, vd = r["dim"], r["value"], r["verdict"]
        if v.get("invalid"):
            lines.append(f"{d['name']} ({r['title']}) — {v['label']}: no value — {v['invalid']}")
            continue
        lines.append(f"{d['name']} ({r['title']}) — {v['label']}: {v['value']}")
        if vd:
            checked += 1
            passed += int(vd["pass"])
            lines.append(f"  {' · '.join(D.verdict_lines(vd))} · {'PASS' if vd['pass'] else 'FAIL'}")
        if v.get("detail"):
            lines.append(f"  {v['detail']}")
        if v.get("warning"):
            lines.append(f"  ⚠ {v['warning']}")
    if checked:
        lines += ["", f"Checked against limits: {checked} — {passed} pass, {checked - passed} fail"]
    return "\n".join(lines)


def report_json(st):
    scan = st["scan"]
    rows = [describe_dimension(st, d) for d in st["dimensions"]]
    checked = [r for r in rows if "verdict" in r]
    out = {
        "units": "mm",
        "scan": scan.summary() if scan else None,
        "scale": js(st["scaled"]) if st.get("scaled") else None,
        "alignment": A.rigid_json(applied(scan)) if scan else None,
        "fitMethod": "gaussian",
        "elements": [describe_element(e) for e in st["elements"]],
        "dimensions": rows,
        "checks": {"checked": len(checked), "pass": sum(1 for r in checked if r["verdict"]["pass"]), "fail": sum(1 for r in checked if not r["verdict"]["pass"])},
    }
    return out


def export_csv(st, path):
    """The elements and dimensions as a table, one row each."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["section", "id", "name", "kind", "label", "value", "unit", "nominal", "plus", "minus", "max", "deviation", "verdict", "sigma", "formError", "x", "y", "z"])
    for e in st["elements"]:
        f = e.get("fit") or {}
        prim = 2 * f["radius"] if (f and D.has_diameter(f)) else None
        c = f["center"] if f.get("center") is not None else [None, None, None]
        w.writerow(["element", e["id"], e["name"], e["kind"], "diameter" if prim is not None else "", f"{prim:.4f}" if prim is not None else "", "mm" if prim is not None else "", "", "", "", "", "", "", f"{f.get('sigma', 0):.4f}" if f.get("usedPoints") else "", f"{f['formError']:.4f}" if f.get("formError") is not None else ""] + [f"{float(x):.4f}" if x is not None else "" for x in c])
    for d in st["dimensions"]:
        r = describe_dimension(st, d)
        lim = d.get("limit") or {}
        v = r.get("verdict")
        w.writerow(["dimension", d["id"], d["name"], d["type"], r["label"], f"{r['value']:.4f}" if r.get("value") is not None else "", r["unit"], lim.get("nominal", ""), lim.get("plus", ""), lim.get("minus", ""), lim.get("max", ""), f"{v['deviation']:.4f}" if v else "", ("PASS" if v["pass"] else "FAIL") if v else "", "", "", "", "", ""])
    with open(path, "w", newline="", encoding="utf-8") as fh:
        fh.write(buf.getvalue())
    return {"path": path, "rows": len(st["elements"]) + len(st["dimensions"])}


# ---- scan reads -------------------------------------------------------------


def scan_segment(st, a):
    scan = require_scan(st)
    box = a.get("box")
    if box and not all(box["min"][k] <= box["max"][k] for k in range(3)):
        raise Refusal("invalid_input", "The box’s min lies past its max.")
    diag = 2 * model_size(scan)
    opts = {"box": box, "minArea": a.get("minArea", (0.02 * diag) ** 2), "maxRms": a.get("maxRms", 0.05), "maxDeg": a.get("maxDeg", 15)}
    key = (scan.version, repr(opts))
    cache = st.get("segCache")
    if cache and cache[0] == key:
        res = cache[1]
    else:
        res = SEG.segment_planes(scan.graph(), opts["minArea"], opts["maxRms"], opts["maxDeg"], box)
        st["segCache"] = (key, res)
    regions = res["regions"]
    mark = a.get("mark")
    ids = [] if mark is None else list(dict.fromkeys([mark] if isinstance(mark, int) else mark))
    marked = None
    limit = a.get("limit", 20)
    shown = min(limit, len(regions))

    def row(i):
        r = regions[i]
        return js({"id": i + 1, "normal": js(r["normal"], 5), "point": js(r["point"], 4), "sigma": round(r["sigma"], 4), "area": round(r["area"], 1), "box": {"min": js(r["min"], 2), "max": js(r["max"], 2)}, "vertices": r["count"], "neighbours": [{"id": nb["id"], "deg": round(nb["deg"], 1)} for nb in r["neighbours"] if nb["id"] <= shown or nb["deg"] <= SEG.SMOOTH_DEG]})

    if ids:
        missing = [i for i in ids if i > len(regions) or i < 1]
        if missing:
            raise Refusal("invalid_input", f"There is no region {', '.join(map(str, missing))} — {len(regions)} were found.")
        pts = np.concatenate([regions[i - 1]["members"] for i in ids])
        st["marked"] = {"vertices": pts, "from": f"scan_segment region{'s' if len(ids) > 1 else ''} {', '.join(map(str, ids))}"}
        marked = {"points": int(len(pts)), "from": st["marked"]["from"]}
    listed = not marked or a.get("list") is True
    out = {"found": len(regions), "considered": res["considered"], "claimed": res["claimed"], "maxRms": opts["maxRms"]}
    if listed and shown < len(regions):
        out["shown"] = shown
    if marked:
        out["marked"] = marked
        out["region"] = row(ids[0] - 1) if len(ids) == 1 else [row(i - 1) for i in ids]
    if listed:
        out["regions"] = [row(i) for i in range(shown)]
    return out
