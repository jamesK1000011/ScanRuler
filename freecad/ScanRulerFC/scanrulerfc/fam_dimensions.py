# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/commands/core/dimension.ts,
# src/commands/core/session.ts (report.get), src/core/summary.ts
#
# Dimensions and tolerances between elements, held to limits for a verdict,
# and the report of everything measured.

import os

from agentlink.protocol import Tool, ToolError

from . import dimensions as D
from . import model as M
from . import scanstate as S
from .schema import arr, element_ref, enum, guarded, integer, num, obj, one_of, string

GROUP = "dimensions"
INFO = "Dimensions and GD&T-like checks between elements (ScanRuler, ported), their limits and verdicts, and the measuring report."

LIMIT = one_of([
    obj({"kind": enum(["max"], "A ceiling."), "max": num("The most the value may be, mm or degrees.")}, ["kind", "max"]),
    obj({"kind": enum(["band"], "A nominal with an allowance either side."), "nominal": num("The nominal value, mm or degrees."), "plus": num("Allowed above it.", minimum=0), "minus": num("Allowed below it (positive).", minimum=0)}, ["kind", "nominal", "plus", "minus"]),
], "What the value is checked against, for a pass or fail verdict.")
DIM = one_of([integer("Its id.", minimum=1), string('Its name — "Distance 1".', minLength=1)], "The dimension.")
NULL = {"type": "null", "description": "None."}


def tools(session):
    def st():
        return S.state(session)

    def report(a):
        s = st()
        if a.get("format", "json") == "text":
            return {"format": "text", "workspace": "measure", "text": M.report_text(s)}
        return {"format": "json", "report": M.report_json(s)}

    def export_csv(a):
        s = st()
        M.require_scan(s)
        path = a.get("path") or os.path.join(session.out_dir, os.path.splitext(s["scan"].name)[0] + "-measurements.csv")
        d = os.path.dirname(os.path.abspath(path))
        if not os.path.isdir(d):
            raise ToolError("not_found", f"{d}: no such folder.")
        return M.export_csv(s, path)

    types = ", ".join(t["id"] for t in D.TYPES)
    return [
        Tool("dimension_add", "Measure between elements, or a size or tolerance of one. refs are the elements by id or name, in slot order. Without type, the type follows the elements as clicking them does — two planes their distance, a plane and an axis theirs, two spheres their centre distance; with type, one of " + types + ". anchor, for two spheres: center (default), gap or span; limit holds the value to a ceiling or a nominal ± band; basic is an angularity's basic angle. Returns the dimension with its value (mm or degrees), the formatted value and the verdict. These are GD&T-like, read off fitted elements of a noisy scan — not certified.", obj({"refs": arr(element_ref("An element."), "The elements, in slot order.", minItems=1, maxItems=3), "type": string("The dimension type — see the description.", minLength=1), "anchor": enum(["center", "gap", "span"], "Two spheres: centre to centre (the default), the gap between them, or the span across them."), "limit": LIMIT, "basic": num("An angularity's basic angle, degrees."), "name": string('A name; otherwise numbered — "Distance 2".', minLength=1)}, ["refs"]), guarded(lambda a: M.dimension_add(st(), a)), changes=True),
        Tool("dimension_set_limit", "Hold a dimension to a limit — a ceiling, or a nominal ± band — or take it off with null. Returns the dimension with its verdict.", obj({"dimension": DIM, "limit": one_of([LIMIT, NULL], "The limit, or null for none.")}, ["dimension", "limit"]), guarded(lambda a: M.dimension_set_limit(st(), a["dimension"], a["limit"])), changes=True),
        Tool("dimension_set_basic", "The basic angle an angularity tolerance is read against, in degrees, or null to take it off.", obj({"dimension": DIM, "basic": one_of([num("Degrees."), NULL], "The basic angle.")}, ["dimension", "basic"]), guarded(lambda a: M.dimension_set_basic(st(), a["dimension"], a["basic"])), changes=True),
        Tool("dimension_remove", "Delete a dimension or tolerance.", obj({"dimension": DIM}, ["dimension"]), guarded(lambda a: M.dimension_remove(st(), a["dimension"])), changes=True),
        Tool("report_get", "The measurement report. format \"json\" (the default): what the numbers rest on (units, scale, alignment, fit method, outlier cut-offs), every element with its fit, every dimension with value, unit, limit and verdict, and the tally of checks. format \"text\": the plain-text summary ScanRuler's Copy report gives for the measure workspace. Changes nothing.", obj({"format": enum(["json", "text"], "json (the default) or text."), "workspace": enum(["measure"], "For text: measure, the only one here.")}), guarded(report)),
        Tool("export_csv", "Write the elements and dimensions as a CSV table (one row each: value, unit, limit, deviation, verdict, sigma, form error, position) to path (default: the session's output folder). Returns the path and the row count.", obj({"path": string("Where to write the .csv file.")}), guarded(export_csv)),
    ]
