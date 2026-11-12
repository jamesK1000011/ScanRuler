# SPDX-License-Identifier: AGPL-3.0-only
# Thread match on the scan: a thread named from the points about a fitted
# bore's or boss's axis. ScanRuler's thread-match plugin (thread.identify,
# with reverse.thread.read under it), for Agent Link.
# Ported from ScanRuler by CNC Kitchen: plugins/thread-match/app/
# threadCommands.ts (the answer and its note).
#
# Agent Link's own thread_identify names a CAD face by its diameter; this
# reads the scan's teeth: pitch, hand, starts, flank angle and taper.

import math

from agentlink.protocol import Tool, ToolError

from . import fam_noise
from . import noise_core as N
from . import scanstate as S
from . import thread_core as T
from .model import Refusal, find_element

GROUP = "scan-thread"
INFO = "Thread match on the scan (ScanRuler, ported): ISO metric, UNC/UNF/UNEF, NPT, G/R pipe, Tr, ACME and the 45° print form named from a fitted bore or boss."
POINTS = 200_000
BAND_MM, BAND_SHARE = 0.6, 0.2
# The forms FreeCAD's PartDesign Hole cuts (thread_cut).
CUTS = {"metric": "metric", "unc": "unc", "unf": "unf"}


def obj(props, required=()):
    return {"type": "object", "properties": props, "required": list(required), "additionalProperties": False}


def _note(v, internal, flank):
    what = "bore" if internal is True else "boss" if internal is False else "thread"
    if v["verdict"] == "none":
        return (f"The {what} repeats, but no size in the families tried fits within tolerance — see candidates (detail: full), or try other families. "
                "A worn, printed or non-standard thread reads this way.")
    if v["verdict"] == "ambiguous":
        sep = v["deciding"][0]["separation"] if v["deciding"] else "a little"
        return f"This scan cannot tell {' from '.join(v['tied'])} apart. Ask the person for the first measurement in deciding; it separates them by {sep}."
    best = v["best"]
    flank_word = "" if flank == "high" else " The flank angle was not trusted on this pitch, so the form rests on pitch and diameter."
    ruled = ""
    if v["ruledOut"]:
        one = len(v["ruledOut"]) == 1
        by = []
        for r in v["ruledOut"]:
            for b in r["by"]:
                w = "the flank angle" if b.startswith("flank") else "the taper" if "taper" in b else "the tooth depth"
                if w not in by:
                    by.append(w)
        ruled = (f" {', '.join(r['designation'] for r in v['ruledOut'])} {'fits' if one else 'fit'} by pitch and diameter too and "
                 f"{'was' if one else 'were'} set aside by {' and '.join(by)}.")
    return f"{best['designation']} ({v['confidence']} confidence).{flank_word}{ruled}"


def _axis(st, a):
    ax = a["axis"]
    if "element" in ax:
        try:
            el = find_element(st, ax["element"])
        except Refusal as e:
            raise ToolError(e.code, str(e))
        fit = el.get("fit") or {}
        if fit.get("kind") != "cylinder":
            raise ToolError("invalid_input", f"{el['name']} is a {el['kind']} — a thread is read along a cylinder fitted in the bore or on the boss (element_fit kind cylinder).")
        return fit["center"], fit["axis"], fit["radius"], fit["length"], {"element": {"id": el["id"], "name": el["name"]}}
    if not all(k in ax for k in ("origin", "direction", "radius")):
        raise ToolError("invalid_input", "axis: { element } (a fitted cylinder) or { origin, direction, radius, length? }.")
    return ax["origin"], ax["direction"], float(ax["radius"]), ax.get("length"), {}


