# SPDX-License-Identifier: AGPL-3.0-only
# Wall thickness: measured everywhere on the scan at once, no reference.
# ScanRuler's thickness commands, for Agent Link.
# Ported from ScanRuler by CNC Kitchen: src/commands/core/thickness.ts,
# src/commands/state.ts (describeThickness), src/state/thicknessStore.ts
# (the settings and their defaults), src/core/meshWorker.ts (epsilon)

import math

import numpy as np
from agentlink.protocol import Tool, ToolError

from . import scanstate as S
from .dev_hotspots import hotspots
from .dev_map import vertex_normals
from .dev_surface import NominalSurface
from .wall_thickness import (
    DEFAULT_CONE_ANGLE_DEG,
    DEFAULT_NORMAL_DEVIATION_DEG,
    compute_thickness,
    default_max_thickness,
    suggest_thickness_scale,
    thickness_report,
    thickness_stats,
)

GROUP = "thickness"
INFO = "Wall thickness over the whole scan (ScanRuler, ported): rays through the scan's own surface, statistics and thin spots."
KEY = "thickness"
THIN_SPOTS = 8


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


def tstate(session):
    st = S.state(session)
    if KEY not in st:
        st[KEY] = {
            "method": "ray",
            "maxThickness": 10.0,
            "maxThicknessAuto": True,
            "coneRays": 0,
            "coneAngleDeg": DEFAULT_CONE_ANGLE_DEG,
            "normalDeviationDeg": DEFAULT_NORMAL_DEVIATION_DEG,
            "low": 0.0,
            "high": 3.0,
            "scaleAuto": True,
            "bands": None,
            "limit": 1.0,
            "values": None,
            "scan": None,
            "V": None,
        }
    t = st[KEY]
    if t["scan"] is not None and (t["scan"] is not st["scan"] or t["V"] is not st["scan"].V):
        t.update(values=None, scan=None, V=None)
    return t


def r3(v):
    return round(float(v), 3)


def describe(t):
    v = t["values"]
    stats = None
    if v is not None:
        s = thickness_stats(v, t["limit"])
        stats = {k: (round(x, 4) if isinstance(x, float) else x) for k, x in s.items()}
        stats["belowLimitPct"] = round(100 * s["belowLimit"] / s["measured"], 1) if s["measured"] else 0
    return {
        "status": "ready" if v is not None else "none",
        "stats": stats,
        "settings": {k: t[k] for k in ("method", "maxThickness", "coneRays", "coneAngleDeg", "normalDeviationDeg", "low", "high", "bands", "limit")},
    }


def apply_search(t, a):
    if "method" in a:
        t["method"] = a["method"]
    if "maxThickness" in a:
        t["maxThickness"] = max(1e-3, a["maxThickness"])
        t["maxThicknessAuto"] = False
    if "coneRays" in a:
        t["coneRays"] = int(a["coneRays"])
    if "coneAngleDeg" in a:
        t["coneAngleDeg"] = min(89, max(0, a["coneAngleDeg"]))
    if "normalDeviationDeg" in a:
        n = a["normalDeviationDeg"]
        t["normalDeviationDeg"] = None if n is None else min(90, max(0, n))


