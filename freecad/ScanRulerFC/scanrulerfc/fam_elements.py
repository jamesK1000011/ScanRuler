# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/commands/core/element.ts
#
# Elements: fitted on the scan, constructed from others, renamed, removed,
# shown and hidden.

from agentlink.protocol import Tool

from . import model as M
from . import scanstate as S
from . import construct as C
from . import symmetry as SYM
from .schema import BOX, NORMAL, arr, boolean, element_ref, enum, guarded, integer, location, num, obj, one_of, string, vec3

GROUP = "elements"
INFO = "Elements on the scan (ScanRuler, ported): fit planes, spheres, cylinders, cones, tori, circles and points; construct from others; rename, remove, show."

SIGMA = enum([3, 2, 1, 0], "Outlier cut-off, sigma: 3 (the default), 2, 1, or 0 for all points.")
FINISHING = {
    "sigma": SIGMA,
    "knownDiameter": num("Sphere: a known diameter held, mm (a gauge ball); the centre alone is fitted.", exclusiveMinimum=0),
    "assumed": num("The designed diameter, mm: kept beside the fit, reported as measured.", exclusiveMinimum=0),
    "name": string('A name; else numbered by kind — "Sphere 2".', minLength=1),
}


def tools(session):
    def st():
        return S.state(session)

    fit_d = (
        "Fit an element on the scan: a plane, sphere, cylinder, cone or torus grows its surface from the place (or places) in at and is best-fitted to it (RANSAC/LMedS estimate, region growing, Gaussian best fit with a sigma cut-off); a point is the place itself; a circle goes through three or more places — with exactly three it runs through each, so its sigma and formError are null (nothing to read), and under six a warning says its form is not to be judged. "
        "A place is { vertex } or { point: [x, y, z] } (mm, current frame; the nearest vertex is taken). Trap: a seed near an edge can land on the wrong surface — say what is sought with side, radius, axis or within, and surfaces that do not match are passed over. "
        "Returns the element with its fit (sigma = RMS, formError = peak-to-peak, residualMin/Max, usedPoints of regionSize; coverage for round ones), the seeds used (inRegion, offMm, deg) and the region grown (area, box); a warning when seeds lie on two surfaces."
    )
    fit_schema = obj(dict({
        "kind": enum(M.FIT_KINDS, "What to fit."),
        "at": one_of([location("One place."), arr(location("A place."), "Several places.", minItems=1)], "Where on the scan."),
        "side": enum(["inside", "outside"], "Sphere, cylinder, cone: inside (concave, a bore) or outside (convex, a shaft)."),
        "radius": obj({"min": num("mm.", exclusiveMinimum=0), "max": num("mm.", exclusiveMinimum=0)}, [], "Sphere, cylinder, cone: the radius range sought."),
        "axis": vec3("Cylinder, cone: the axis direction, roughly (within 20°)."),
        "within": obj({"min": vec3("Lowest corner, mm."), "max": vec3("Highest corner, mm.")}, ["min", "max"], "The surface stays inside this box."),
        "mark": boolean("Leave the grown region marked for element_fit_marked."),
    }, **FINISHING), ["kind"])

    marked_schema = obj(dict({
        "kind": enum(M.SURFACE_KINDS, "What to fit."),
        "vertices": arr(integer(minimum=0), "The scan vertices of the surface.", minItems=3),
        "marked": boolean("The points left marked, in place of vertices."),
        "box": BOX,
        "normal": NORMAL,
    }, **FINISHING), ["kind"])

    construct_schema = obj({
        "kind": enum(M.ALL_KINDS, "What to construct."),
        "method": string("The creation method — see the description.", minLength=1),
        "refs": arr(element_ref('A source element; in a plane’s slot also "XY", "YZ", "XZ".'), "The method’s source elements, slot by slot."),
        "params": one_of([arr(num(), "The numbers in the method’s order."), {"type": "object", "description": "The numbers by key (x, y, z; offset; angle; gap; nx, ny, nz, px, py, pz; dx, dy, dz, length; d, cx, cy, cz).", "additionalProperties": True}], "The method’s typed-in numbers, mm."),
        "seed": element_ref("plane-symmetry: the plane the search starts from."),
        "vertices": arr(integer(minimum=0), "point-centroid, plane-symmetry: only these scan vertices.", minItems=3),
        "assumed": FINISHING["assumed"],
        "name": FINISHING["name"],
    }, ["kind", "method"])
    methods = "; ".join(f"{k}: " + ", ".join(m["id"] for m in C.methods_for_kind(k) if m["id"] not in ("x",)) for k in ("point", "line", "plane", "circle"))

    return [
        Tool("element_fit", fit_d, fit_schema, guarded(lambda a: M.element_fit(st(), a)), changes=True),
        Tool("element_fit_marked", "Fit a plane, sphere, cylinder, cone or torus to exactly the scan vertices given, with no search for the surface — vertices, or marked: true for the points the last element_fit { mark: true }, scan_segment { mark } or scan_query { mark: true } left marked, or box (with normal: only those facing a way) for every vertex inside it. Returns the element, and with box how many points it took.", marked_schema, guarded(lambda a: M.element_fit_marked(st(), a)), changes=True),
        Tool("element_construct", "Construct an element from others and typed-in numbers — " + methods + ". refs fill the slots in order, by id or name (\"XY\", \"YZ\", \"XZ\" become plane elements, listed under made); params are the numbers in order or by key. point-centroid measures the scan (vertices confines it); plane-symmetry finds the scan's mirror plane (seed starts the search, vertices confines it) and answers symmetry { rms, matched, sampled }. Returns the element.", construct_schema, guarded(lambda a: M.element_construct(st(), a, SYM.find_symmetry)), changes=True),
        Tool("element_rename", "Give an element another name; dimensions and constructions on it keep pointing at it.", obj({"element": element_ref("The element."), "name": string("Its new name.", minLength=1)}, ["element", "name"]), guarded(lambda a: M.element_rename(st(), a["element"], a["name"])), changes=True),
        Tool("element_unlink", "Freeze a constructed point, line, plane or circle where it stands: its sources give way to coordinates of its own (point-coords, line-coords, plane-coords, circle-coords), so it no longer moves when they do and stays if they are deleted. Refused for an element not built from others. Returns the element.", obj({"element": element_ref("The constructed element.")}, ["element"]), guarded(lambda a: M.element_unlink(st(), a["element"])), changes=True),
        Tool("element_remove", "Delete an element — and with it every construction built on it and every dimension on any of them, and the deviation map against it when it was the deviation target (deviationTargetCleared: the map falls back to the reference part's). Returns what went.", obj({"element": element_ref("The element.")}, ["element"]), guarded(lambda a: M.element_remove(st(), a["element"])), changes=True),
        Tool("element_set_visible", "Show or hide one element, or all of them with all: true. A hidden element still measures; the flag is kept for the report and the views.", obj({"element": element_ref("The element."), "all": boolean("Every element."), "visible": boolean("Shown (true) or hidden (false).")}, ["visible"]), guarded(lambda a: M.element_set_visible(st(), a)), changes=True),
        Tool("element_list", "The elements on the scan, each with its fit and how it came about. Changes nothing.", obj({}), guarded(lambda a: {"elements": [M.describe_element(e) for e in st()["elements"]]})),
    ]
