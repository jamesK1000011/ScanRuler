#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""The settings table Agent Link validates against (agentlink/data/
orca-options.json): for each of Orca's FFF settings its key, type, category,
allowed values, limits, default, unit and which preset holds it — the
interface facts, no labels or descriptions (those stay Orca's).

    python3 options_table.py inventory.json <out.json> <orca version>
"""
import json
import re
import sys

TYPES = {"coFloat": "float", "coFloats": "floats", "coInt": "int", "coInts": "ints", "coString": "string", "coStrings": "strings",
         "coPercent": "percent", "coPercents": "percents", "coFloatOrPercent": "float_or_percent", "coFloatsOrPercents": "floats_or_percents",
         "coPoint": "point", "coPoints": "points", "coPoint3": "point3", "coBool": "bool", "coBools": "bools", "coEnum": "enum",
         "coEnums": "enums", "coNone": "none"}


# The printer's per-extruder settings: PrintConfig keeps them apart from the
# preset option lists, so the preset is given here.
EXTRUDER = {"nozzle_diameter", "nozzle_volume_type", "extruder_offset", "extruder_colour", "max_layer_height", "min_layer_height", "deretraction_speed",
            "retract_after_wipe", "retract_before_wipe", "retract_length_toolchange", "retract_lift_above", "retract_lift_below", "retract_restart_extra",
            "retract_restart_extra_toolchange", "retract_when_changing_layer", "retraction_length", "retraction_minimum_travel", "retraction_speed",
            "wipe", "wipe_distance", "z_hop"}


def num(v):
    if v is None:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def main(inv, out, version):
    d = json.load(open(inv))
    table = {}
    for r in d["settings"]:
        if r["key"] in table:
            continue
        e = {"type": TYPES.get(r["type"], r["type"])}
        if r["key"] in EXTRUDER and not r.get("preset"):
            r = {**r, "preset": "machine"}
        for k in ("category", "sidetext", "preset", "mode"):
            if r.get(k):
                e[k] = r[k]
        if r.get("enum"):
            e["values"] = r["enum"]
        for k in ("min", "max"):
            v = num(r.get(k))
            if v is not None and abs(v) < 1e12:
                e[k] = v
        dv = r.get("default")
        if dv:
            m = re.match(r'^\(?\s*\{?\s*"?([^"{}]*?)"?\s*\}?\s*\)?$', dv)
            if m and len(m.group(1)) < 80 and not m.group(1).startswith("<") and not re.match(r"^[A-Z_]+$", m.group(1).strip()):
                e["default"] = m.group(1).strip()
        if r.get("readonly"):
            e["readonly"] = True
        table[r["key"]] = e
    json.dump({"orca": version, "source": "OrcaSlicer's PrintConfig (keys, types, limits only)", "options": table}, open(out, "w"), indent=0, sort_keys=True)
    print(len(table), "options")


if __name__ == "__main__":
    main(*sys.argv[1:])
