# SPDX-License-Identifier: AGPL-3.0-only
# Ported from ScanRuler by CNC Kitchen: src/commands/schema.ts,
# src/commands/refs.ts (locationSchema, elementRefSchema)
#
# The JSON schema pieces the tool inputs are built from, and the wrapper that
# turns a model Refusal into Agent Link's ToolError.

from agentlink.protocol import ToolError

from .model import Refusal


def obj(props, required=(), description=None):
    o = {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}
    if description:
        o["description"] = description
    return o


def num(d=None, **kw):
    return dict({"type": "number"}, **({"description": d} if d else {}), **kw)


def integer(d=None, **kw):
    return dict({"type": "integer"}, **({"description": d} if d else {}), **kw)


def string(d=None, **kw):
    return dict({"type": "string"}, **({"description": d} if d else {}), **kw)


def boolean(d=None):
    return {"type": "boolean", **({"description": d} if d else {})}


def enum(values, d=None):
    return {"enum": list(values), **({"description": d} if d else {})}


def vec3(d=None):
    return {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3, **({"description": d} if d else {})}


def arr(items, d=None, **kw):
    return dict({"type": "array", "items": items}, **({"description": d} if d else {}), **kw)


def one_of(options, d=None):
    return {"oneOf": options, **({"description": d} if d else {})}


def location(d="A place on the scan."):
    return one_of([obj({"vertex": integer("A scan vertex.", minimum=0)}, ["vertex"]), obj({"point": vec3("A point, mm; the nearest vertex is taken.")}, ["point"])], d)


def element_ref(d="An element by id or name."):
    return one_of([integer("Its id.", minimum=1), string("Its name.", minLength=1)], d)


BOX = obj({"min": vec3("Lowest corner, mm."), "max": vec3("Highest corner, mm.")}, ["min", "max"], "A box in the current frame.")
NORMAL = obj({"dir": vec3("A direction, any length."), "withinDeg": num("Degrees; 30 by default.", exclusiveMinimum=0, maximum=180)}, ["dir"], "Only the vertices whose outward normal faces this way.")


def guarded(fn):
    """The tool's function with model refusals made Agent Link's."""

    def run(a):
        try:
            return fn(a)
        except Refusal as e:
            raise ToolError(e.code, e.message)

    return run
