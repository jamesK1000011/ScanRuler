# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/commands/core/align.ts,
# src/commands/core/scanScale.ts
#
# The part's coordinate system — a 3-2-1 datum alignment and the way back —
# and the scan's true size. The scan's vertices and everything measured on
# them move together; the transform is kept, so it can be cleared.

from agentlink.protocol import Tool

from . import model as M
from . import scanstate as S
from .alignment import AXES
from .schema import arr, boolean, element_ref, enum, guarded, integer, num, obj, one_of, string, vec3

GROUP = "align"
INFO = "The part's frame and size (ScanRuler, ported): datum alignment, reset, scaling a scan to its true size."


def slot(what, count, points):
    return one_of([
        obj({"element": element_ref(f"An element for {what}.")}, ["element"]),
        obj({"point": vec3(f"A point for {what}, mm.")}, ["point"]) if count == 1 else obj({"points": arr(vec3("A point, mm."), f"{count} points, mm — {points}.", minItems=count, maxItems=count)}, ["points"]),
    ], f"{what[0].upper()}{what[1:]}: an element, or {'a point' if count == 1 else f'{count} points'} on the scan.")


PRIMARY = one_of([
    obj({"element": element_ref("An element for levelling.")}, ["element"]),
    obj({"points": arr(vec3("A point, mm."), "3 points, mm — they span the face.", minItems=3, maxItems=3)}, ["points"]),
    obj({"plane": obj({"origin": vec3("A point on the plane, mm."), "normal": vec3("Its outward normal.")}, ["origin", "normal"])}, ["plane"]),
], "Levelling: an element, 3 points on the scan, or a plane { origin, normal }.")

REFERENCE = one_of([
    obj({"dimension": one_of([integer(minimum=1), string(minLength=1)], "A length dimension already measured."), "true": num("Its length on the real part, mm.")}, ["dimension", "true"]),
    obj({"element": element_ref("A sphere, cylinder or circle; its diameter is the length."), "true": num("Its diameter on the real part, mm.")}, ["element", "true"]),
    obj({"points": arr(vec3("A point on the scan, mm."), "The two ends of the length.", minItems=2, maxItems=2), "true": num("The distance between them on the real part, mm.")}, ["points", "true"]),
], "A length known two ways: measured on the scan, and true.")


def tools(session):
    def st():
        return S.state(session)

    return [
        Tool("align_datum", "A 3-2-1 alignment: primary levels the part — a plane (or 3 points, or plane { origin, normal }) whose outward normal becomes primaryAxis (default z-); secondary turns it — a line or axis (or 2 points) laid along secondaryAxis (default x+), or a plane; origin is the zero point — a point, sphere or circle (or 1 point). Elements by id or name, or points in mm used as given. Trap: a plane as secondary puts its outward NORMAL on secondaryAxis. Each datum zeroes the coordinates it owns, the origin only those left open; an origin alone moves without turning. On a first alignment the coordinates nothing sets are centred on the scan's box (keepFree: true leaves them). Returns the transform applied, how many elements moved, centred, origin { set, at, note } and parallelFace when a face parallel to the levelling plane holds more of the scan.", obj({"primary": PRIMARY, "primaryAxis": enum(AXES, "The axis the primary's outward normal becomes; default z-."), "secondary": slot("rotation", 2, "they run along the edge"), "secondaryAxis": enum(AXES, "The axis the secondary runs along (a plane: its normal); default x+."), "origin": slot("the zero point", 1, ""), "keepFree": boolean("First alignment: leave the coordinates nothing sets where they are instead of centring.")}), guarded(lambda a: M.align_datum(st(), a)), changes=True),
        Tool("align_symmetry", "Settle the part's pose on its mirror plane and apply it: the mirror plane a measured symmetry plane (element_construct plane-symmetry, the newest) or one searched for on the scan; the axis of the current frame nearest its normal is turned onto it and the zero point put on it. Refuses when the scan has no symmetry plane (mirror RMS over 0.5 mm). Returns the note on what it settled on, the transform and how many elements moved.", obj({}), guarded(lambda a: M.align_symmetry(st())), changes=True),
        Tool("align_clear", "Put the part back in the coordinates the scanner delivered it in, with everything measured on it. Returns how many elements moved with it.", obj({}), guarded(lambda a: M.align_clear(st())), changes=True),
        Tool("scan_scale", "Scale the scan to its true size — a photogrammetry scan has no size of its own. Give references: lengths measured on the scan with their true lengths from the real part — a length dimension (distance or diameter), an element's diameter (sphere, cylinder, circle), or two points — or a factor outright. Several references are averaged by length; each one's own factor and how far it is off the average (offPct) come back, so a bad one shows. The scale is about the frame's zero point. Elements and dimensions scale with it. dryRun: true returns the factor and the size it would give without scaling. Returns factor, the references, size before and after, and the scan.", obj({"factor": num("Scale by this factor outright — 25.4 for a file in inches read as mm.", exclusiveMinimum=0), "references": arr(REFERENCE, "Lengths to scale from — one or more.", minItems=1), "dryRun": boolean("Work out the factor and the size it gives, and scale nothing.")}), guarded(lambda a: M.scan_scale(st(), a)), changes=True),
    ]
