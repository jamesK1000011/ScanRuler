# SPDX-License-Identifier: AGPL-3.0-only
# Scanner noise: which scanner a scan came from, with its usual noise, how
# noisy this scan is, and from the two the noise to plan with. ScanRuler's
# scanner-profiles plugin (Scanner noise), for Agent Link.
# Ported from ScanRuler by CNC Kitchen: plugins/scanner-profiles/
# (app/scannerCommands.ts, state/scannerStore.ts) and the scan check's noise
# (src/commands/core/scan.ts, qa).
#
# The scanners are the person's data, not baked in: a JSON file with their
# files (scanners.json), exported and imported whole. The project's choice
# and this scan's reading are kept with the scan's state.

import json
import os

from agentlink.protocol import Tool, ToolError

from . import noise_core as N
from . import scanstate as S

GROUP = "scan-noise"
INFO = "Scanner noise (ScanRuler, ported): this scan's noise, your scanners' usual noise, and the noise to plan with."
FILE = "scanners.json"


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


def store_path(session):
    return os.environ.get("SCANRULERFC_SCANNERS") or os.path.join(session.out_dir, FILE)


def load(session):
    try:
        with open(store_path(session), encoding="utf-8") as f:
            data = json.load(f)
        return [p for p in data.get("scanners", data if isinstance(data, list) else []) if check(p, quiet=True)]
    except (OSError, ValueError):
        return []


def save(session, scanners):
    path = store_path(session)
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"kind": "scanruler.scanners", "version": 1, "scanners": scanners}, f, indent=1)
    return path


def check(p, quiet=False):
    ok = isinstance(p, dict) and isinstance(p.get("name"), str) and p["name"].strip() and N._ok(p.get("noiseMm")) and p["noiseMm"] <= 5
    if not ok and not quiet:
        raise ToolError("invalid_input", f"A scanner is {{name, noiseMm (0–5 mm), spacingMm?, note?}}: {p!r} is not.")
    return ok


def entry(p):
    return {k: p[k] for k in ("name", "noiseMm", "spacingMm", "note") if p.get(k) is not None}


def nstate(session):
    st = S.state(session)
    n = st.setdefault("noise", {"using": None, "measured": None})
    # A reading is of the scan it was read on.
    if n["measured"] and (st["scan"] is None or n["measured"].get("scan") != st["scan"].name):
        n["measured"] = None
    return n


def plan_now(session):
    """The noise to plan with now; None with no scanner named and nothing
    measured. What thread and wear read."""
    n = nstate(session)
    return N.plan(n["using"], n["measured"])


def planned(session):
    n = plan_now(session)
    return {"plan": N.answer(n)} if n else {"plan": None, "note": "Nothing to plan with: scan_noise reads this scan's, scanner use names one."}


def tools(session):
    def scan_noise(a):
        scan = S.scan_of(session)
        g = scan.graph()
        cad, flat = N.is_cad(g)
        if cad:
            raise ToolError("invalid_input", f"{scan.name} is a CAD tessellation ({flat:.0%} of its vertices sit between exactly coplanar triangles): it has no scan noise.")
        r = N.local_noise(g)
        if not r["sampled"]:
            raise ToolError("failed", "Too few connected points to fit small planes on.")
        spacing = N.point_spacing(scan.V, scan.F)
        nstate(session)["measured"] = {"sigmaMm": N.r4(r["median"]), "spacingMm": N.r4(spacing), "scan": scan.name}
        return {"sigmaMm": N.r4(r["median"]), "p90": N.r4(r["p90"]), "spacingMm": N.r4(spacing), "sampled": r["sampled"], **planned(session),
                "next": "scanner add { name, noiseMm } keeps it as a scanner's usual noise (scan a flat, matte part for that)."}

    def scanner(a):
        act = a["action"]
        scanners = load(session)
        n = nstate(session)
        if act == "list":
            return {"scanners": scanners, "using": n["using"], "measured": n["measured"], "file": store_path(session), **planned(session)}
        if act == "add":
            p = entry(a.get("scanner") or {})
            check(p)
            scanners = [x for x in scanners if x["name"] != p["name"]] + [p]
            path = save(session, scanners)
            if a.get("use"):
                n["using"] = p
            return {"added": p, "file": path, **planned(session)}
        if act == "remove":
            name = a.get("name")
            left = [x for x in scanners if x["name"] != name]
            if len(left) == len(scanners):
                raise ToolError("not_found", f"No scanner named {name!r}: {[x['name'] for x in scanners]}.")
            save(session, left)
            return {"removed": name, "note": "A project naming it keeps its copy." if n["using"] and n["using"]["name"] == name else None}
        if act == "use":
            if a.get("measured"):
                n["using"] = None
            else:
                found = [x for x in scanners if x["name"] == a.get("name")]
                if not found:
                    raise ToolError("not_found", f"No scanner named {a.get('name')!r}: scanner add it, or one of {[x['name'] for x in scanners]}.")
                n["using"] = dict(found[0])  # by value, so the project reads the same elsewhere
            return {"using": n["using"], **planned(session)}
        if act == "export":
            path = a.get("path") or os.path.join(session.out_dir, "scanners-export.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"kind": "scanruler.scanners", "version": 1, "scanners": scanners}, f, indent=1)
            return {"exported": len(scanners), "path": path}
        if act == "import":
            path = a.get("path")
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, TypeError, ValueError) as e:
                raise ToolError("invalid_input", f"path {path!r}: {e}")
            incoming = data.get("scanners") if isinstance(data, dict) else data
            if not isinstance(incoming, list):
                raise ToolError("invalid_input", "The file holds no scanners list.")
            for p in incoming:
                check(p)
            names = {p["name"] for p in incoming}
            merged = [x for x in scanners if x["name"] not in names] + [entry(p) for p in incoming]
            save(session, merged)
            return {"imported": sorted(names), "scanners": len(merged)}
        raise ToolError("invalid_input", f"action {act!r}")

    scanner_schema = obj({
        "action": {"enum": ["list", "add", "remove", "use", "export", "import"]},
        "scanner": obj({"name": {"type": "string", "minLength": 1}, "noiseMm": {"type": "number", "exclusiveMinimum": 0, "maximum": 5}, "spacingMm": {"type": "number", "exclusiveMinimum": 0}, "note": {"type": "string"}}, ["name", "noiseMm"]),
        "use": {"type": "boolean"}, "name": {"type": "string"}, "measured": {"type": "boolean"}, "path": {"type": "string"},
    }, ["action"])
    return [
        Tool("scan_noise",
             "This scan's noise: the median scatter of small plane fits (sigmaMm, the figure the scan-to-CAD rule — nothing finer than about three times the noise — is written against), p90 and spacingMm (median edge). Kept with the scan as the measured noise. Returns plan, the noise to plan with: the larger of the named scanner's usual noise and this scan's, with finestMm and a warning when the scan reads 1.5× its scanner or more, or no scanner is named. A CAD tessellation is refused: it has no scan noise.",
             obj({}), scan_noise),
        Tool("scanner",
             "Your scanners (name, noiseMm — one standard deviation of its usual noise —, spacingMm, note), kept in scanners.json with your files across projects. action: list; add { scanner, use? }; remove { name }; use { name } or { measured: true } for none (kept with the scan, by value); export { path? }; import { path } (merged by name). Returns plan, the noise to plan with, which thread and wear tools read.",
             scanner_schema, scanner),
    ]
