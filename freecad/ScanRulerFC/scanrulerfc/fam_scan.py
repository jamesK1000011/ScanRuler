# SPDX-License-Identifier: AGPL-3.0-only
# The scan: open it, say what it holds. ScanRuler's scan.open and the scan
# part of session.state (src/commands/core/scan.ts), for Agent Link.

import os

from agentlink.protocol import Tool, ToolError

from . import scanstate as S

GROUP = "scan"
INFO = "The 3D scan measured (ScanRuler, ported): open it and read what it holds."


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


def tools(session):
    def scan_open(a):
        path = a.get("path")
        if not path or not os.path.isfile(path):
            raise ToolError("not_found", f"path {path!r}: no such file — give the scan's path on this computer.")
        st = S.state(session)
        if st["scan"] is not None and (st["elements"] or st["dimensions"]) and not a.get("discard"):
            raise ToolError("invalid_state", f"{st['scan'].name} is open with {len(st['elements'])} elements and {len(st['dimensions'])} dimensions: discard: true replaces it.")
        try:
            scan = S.load(path, a.get("units", "mm"))
        except ValueError as e:
            raise ToolError("invalid_input", str(e))
        st.update({"scan": scan, "elements": [], "dimensions": [], "next": 1})
        return {"opened": scan.summary()}

    def scan_info(a):
        st = S.state(session)
        if st["scan"] is None:
            return {"scan": None, "note": "No scan open: scan_open { path }."}
        return {"scan": st["scan"].summary(), "elements": len(st["elements"]), "dimensions": len(st["dimensions"])}

    return [
        Tool("scan_open", "Open a 3D scan (STL, PLY, OBJ, OFF, 3MF) to measure, in place of the one open: units mm (default), cm, m or in. A scan with elements or dimensions on it is kept unless discard: true.", obj({"path": {"type": "string"}, "units": {"type": "string", "enum": list(S.UNITS)}, "discard": {"type": "boolean"}}, ["path"]), scan_open),
        Tool("scan_info", "The scan open: file, units, vertices, triangles, box, centre, area; and how many elements and dimensions are on it. Changes nothing.", obj({}), scan_info),
    ]
