# SPDX-License-Identifier: AGPL-3.0-only
# Print fit — calibrate from a scan: a scanned print read against the CAD it
# was printed from (open and aligned in deviation), what the printer did
# fitted, the slicer's settings to change, and the reference pre-
# compensated. ScanRuler's fit-comp plugin, for Agent Link. Ported from
# ScanRuler by CNC Kitchen: plugins/fit-comp/app/fitCommands.ts.
#
# A good run (χ²/dof up to 4, hole and contour separated) can become the
# printer's one calibration — Agent Link's fit calibrate, which every hole
# and fit it sizes takes — so a scan and a test coupon read the same.
# Slicer key maps are data: the three built in (data/keymaps) and the
# person's own, kept with their files (fit-keymaps.json).

import datetime
import glob
import json
import os

import numpy as np
from agentlink.protocol import Tool, ToolError

from . import fam_deviation as D
from . import fam_noise
from . import fitcomp_core as FC
from . import scanstate as S
from . import wear_core as W

GROUP = "fit-scan"
INFO = "Print fit from a scan (ScanRuler, ported): scale, contour and hole offsets and elephant foot read off a scanned print; slicer changes; a compensated model."
POOR = 4.0
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULTS = {"up": "+z", "band": 1.0, "footBand": 0.2, "footAbove": 2.5, "slicer": "bambustudio", "current": {}, "inner": [], "ignore": []}


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


def fstate(session):
    st = S.state(session)
    return st.setdefault("fitScan", {"settings": json.loads(json.dumps(DEFAULTS)), "runs": []})


def builtin_keymaps():
    out = []
    for p in sorted(glob.glob(os.path.join(HERE, "data", "keymaps", "*.json"))):
        with open(p, encoding="utf-8") as f:
            out.append(json.load(f))
    return out


