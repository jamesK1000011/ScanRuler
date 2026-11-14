#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""The OrcaSlicer audit: every row of inventory.json judged.

- tool <name>: an Agent Link tool does it headless (counted only when that
  tool exists in Agent Link's source, so the number moves as tools land)
- view: only meaningful in Orca's window (camera, display toggles, layout)
- na: not slicing (help, about, debug, SLA, bookkeeping keys, placeholders)
- later: the printer connection and Orca's cloud (roadmap: lowest)

    python3 judge.py inventory.json <AgentLink dir>:<AgentLink-OrcaSlicer dir> [out.json]
"""

import json
import os
import re
import sys
from collections import Counter

# ---- settings -----------------------------------------------------------------------------

# Bookkeeping, not settings a person sets: which preset, where from, ids.
BOOKKEEPING = re.compile(r"^(preset_names?|.*_settings_id|inherits(_group)?|compatible_.*|different_settings_to_system|print_compatible_printers|"
                         r"default_(filament|print)_profile|printer_model|printer_variant|filament_ids|filament_vendor|upward_compatible_machine|"
                         r"host_type|print_host.*|printhost_.*|bbl_.*|thumbnails_format|spaghetti_detector|enable_.*_check)$")
# Set per plate (model_settings.config <plate>), not per preset.
PLATE = {"curr_bed_type", "first_layer_print_sequence", "other_layers_print_sequence", "other_layers_print_sequence_nums", "first_layer_sequence_choice",
         "other_layers_sequence_choice", "print_sequence", "spiral_mode", "filament_map", "filament_map_2", "filament_map_mode", "filament_volume_map",
         "filament_nozzle_map"}
# The project's filament list and colours (project_settings.config).
FILAMENTS = re.compile(r"^(filament_colour|filament_multi_colour|filament_colour_type|filament_is_mixed|filament_mixed_.*|extruder_colour|default_filament_colour)$")
# Painted on faces, per object (gizmos) — the keys only switch the feature on.
PAINT_KEYS = {"brim_ears"}
# The printer's network and cloud.
LATER = re.compile(r"^(print_host|printhost|bbl|host_type|.*_cloud|machine_load_filament|network).*")


def judge_setting(r):
    k = r["key"]
    if r.get("readonly"):
        return "na", None, "read-only: Orca sets it"
    if BOOKKEEPING.match(k):
        return "na", None, "which preset or where it came from, not a setting"
    if LATER.match(k):
        return "later", None, "printer connection"
    if k in PLATE:
        return "tool", "orca_project.plate", "per plate: orca_project set { scope: plate }"
    if FILAMENTS.match(k):
        return "tool", "orca_project.filament", "the project's filaments: orca_project filament"
    if k in PAINT_KEYS:
        return "tool", "orca_project.brim_ears", ""
    if r.get("preset") == "process":
        return "tool", "orca_project.set", "process setting: project, object, part or height range (orca_project set)"
    if r.get("preset") in ("filament", "machine"):
        return "tool", "orca_project.set", f"{r['preset']} setting: orca_project set (slot for a filament's)"
    return "tool", "orca_project.set", "project setting (orca_project set)"


# ---- the command line ---------------------------------------------------------------------
# "tool.action": the tool, and the action (or export, or option) its source names.

CLI = {
    "slice": "orca_slice", "export_3mf": "orca_slice.3mf", "export_gcode": "orca_slice.gcode", "load_settings": "orca_project.new", "load_filaments": "orca_project.new",
    "orient": "orca_project.orient", "arrange": "orca_project.arrange", "outputdir": "orca_slice", "export_statistics": "orca_slice", "load": "orca_project.new",
    "export_stl": "orca_slice.stl", "export_stls": "orca_slice.stls", "export_obj": "orca_slice.obj", "export_settings": "orca_slice.settings",
    "export_slicedata": "orca_slice.slicedata", "load_slicedata": "na", "export_amf": "orca_slice.amf", "export_svg": "gap",
    "info": "orca_slice.info", "inspect_mesh": "orca_slice.inspect_mesh", "inspect_paint": "orca_slice.inspect_paint", "load_custom_gcodes": "orca_project.gcode",
    "load_filament_ids": "orca_slice.load_filament_ids", "allow_multicolor_oneplate": "orca_slice.allow_multicolor_oneplate",
    "allow_rotations": "orca_project.allow_rotations", "align_to_y_axis": "orca_project.align_to_y_axis",
    "avoid_extrusion_cali_region": "orca_project.avoid_extrusion_cali_region", "skip_objects": "orca_slice.skip_objects",
    "clone_objects": "orca_project.clone_objects", "allow_mix_temp": "orca_slice.allow_mix_temp", "uptodate": "orca_project.uptodate",
    "uptodate_settings": "orca_project.presets", "uptodate_filaments": "orca_project.presets", "load_defaultfila": "orca_slice.load_defaultfila", "min_save": "orca_project.min_save",
    "allow_newer_file": "orca_project.allow_newer_file", "enable_timelapse": "orca_slice.timelapse", "skip_modified_gcodes": "orca_slice.skip_modified_gcodes",
    "load_assemble_list": "orca_project.merge", "assemble": "orca_project.merge",
    # transforms: FreeCAD does them on the body, Orca's own on the project
    "align_xy": "orca_project.place", "center": "orca_project.place", "ensure_on_bed": "orca_project.ensure_on_bed", "rotate": "orca_project.place",
    "rotate_x": "orca_project.place", "rotate_y": "orca_project.place", "scale": "orca_project.place", "scale_to_fit": "orca_project.scale_to_fit", "cut": "orca_project.cut",
    "cut_grid": "orca_project.cut_grid", "cut_x": "orca_project.cut", "cut_y": "orca_project.cut", "split": "orca_project.split_objects", "repair": "orca_project.repair",
    "convert_unit": "orca_project.convert_unit", "copy": "orca_project.instance", "duplicate_grid": "orca_project.grid", "repetitions": "orca_project.repetitions",
    "ground_largest_face": "orca_project.ground_largest_face", "ground_face_normal": "orca_project.ground_face_normal", "ground_face_point": "orca_project.ground_face_point",
}
CLI_NA = {"help", "help_fff", "help_sla", "debug", "logfile", "datadir", "sw_renderer", "single_instance", "autosave", "pipe", "gcodeviewer",
          "export_sla", "no_check", "strict", "normative_check", "mtcpp", "mstpp", "ignore_nonexistent_config", "config_compatibility",
          "downward_check", "downward_settings", "output", "metadata_name", "metadata_value", "makerlab_name", "makerlab_version"}


def judge_cli(r):
    k = r["key"]
    if k in CLI_NA:
        return "na", None, "the command line's own plumbing (help, logs, folders, checks, MakerWorld stamps)"
    t = CLI.get(k)
    if t == "na":
        return "na", None, "a slice cache the command line reuses: slicing again does the same"
    if t == "gap":
        return "gap", None, "not built"
    if t:
        return "tool", t, ""
    return "gap", None, "not judged yet"


# ---- the window ---------------------------------------------------------------------------

MENU = [
    # files and projects
    (r"^Load\.\.\.|^Import$|^Recent files", "tool", "orca_project.new"),
    (r"^Import ZIP Archive", "tool", "orca_project.file"),
    (r"Re&load from Disk|^Reload from disk|^Reload All|^Replace 3D file|^Replace all with 3D files", "tool", "orca_project.replace"),
    (r"^Export G-code|^Export all plate sliced file|^Export$", "tool", "orca_slice.gcode"),
    (r"^Export Generic 3MF", "tool", "orca_slice.3mf"),
    (r"Export as (one )?STLs?|Export all objects as", "tool", "orca_slice.stl"),
    (r"Export as (one )?DRCs?", "tool", "orca_slice.drcs"),
    (r"Export &?[Tt]oolpaths as OBJ", "tool", "gcode_read.toolpaths"),
    (r"^Export Preset Bundle|^Preset Bundle|^Import Configs|^Sync Presets|^Migrate Filament Presets", "tool", "slicer_presets"),
    (r"^&Open G-code", "tool", "gcode_read"),
    # objects
    (r"^Add (Models|Handy models)", "tool", "orca_project.object_add"),
    (r"^Add Primitive|^Cube$|^Cylinder$|^Sphere$|^Cone$|^Disc$|^Torus$", "tool", "orca_project.primitive"),
    (r"^Add instance|^Remove instance|^Set number of instances|^Instances|^Clone", "tool", "orca_project.instance"),
    (r"^Fill bed with (copies|instances)", "tool", "orca_project.fill_bed"),
    (r"^Duplicate Current Plate", "tool", "orca_project.plate_duplicate"),
    (r"^Set as An Individual Object|^To Objects", "tool", "orca_project.split_objects"),
    (r"^To Parts|^Merge with", "tool", "orca_project.merge"),
    (r"^Delete$|^Delete All", "tool", "orca_project.object_remove"),
    (r"^Rename|^Edit$|^Modify", "tool", "orca_project.set"),
    (r"^Printable", "tool", "orca_project.printable"),
    (r"^Hide|^Order By", "view", None),
    (r"^Height Range Modifier", "tool", "orca_project.range"),
    (r"^Choose precise seam subtype", "tool", "orca_project.set"),
    (r"^Arrange", "tool", "orca_project.arrange"),
    (r"^Auto orientation|^Auto Rotate", "tool", "orca_project.orient"),
    (r"^Drop|^Center|^Align/Distribute|^Along [XYZ] Axis|^Transform|^Assemble", "tool", "orca_project.place"),
    (r"^Mirror", "tool", "orca_project.mirror"),
    (r"^Scale to build volume", "tool", "orca_project.scale_to_fit"),
    (r"^Split$", "tool", "orca_project.split"),
    (r"^Mesh boolean", "tool", "orca_project.boolean"),
    (r"^Simplify Model", "tool", "orca_project.simplify"),
    (r"^Subdivision mesh", "tool", "orca_project.subdivide"),
    (r"^Fix Model|^Fix All", "tool", "orca_project.fix"),
    (r"^Decompose Color", "tool", "orca_project.decompose_color"),
    (r"^Flush into", "tool", "orca_project.set"),
    (r"^Remove the selected plate", "tool", "orca_project.plate_remove"),
    (r"^All Plates|^Select All Plates|^Fix All Plates", "tool", "orca_slice"),
    # calibration
    (r"^Temperature$", "tool", "orca_calibrate.temperature"),
    (r"^Flow ratio|^Flow rate", "tool", "orca_calibrate.flow"),
    (r"^Pressure advance", "tool", "orca_calibrate.pressure_advance"),
    (r"^Retraction$", "tool", "orca_calibrate.retraction"),
    (r"^VFA$", "tool", "orca_calibrate.vfa"),
    (r"^Max flowrate", "tool", "orca_calibrate.max_flow"),
    (r"^Cornering", "tool", "orca_calibrate.cornering"),
    (r"^Input Shaping", "tool", "orca_calibrate.input_shaping_freq"),
    (r"^Calibration Guide", "na", None),
    # the window itself
    (r"^Select All|^Deselect All|^Show |^Use (Orthogonal|Perspective) View|^Auto Perspective|^Reset Window Layout|^Show Gridlines|^Show &|^Show all collision", "view", None),
    # not slicing
    (r"^New Window|^Open PrusaSlicer|^Open &Slicer|^&Quit|^Quit$|^Setup Wizard|^Check for Updates|^Show Configuration Folder|^Show Tip|^Troubleshoot|^Benchmark|^Open Network Test|^Plugins|^More$", "na", None),
    (r"^Download Models|^Upload Models", "later", None),
]
CONTEXT = {
    "add_svg": "orca_project.emboss", "add_text": "orca_project.emboss", "edit_svg": "orca_project.emboss", "edit_text": "orca_project.emboss",
    "align_distribute": "orca_project.place", "auto_drop": "orca_project.place", "set_auto_drop": "orca_project.place", "center": "orca_project.place",
    "change_extruder": "orca_project.extruder", "change_filament": "orca_project.extruder", "change_type": "orca_project.kind",
    "clone": "orca_project.instance", "delete": "orca_project.object_remove", "drop": "orca_project.place", "export_drc": "orca_slice.drc",
    "export_stl": "orca_slice.stl", "fill_bed": "orca_project.fill_bed", "fix_through_cgal": "orca_project.fix", "instance_to_object": "orca_project.instance_to_object",
    "invalidate_cut_info": "na", "layers_editing": "orca_project.layer_heights", "locked": "orca_project.locked", "merge_to_multipart_object": "orca_project.merge",
    "merge_to_single_object": "orca_project.merge", "modify": "orca_project.set", "per_object_process": "orca_project.set", "per_object_settings": "orca_project.set",
    "plate_delete": "orca_project.plate_remove", "plate_name": "orca_project.plater_name", "precise_seam_submenu": "orca_project.set", "printable": "orca_project.printable",
    "set_printable": "orca_project.printable", "reload_from_disk": "orca_project.replace", "rename": "orca_project.set", "replace_all_with_stl": "orca_project.replace",
    "replace_with_stl": "orca_project.replace", "scale_selection_to_fit_print_volume": "orca_project.scale_to_fit", "settings": "orca_project.set", "simplify": "orca_project.simplify",
    "smooth_mesh": "orca_project.smooth", "transform": "orca_project.place", "add_volume": "orca_project.part_add", "convert_unit": "orca_project.convert_unit",
    "flush_options": "orca_project.flush", "instance_manipulation": "orca_project.instance", "add_generic": "orca_project.primitive",
    "add_handy_model": "orca_project.handy", "more": "na", "set_visible": "view",
}
TOOLBAR = {"add": "orca_project.object_add", "addplate": "orca_project.plate_add", "orient": "orca_project.orient", "arrange": "orca_project.arrange",
           "more": "orca_project.instance", "fewer": "orca_project.instance", "splitobjects": "orca_project.split_objects", "splitvolumes": "orca_project.split",
           "layersediting": "orca_project.layer_heights", "assembly_view": "view"}
GIZMOS = {
    "GLGizmoMove3D": "orca_project.place", "GLGizmoRotate3D": "orca_project.place", "GLGizmoScale3D": "orca_project.place", "GLGizmoFlatten": "orca_project.lay_flat",
    "GLGizmoCut3D": "orca_project.cut", "GLGizmoMeshBoolean": "orca_project.boolean", "GLGizmoFdmSupports": "orca_paint.supports", "GLGizmoSeam": "orca_paint.seam",
    "GLGizmoFuzzySkin": "orca_paint.fuzzy_skin", "GLGizmoMmuSegmentation": "orca_paint.color", "GLGizmoTextureDisplacement": "gap", "GLGizmoEmboss": "orca_project.emboss",
    "GLGizmoSVG": "orca_project.emboss", "GLGizmoMeasure": "measure_keep", "GLGizmoAssembly": "view", "GLGizmoSimplify": "orca_project.simplify",
    "GLGizmoBrimEars": "orca_project.brim_ears",
}
# The plate's own buttons (PartPlate) and the G-code preview (GCodeViewer).
PLATE_BUTTONS = {"delete": "orca_project.plate_remove", "arrange": "orca_project.arrange", "orient": "orca_project.orient", "lock": "orca_project.locked",
                 "settings": "orca_project.plate", "rename": "orca_project.plater_name", "move to front": "orca_project.plate_move"}
PREVIEW = {
    "layers slider (one layer, a range)": "gcode_read", "moves slider (one move)": "gcode_read.move", "view: feature type": "gcode_read.feature",
    "view: height": "gcode_read.height", "view: width": "gcode_read.width", "view: speed": "gcode_read.speed", "view: actual speed": "gcode_read.actual_speed",
    "view: fan speed": "gcode_read.fan", "view: temperature": "gcode_read.temperature", "view: volumetric flow": "gcode_read.flow", "view: actual flow": "gcode_read.actual_flow",
    "view: layer time": "gcode_read.layer_time", "view: filament / tool": "gcode_read.tool", "view: colour print": "gcode_read.tool", "view: acceleration": "gcode_read.acceleration",
    "statistics: time and filament per feature": "gcode_read", "statistics: per filament and colour change": "orca_slice",
    "show travel, wipe, retract, seams": "gcode_read.seams", "pause / colour change / custom G-code on a layer": "orca_project.gcode",
    "export the toolpaths as OBJ": "gcode_read.toolpaths", "G-code window (the lines of the move)": "gcode_read.move",
}
SIDEBAR = {"printer preset": "slicer_presets", "process preset": "slicer_presets", "filament presets (each slot)": "slicer_presets",
           "add / remove a filament slot": "orca_project.filament", "filament colour": "orca_project.filament", "bed type": "orca_project.bed_type",
           "flushing volumes": "orca_project.flush", "slice plate": "orca_slice", "slice all": "orca_slice", "print plate / send": None, "export plate sliced file": "orca_slice.gcode",
           "compare presets": "slicer_presets", "save / rename / delete a preset": "slicer_presets", "edit a preset's settings": "orca_project.set"}


def judge_menu(label):
    clean = label.replace("&", "")
    for pat, group, tool in MENU:
        if re.search(pat, label) or re.search(pat, clean):
            return group, tool
    return "gap", None


def agent_tools(al):
    """{tool name: the quoted words of the file it is defined in, and the
    modules it imports from the add-on} — "tool.word" counts only when the
    tool exists and its code names the word."""
    texts = {}
    # Agent Link and Agent Link for OrcaSlicer, given as one path or several
    # (os.pathsep between): the orca tools live in the second.
    for root, _, files in (w for one in str(al).split(os.pathsep) if one for w in os.walk(one)):
        for f in files:
            if f.endswith(".py"):
                texts[os.path.join(root, f)] = open(os.path.join(root, f), encoding="utf-8", errors="replace").read()
    words_all = {p: set(re.findall(r'"([A-Za-z_0-9.]+)"', t)) for p, t in texts.items()}
    tools = {}
    for p, t in texts.items():
        for name in re.findall(r'Tool\(\s*"([a-z_0-9]+)"', t):
            w = set(words_all[p])
            # Words of the add-on modules this file imports (orca3mf, slicers, calibrate …).
            for mod in re.findall(r"from \.\.? import ([a-z_0-9, ]+)|from \.\.(\w+) import", t):
                for m in [x.split()[0] for x in (mod[0] or mod[1]).split(",") if x.strip()]:
                    for q, ww in words_all.items():
                        if os.path.basename(q) == f"{m}.py":
                            w |= ww
            tools.setdefault(name, set()).update(w)
    return tools


def has(tools, cap):
    if not cap:
        return False
    name, _, word = cap.partition(".")
    return name in tools and (not word or word in tools[name])


def main(inv_path, al, out=None):
    inv = json.load(open(inv_path))
    have = agent_tools(al)
    rows = []

    def add(kind, name, group, tool, why="", fallback=None):
        if tool == "gap":
            group, tool = "gap", None
        if group == "tool" and not has(have, tool) and has(have, fallback):
            tool, why = fallback, f"today through {fallback}" + (f"; {why}" if why else "")
        if group == "tool" and not has(have, tool):
            group = "gap"
            why = f"needs {tool} (not built yet)" + (f"; {why}" if why else "")
        rows.append({"kind": kind, "name": name, "group": group, "tool": tool, "why": why})

    seen = set()
    for r in inv["settings"]:
        if r["key"] in seen:
            continue
        seen.add(r["key"])
        g, t, why = judge_setting(r)
        # Process settings already go in headless, project-wide, as
        # slice_with's overrides.
        add("setting", r["key"], g, t, why)
    for k in inv["sla"]:
        add("setting", k, "na", None, "SLA: Orca prints FFF only")
    for k in inv["placeholders"]:
        add("placeholder", k, "na", None, "a value custom G-code reads, not a setting")
    for r in inv["cli"]:
        g, t, why = judge_cli(r)
        add("cli", r["key"], g, t, why)
    for m in inv["menus"]:
        g, t = judge_menu(m["label"])
        add("menu", f"{m['label']} ({m['file']}:{m['line']})", g, t)
    for c in sorted(CONTEXT):
        t = CONTEXT[c]
        add("context", c, t if t in ("na", "view") else "tool", None if t in ("na", "view") else t)
    for t in inv["toolbar"]:
        tool = TOOLBAR.get(t["name"], "gap")
        add("toolbar", t["name"], "view" if tool == "view" else "tool", None if tool == "view" else tool)
    for gz in inv["gizmos"]:
        t = GIZMOS.get(gz["name"])
        add("gizmo", gz["name"], "view" if t == "view" else "tool", None if t == "view" else t)
    for name, tool in PLATE_BUTTONS.items():
        add("plate", name, "tool", tool)
    for name, tool in PREVIEW.items():
        add("preview", name, "tool", tool)
    for name, tool in SIDEBAR.items():
        add("sidebar", name, "tool" if tool else "later", tool, "" if tool else "printer connection")
    counts = Counter(r["group"] for r in rows)
    judged = [r for r in rows if r["group"] in ("tool", "gap")]
    covered = sum(1 for r in judged if r["group"] == "tool")
    out_rows = {"counts": dict(counts), "coverage": [covered, len(judged)], "byKind": {}}
    for k in sorted({r["kind"] for r in rows}):
        kr = [r for r in rows if r["kind"] == k]
        kj = [r for r in kr if r["group"] in ("tool", "gap")]
        out_rows["byKind"][k] = {"rows": len(kr), "tool": sum(1 for r in kj if r["group"] == "tool"), "gap": sum(1 for r in kj if r["group"] == "gap")}
    gaps = Counter(r["tool"] or r["name"] for r in rows if r["group"] == "gap")
    out_rows["gapsByTool"] = dict(gaps.most_common())
    out_rows["rows"] = rows
    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(out_rows, f, indent=1)
    pct = 100.0 * covered / max(1, len(judged))
    print(f"OrcaSlicer headless: {covered}/{len(judged)} = {pct:.1f}%  {dict(counts)}")
    print("by kind:", json.dumps(out_rows["byKind"]))
    print("gaps by tool:", json.dumps(out_rows["gapsByTool"]))
    unj = [r["name"] for r in rows if r["group"] == "gap" and not r["tool"]]
    if unj:
        print("unjudged:", unj[:40])


if __name__ == "__main__":
    main(*sys.argv[1:])