def thin_spots(scan, values, limit):
    """Where the wall is under the limit, as patches (hotspots.ts on how far
    under it each point is)."""
    with np.errstate(invalid="ignore"):
        under = np.isfinite(values) & (values < limit)
    if not under.any():
        return {"count": 0, "found": 0, "patches": []}
    r = hotspots(scan.V, np.where(under, limit - values, 0.0), 0.0, limit=THIN_SPOTS, only=under, feature_depth=math.inf)
    out = []
    for p in r["patches"]:
        mem = p["members"]
        out.append(
            {
                "centroid": [r3(x) for x in p["centroid"]],
                "box": {"min": [r3(x) for x in p["min"]], "max": [r3(x) for x in p["max"]]},
                "count": p["count"],
                "area": r3(p["area"]),
                "minThickness": r3(limit - p["extreme"]),
                "meanThickness": r3(limit - p["mean"]),
                "at": [r3(x) for x in p["at"]],
                "vertex": p["index"],
                "vertices": [int(x) for x in mem[:: max(1, len(mem) // 12)][:12]],
            }
        )
    return {"count": int(under.sum()), "found": r["found"], "patches": out}


def tools(session):
    def measure(a):
        scan = S.scan_of(session)
        t = tstate(session)
        apply_search(t, a)
        diag = float(np.linalg.norm(scan.V.max(axis=0) - scan.V.min(axis=0)))
        if t["maxThicknessAuto"]:
            t["maxThickness"] = default_max_thickness(diag)
        surface = NominalSurface(scan.V, scan.F)
        nd = t["normalDeviationDeg"]
        v = compute_thickness(
            surface,
            scan.V,
            vertex_normals(scan.V, scan.F),
            method=t["method"],
            cone_rays=t["coneRays"],
            cone_angle=math.radians(t["coneAngleDeg"]),
            max_normal_deviation=None if nd is None else math.radians(nd),
            max_thickness=t["maxThickness"],
            epsilon=max(1e-6, diag * 1e-5),
        )
        if not np.isfinite(v).any():
            t.update(values=None, scan=None, V=None)
            raise ToolError("failed", f"No wall found within {t['maxThickness']} mm anywhere: raise maxThickness, or the scan is a single open sheet.")
        t.update(values=v, scan=scan, V=scan.V)
        if t["scaleAuto"]:
            t["low"], t["high"] = suggest_thickness_scale(v)
        stats = thickness_stats(v, t["limit"])
        return {"thickness": describe(t), "thinSpots": thin_spots(scan, v, t["limit"]), "report": thickness_report(scan.name, stats, {**t})}

    def settings(a):
        t = tstate(session)
        apply_search(t, a)
        if "low" in a:
            t["low"] = max(0, a["low"])
            t["high"] = max(t["high"], t["low"] + 1e-3)
            t["scaleAuto"] = False
        if "high" in a:
            t["high"] = max(1e-3, a["high"])
            t["low"] = min(t["low"], t["high"] - 1e-3)
            t["scaleAuto"] = False
        if "bands" in a:
            t["bands"] = a["bands"]
        if "limit" in a:
            t["limit"] = a["limit"]
        out = {"thickness": describe(t)}
        if t["values"] is not None and "limit" in a:
            out["thinSpots"] = thin_spots(t["scan"], t["values"], t["limit"])
        return out

    search = {
        "method": {"type": "string", "enum": ["ray", "sphere"], "description": "ray: along the inward normal to the far wall (the shortest of a cone with coneRays). sphere: the largest sphere that fits at the point."},
        "maxThickness": {"type": "number", "exclusiveMinimum": 0, "description": "The thickest wall searched for, mm."},
        "coneRays": {"type": "integer", "minimum": 0, "maximum": 256},
        "coneAngleDeg": {"type": "number", "minimum": 0, "maximum": 89},
        "normalDeviationDeg": {"oneOf": [{"type": "number", "minimum": 0, "maximum": 180}, {"type": "null"}], "description": "How far the far wall may turn from facing back, degrees, or null for any."},
    }
    return [
        Tool(
            "thickness_measure",
            "Measure the wall thickness at every point of the scan, with the search settings given or those in hand. Returns the statistics (min, max, mean, sigma, share under the thin-wall limit, points measured), the settings, the thin spots (points under the limit gathered into patches, thinnest first by how far under) and the plain-text report. Trap: thin readings along open rims are rays escaping, not thin walls.",
            obj(search),
            measure,
        ),
        Tool(
            "thickness_settings",
            "The search settings (method, maxThickness, coneRays, coneAngleDeg, normalDeviationDeg — they take effect at the next thickness_measure) and the reading: low and high, the ends of the colour scale, mm; bands; limit, the thin-wall limit the statistics count under, mm. Returns the thickness state.",
            obj({**search, "low": {"type": "number", "minimum": 0}, "high": {"type": "number", "exclusiveMinimum": 0}, "bands": {"oneOf": [{"type": "integer", "minimum": 2}, {"type": "null"}]}, "limit": {"type": "number", "exclusiveMinimum": 0}}),
            settings,
        ),
    ]