def tools(session):
    def own_path():
        return os.path.join(session.out_dir, "fit-keymaps.json")

    def own_keymaps():
        try:
            with open(own_path(), encoding="utf-8") as f:
                return json.load(f).get("keymaps", [])
        except (OSError, ValueError):
            return []

    def keymaps():
        own = own_keymaps()
        return [k for k in builtin_keymaps() if k["id"] not in {o["id"] for o in own}] + own

    def keymap(kid):
        k = next((m for m in keymaps() if m["id"] == kid), None)
        if not k:
            raise ToolError("not_found", f"No slicer key map {kid!r}: {', '.join(m['id'] for m in keymaps())}; fit_scan_setup {{ keymap }} adds your own.")
        return k

    def reference_in_build(fs):
        d = D.dstate(session)
        if d["reference"] is None or not d["align"]:
            raise ToolError("invalid_state", "Open the CAD the part was printed from as the reference (deviation_open_reference) and the scan of the print as the scan, then deviation_align.")
        up = fs["settings"]["up"]
        return d["reference"], FC.to_build(up, d["reference"]["V"]), np.asarray(d["reference"]["F"], np.int64)

    def features(fs):
        ref, V, F = reference_in_build(fs)
        f = FC.find_features(V, F)
        ign = set(fs["settings"]["ignore"])
        f["planes"] = [p for p in f["planes"] if p["id"] not in ign]
        f["circles"] = [c for c in f["circles"] if c["id"] not in ign]
        return ref, V, F, f

    def fit_scan_setup(a):
        fs = fstate(session)
        s = fs["settings"]
        if a.get("up") is not None:
            if a["up"] not in FC.UPS:
                raise ToolError("invalid_input", f"up: which way of the CAD stood up on the bed — {', '.join(FC.UPS)}.")
            s["up"] = a["up"]
        for k in ("band", "footBand", "footAbove"):
            if a.get(k) is not None:
                s[k] = float(a[k])
        if a.get("slicer"):
            keymap(a["slicer"])
            s["slicer"] = a["slicer"]
        if a.get("current") is not None:
            s["current"] = {k: float(v) for k, v in a["current"].items()}
        for k in ("inner", "ignore"):
            if a.get(k) is not None:
                s[k] = list(a[k])
        if a.get("keymap"):
            km = a["keymap"]
            if not km.get("id") or not isinstance(km.get("keys"), dict):
                raise ToolError("invalid_input", "keymap: { id, label, keys: { contour|hole|foot|scaleXY|scaleZ: { key, kind: add|percentMeasured|percentShrink|objectScale|unsupported, sign?, section?, note? } } }.")
            own = [k for k in own_keymaps() if k["id"] != km["id"]] + [{"label": km["id"], **km}]
            with open(own_path(), "w", encoding="utf-8") as f:
                json.dump({"kind": "scanruler.fit-keymaps", "version": 1, "keymaps": own}, f, indent=1)
        if a.get("removeKeymap"):
            own = [k for k in own_keymaps() if k["id"] != a["removeKeymap"]]
            with open(own_path(), "w", encoding="utf-8") as f:
                json.dump({"kind": "scanruler.fit-keymaps", "version": 1, "keymaps": own}, f, indent=1)
        return {"settings": s, "keymaps": [{"id": k["id"], "label": k.get("label"), "checked": k.get("checked")} for k in keymaps()], "runs": len(fs["runs"])}

    def fit_scan_features(a):
        fs = fstate(session)
        _ref, _V, _F, f = features(fs)
        out = FC.features_out(f)
        out["inner"] = fs["settings"]["inner"]
        out["note"] = "In the build frame (up as set). Tag a pocket's walls inner (they take the hole offset) and leave out what misleads with ignore."
        return out

    def fit_scan_measure(a):
        fs = fstate(session)
        s = fs["settings"]
        _ref, _V, _F, f = features(fs)
        scan = S.scan_of(session)
        P = FC.to_build(s["up"], scan.V)
        N = FC.to_build(s["up"], W.vertex_normals(scan.V, scan.F))
        rd = FC.measure(f, P, {"band": s["band"], "footBand": s["footBand"], "footAbove": s["footAbove"]}, N)
        if not rd["planes"] and not rd["circles"]:
            raise ToolError("failed", f"No feature had enough scan points within {s['band']} mm: is the scan aligned to the reference, and the right one? (missed: {', '.join(rd['missed'])})")
        sol = FC.solve(rd, set(s["inner"]))
        cs = FC.corrections(sol)
        plan = fam_noise.plan_now(session)
        poor = sol["fit"] > POOR
        j = FC.judge_noise(cs, rd["noise"], plan)
        run = {"n": len(fs["runs"]) + 1, "at": datetime.datetime.now().isoformat(timespec="seconds"), "up": s["up"], "scan": scan.name,
               "solution": sol, "corrections": cs, "noise": rd["noise"], "poor": poor}
        fs["runs"].append(run)

        def e(x):
            return {"value": round(x["value"], 5), "se": round(x["se"], 5), "determined": x["determined"]}

        out = {"run": run["n"], "fit": sol["fit"], "dof": sol["dof"], "poor": poor,
               "scale": {k: e(v) for k, v in sol["scale"].items()}, "contour": e(sol["contour"]), "hole": e(sol["hole"]),
               "foot": sol["foot"] and {k: round(v, 4) if isinstance(v, float) else v for k, v in sol["foot"].items()},
               "corrections": cs, "noise": rd["noise"], "missed": rd["missed"], "outliers": sol["outliers"][:8],
               "readings": {"planes": len(rd["planes"]), "circles": len(rd["circles"])}}
        if j:
            out["scanNoise"] = {"sigmaMm": j["sigmaMm"], "from": j["from"]}
            if j["nearNoise"]:
                out["nearNoise"] = j["nearNoise"]
            notes = FC.noise_notes(j, poor)
            if notes:
                out["noiseNotes"] = notes
        if poor:
            out["warning"] = (f"χ²/dof {sol['fit']} over {POOR:g}: this simple model does not explain the part — warping, a lifted corner or a poor alignment. "
                              "Do not trust the offsets: look at the outliers and the deviation map, fix the cause, measure again.")
        else:
            km = keymap(s["slicer"])
            out["slicer"] = {"keymap": km["id"], "changes": FC.slicer_changes(cs, km, s["current"])}
        if a.get("calibrate"):
            if poor or not (sol["hole"]["determined"] and sol["contour"]["determined"]):
                out["calibrated"] = False
                out["calibrateWhy"] = "Only a run that fits well and separates the hole and contour offsets becomes the printer's calibration."
            else:
                cal = session.fit({"action": "calibrate", "hole": round(2 * sol["hole"]["value"], 3), "shaft": round(2 * sol["contour"]["value"], 3)})
                out["calibrated"] = cal.get("calibration")
        return out

    def last_good(fs):
        if not fs["runs"]:
            raise ToolError("invalid_state", "No run yet: fit_scan_measure first.")
        run = fs["runs"][-1]
        if run["poor"]:
            raise ToolError("invalid_state", f"The last run fits poorly (χ²/dof {run['solution']['fit']}): its offsets are not to be used. Fix the cause and measure again.")
        return run

    def fit_scan_export(a):
        fs = fstate(session)
        s = fs["settings"]
        run = last_good(fs)
        what = a.get("what", "ini")
        if what in ("ini", "json"):
            km = keymap(a.get("slicer") or s["slicer"])
            ch = FC.slicer_changes(run["corrections"], km, s["current"])
            path = a.get("path") or os.path.join(session.out_dir, f"fit-run-{run['n']}-{km['id']}.{what}")
            with open(path, "w", encoding="utf-8") as f:
                if what == "ini":
                    f.write(FC.ini_fragment(ch, km, f"Print fit run {run['n']} ({run['at']}), from a scan of {run['scan']}"))
                else:
                    json.dump({"run": run["n"], "keymap": km["id"], "changes": ch, "corrections": run["corrections"]}, f, indent=1)
            return {"file": {"path": path, "name": os.path.basename(path)}, "changes": ch,
                    "note": "Added to the values in use (fit_scan_setup current); paste them into the slicer's process or filament, or let slicer_presets carry them."}
        if what == "stl":
            ref, V, F = reference_in_build(fs)
            _r, _V, _F, f = features(fs)
            sol = run["solution"]
            c = {"sx": sol["scale"]["x"]["value"], "sy": sol["scale"]["y"]["value"], "sz": sol["scale"]["z"]["value"] if sol["scale"]["z"]["determined"] else 1.0,
                 "contour": sol["contour"]["value"] if sol["contour"]["determined"] else 0.0, "hole": sol["hole"]["value"] if sol["hole"]["determined"] else 0.0,
                 "foot": sol["foot"]["value"] if sol["foot"] and sol["foot"]["value"] > 0 else 0.0, "footFade": s["footBand"]}
            Vc = FC.from_build(s["up"], FC.compensate(V, F, f, c))
            stem = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in os.path.splitext(ref["name"])[0])
            path = a.get("path") or os.path.join(session.out_dir, f"{stem}-compensated.stl")
            W.write_stl(path, Vc, F)
            return {"file": {"path": path, "name": os.path.basename(path)}, "applied": {k: round(v, 5) for k, v in c.items()},
                    "note": "In the reference's own frame; print it with the slicer's compensations at zero, or the error is undone twice."}
        raise ToolError("invalid_input", "what: ini, json or stl.")

    return [
        Tool("fit_scan_setup",
             "Settings for reading a print against its CAD: up (which way of the CAD stood up on the bed: +z the default), band (mm off the surface a point still counts, 1), "
             "footBand (first-layer height, 0.2), footAbove (2.5), slicer (the key map: bambustudio, orcaslicer, prusaslicer, or your own), current ({ key: value } — the "
             "slicer values in use, which changes are added to), inner (wall ids of pockets: they take the hole offset), ignore (feature ids left out), keymap (add your own "
             "map, kept in fit-keymaps.json with your files), removeKeymap. With nothing, reads them.",
             obj({"up": {"enum": FC.UPS}, "band": {"type": "number", "exclusiveMinimum": 0}, "footBand": {"type": "number", "exclusiveMinimum": 0},
                  "footAbove": {"type": "number", "exclusiveMinimum": 0}, "slicer": {"type": "string"}, "current": {"type": "object"},
                  "inner": {"type": "array", "items": {"type": "string"}}, "ignore": {"type": "array", "items": {"type": "string"}},
                  "keymap": {"type": "object"}, "removeKeymap": {"type": "string"}}),
             fit_scan_setup),
        Tool("fit_scan_features",
             "The features of the reference the print is read on, in the build frame: flat walls, floors and tops square to an axis (ids like +X1, -Z2) and upright holes and "
             "bosses (H1, B1) with centre and radius. Needs the reference open and the scan aligned in deviation. Changes nothing.",
             obj({}), fit_scan_features),
        Tool("fit_scan_measure",
             "Read the scanned print against its CAD (deviation reference, aligned): each feature on the scan, then one weighted least-squares fit — scale X, Y, Z; contour "
             "offset (outer walls out, mm); hole offset (holes closed, mm); elephant foot — each with its error and whether this part separates it; χ²/dof (over 4: poor, "
             "the offsets are not to be used); corrections (what is worth changing); the slicer's new values from current; scanNoise and nearNoise against the noise to plan "
             "with. calibrate: true makes a good run the printer's fit calibration (holes and shafts, diametral) that every hole Agent Link sizes takes. Kept as a run.",
             obj({"calibrate": {"type": "boolean"}}), fit_scan_measure),
        Tool("fit_scan_export",
             "The last good run as what: ini (the slicer's keys, one a line, for its key map — slicer to choose another), json, or stl (the reference pre-compensated: scaled "
             "by the inverse, walls moved back by the contour offset, holes opened by the hole offset, the first layer drawn in; print it with the slicer's compensations at "
             "zero). path, or with your files. Refused for a poor run.",
             obj({"what": {"enum": ["ini", "json", "stl"]}, "slicer": {"type": "string"}, "path": {"type": "string"}}),
             fit_scan_export),
    ]