def tools(session):
    def scan_thread(a):
        st = S.state(session)
        scan = S.scan_of(session)
        origin, direction, radius, span, on = _axis(st, a)
        d = [float(x) for x in direction]
        ln = math.sqrt(sum(x * x for x in d))
        if not ln > 0:
            raise ToolError("invalid_input", "axis.direction: give a direction, not a zero vector.")
        d = [x / ln for x in d]
        band = a.get("band") or max(BAND_MM, BAND_SHARE * radius)
        length = a.get("length") or span
        if not length:
            # Along the whole scan.
            import numpy as np

            z = (scan.V - np.asarray(origin, float)) @ np.asarray(d)
            length = 2 * float(np.abs(z).max())
        P, Nn = scan.V, scan.graph().N
        if len(P) > POINTS:
            step = len(P) // POINTS + 1
            P, Nn = P[::step], Nn[::step]
        rd = T.read_thread(P, Nn, origin, d, radius, band, length / 2)
        if rd is None:
            raise ToolError("failed", f"Under 20 scan points on the wall within {band:g} mm of radius {radius:g} mm: check the axis, or widen band.")
        if not T.is_thread(rd):
            return {"verdict": "none", "thread": False, **on,
                    "reads": {"pitch": rd["pitch"], "contrast": rd["contrast"], "noise": rd["noise"], "strength": rd["strength"], "points": rd["points"]},
                    "note": "No repeat stands clear of the scan's noise: a plain wall, or teeth the scan did not resolve (fine pitch, a coarse scanner)."}
        rng = rd["threaded"] or rd["span"]
        shape = T.read_shape(P, origin, d, radius, band, rng[0], rng[1], rd["pitch"])
        plan = fam_noise.plan_now(session)
        own = max(rd["noise"], (shape or {}).get("noise", 0))
        reading = T.reading_of(rd, shape, plan["sigmaMm"] if plan else 0.0)
        families = a.get("families") or T.FAMILY_IDS
        v = T.decide(reading, families, a.get("pitchFloor") or T.PITCH_FLOOR)
        best = v["best"]
        fam = next((f for f in T.FAMILIES if best and f["id"] == best["family"]), None)
        out = {"verdict": v["verdict"], **({"confidence": v["confidence"]} if v["confidence"] else {}), **on,
               "best": None if not best else {
                   "designation": best["designation"], "family": best["family"], "form": fam["label"], "major": best["major"], "pitch": best["pitch"],
                   **({"tpi": best["tpi"]} if best.get("tpi") else {}), "angle": best["angle"], "taper": "1:16" if best["taper"] else "parallel",
                   "source": fam["source"], "pitchOff": best["pitchOff"], "diameterOff": best["diameterOff"], **({"note": best["note"]} if best.get("note") else {})}}
        if v["verdict"] == "ambiguous":
            out.update(tied=v["tied"], deciding=v["deciding"])
        if v["ruledOut"]:
            out["ruledOut"] = v["ruledOut"]
        out["reads"] = {
            "pitch": reading["pitch"], "pitchSigma": reading["pitchSigma"], "tpi": round(25.4 / reading["pitch"], 2), "major": rd["major"], "minor": rd["minor"],
            "internal": rd["internal"], "leftHanded": shape["leftHanded"] if shape else rd["leftHanded"],
            **({"starts": shape["starts"], "lead": shape["lead"]} if shape else {}),
            "flankAngle": reading["flankAngle"], "flankConfidence": reading["flankConfidence"], "taper": v["taperRead"],
            **({"taperPerMm": shape["taper"], "taperSigma": shape["taperSigma"], "depthShare": shape["depthShare"], "foldSharpness": shape["sharpness"]} if shape else {}),
            "noise": reading["noise"], "length": round(reading["length"], 2), "points": rd["points"]}
        if plan:
            out["scanNoise"] = {**N.answer(plan), **({"raised": own} if plan["sigmaMm"] > own else {})}
        out["tolerance"] = v["tolerance"]
        if a.get("detail") == "full":
            out["candidates"] = [{"designation": c["designation"], "score": c["score"], "pitchOff": c["pitchOff"], "diameterOff": c["diameterOff"],
                                  "consistent": c["consistent"], **({"against": c["against"]} if c["against"] else {})} for c in v["candidates"]]
            if shape:
                out["tooth"] = shape["tooth"]
        out["note"] = _note(v, rd["internal"], reading["flankConfidence"])
        if best and v["verdict"] == "match" and best["family"] in CUTS:
            out["next"] = f"On the model: thread_cut {{ size: \"{best['designation'].replace('×', 'x')}\" }} on the matching hole (FreeCAD's PartDesign Hole)."
        st.setdefault("threads", []).append({"verdict": v["verdict"], "best": best["designation"] if best else None, "tied": v["tied"], "at": [round(float(x), 3) for x in origin]})
        return out

    fams = {"type": "array", "items": {"enum": T.FAMILY_IDS}, "minItems": 1, "description": f"Families to try: {', '.join(T.FAMILY_IDS)}; all by default."}
    axis = {"type": "object", "description": "{ element } — a cylinder fitted in the bore or on the boss (element_fit kind cylinder) — or { origin, direction, radius, length? }.",
            "properties": {"element": {"type": ["integer", "string"]}, "origin": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
                           "direction": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3}, "radius": {"type": "number", "exclusiveMinimum": 0},
                           "length": {"type": "number", "exclusiveMinimum": 0}}, "additionalProperties": False}
    return [
        Tool("scan_thread",
             "Name a scanned thread: the points about a fitted cylinder's axis read for pitch (the sectors' autocorrelation, window by window), crests and roots, the hand, "
             "then folded along the helix for a sharper pitch, starts, the flank angle and the taper, and decided against ISO metric, UNC, UNF, UNEF, NPT, G/R pipe, Tr, ACME "
             "and the 45° print form. verdict: match (high or low confidence), ambiguous (tied: the sizes this scan can't tell apart, deciding: the hand measurement that "
             "would, and what each reads) or none. The diameter tolerance goes by the wall's noise raised to the scan noise to plan with (scan_noise, scanner), so a noisy "
             "scanner ties sizes it can't resolve. pitchFloor: the least share a pitch is resolved to (0.01; raise it for a scanner whose scale you trust less). "
             "Trap: a bore is matched on its crests (the minor diameter), a boss on its own (the major).",
             obj({"axis": axis, "families": fams, "band": {"type": "number", "exclusiveMinimum": 0, "description": "mm either side of the radius a point counts; max(0.6, 0.2·radius) by default."},
                  "length": {"type": "number", "exclusiveMinimum": 0, "description": "mm along the axis, centred on its origin; the cylinder's length by default."},
                  "pitchFloor": {"type": "number", "minimum": 0.002, "maximum": 0.05}, "detail": {"enum": ["brief", "full"]}}, ["axis"]),
             scan_thread),
    ]


def read_for_agent_link(session, args):
    """scan_thread for Agent Link's thread_identify { scan }."""
    t = next(x for x in tools(session) if x.name == "scan_thread")
    return t.fn(args)


def register():
    try:
        from agentlink.families import thread
    except ImportError:
        return
    hook = getattr(thread, "SCAN_READERS", None)
    if hook is not None and read_for_agent_link not in hook:
        hook.append(read_for_agent_link)
