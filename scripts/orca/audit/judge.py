#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""The OrcaSlicer audit: every row of inventory.json judged.

- tool <name>: an Agent Link tool does it headless (counted only when that
  tool exists in Agent Link's source, so the number moves as tools land)
- view: only meaningful in Orca's window (camera, display toggles, layout)
- na: not slicing (help, about, debug, SLA, bookkeeping keys, placeholders)
- later: the printer connection and Orca's cloud (roadmap: lowest)

    python3 judge.py inventory.json <AgentLink dir> [out.json]
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
        return "tool", "orca_project", "per plate: orca_project plate { settings }"
    if FILAMENTS.match(k):
        return "tool", "orca_project", "the project's filaments: orca_project filaments"
    if r.get("preset") == "process":
        return "tool", "orca_project", "process setting: project, object, part or height range (orca_project set)"
    if r.get("preset") in ("filament", "machine"):
        return "tool", "orca_project", f"{r['preset']} setting: orca_project set {{ scope: {r['preset']} }}"
    return "tool", "orca_project", "project setting (orca_project set)"


# ---- the command line ---------------------------------------------------------------------

CLI = {
    # what Agent Link drives
    "slice": "slice_with", "export_3mf": "slice_with", "export_gcode": "slice_with", "load_settings": "slice_with", "load_filaments": "slice_with",
    "orient": "slice_with", "arrange": "slice_with", "outputdir": "slice_with", "export_statistics": "slice_with", "load": "slice_with",
    "export_stl": "orca_export", "export_stls": "orca_export", "export_obj": "orca_export", "export_settings": "orca_export", "export_slicedata": "orca_export",
    "load_slicedata": "orca_export", "export_amf": "orca_export", "export_svg": "orca_export",
    "info": "orca_project", "inspect_mesh": "orca_project", "inspect_paint": "orca_project", "load_custom_gcodes": "orca_project",
    "load_filament_ids": "orca_project", "allow_multicolor_oneplate": "orca_project", "allow_rotations": "slice_with", "align_to_y_axis": "slice_with",
    "avoid_extrusion_cali_region": "slice_with", "skip_objects": "orca_project", "clone_objects": "orca_project", "allow_mix_temp": "orca_project",
    "uptodate": "orca_project", "uptodate_settings": "orca_project", "uptodate_filaments": "orca_project", "load_defaultfila": "slice_with",
    "min_save": "orca_project", "allow_newer_file": "slice_read", "enable_timelapse": "orca_project", "metadata_name": "orca_project",
    "metadata_value": "orca_project", "makerlab_name": "orca_project", "makerlab_version": "orca_project", "skip_modified_gcodes": "orca_project",
    "load_assemble_list": "orca_project", "assemble": "orca_project",
    # transforms: FreeCAD does them on the body (or Orca's own on a plate)
    "align_xy": "object_set", "center": "object_set", "ensure_on_bed": "object_set", "rotate": "draft_modify", "rotate_x": "draft_modify",
    "rotate_y": "draft_modify", "scale": "draft_modify", "scale_to_fit": "orca_project", "cut": "part_split", "cut_grid": "part_split", "cut_x": "part_split",
    "cut_y": "part_split", "split": "part_split", "repair": "meshobj_repair", "convert_unit": "units_convert", "copy": "object_duplicate",
    "duplicate_grid": "orca_project", "repetitions": "orca_project", "ground_largest_face": "orca_project", "ground_face_normal": "orca_project",
    "ground_face_point": "orca_project",
}
CLI_NA = {"help", "help_fff", "help_sla", "debug", "logfile", "datadir", "sw_renderer", "single_instance", "autosave", "pipe", "gcodeviewer",
          "export_sla", "no_check", "strict", "normative_check", "mtcpp", "mstpp", "ignore_nonexistent_config", "config_compatibility",
          "downward_check", "downward_settings", "output"}


def judge_cli(r):
    k = r["key"]
    if k in CLI_NA:
        return "na", None, "the command line's own plumbing (help, logs, folders, checks)"
    if k in CLI:
        return "tool", CLI[k], ""
    return "gap", None, "not judged yet"


# ---- the window ---------------------------------------------------------------------------

MENU = [
    # files and projects
    (r"^Load\.\.\.|^Import$|^Import ZIP Archive|^Recent files|Re&load from Disk|^Reload from disk|^Reload All|^Replace 3D file|^Replace all with 3D files", "tool", "orca_project"),
    (r"^Export G-code|^Export all plate sliced file|^Export Generic 3MF|^Export$", "tool", "orca_export"),
    (r"Export as (one )?(STL|DRC)s?|Export all objects as|Export &?[Tt]oolpaths as OBJ", "tool", "orca_export"),
    (r"^Export Preset Bundle|^Preset Bundle|^Import Configs|^Sync Presets|^Migrate Filament Presets", "tool", "slicer_presets"),
    (r"^&Open G-code", "tool", "gcode_read"),
    # objects
    (r"^Add (Models|Primitive|Handy models)|^Cube$|^Cylinder$|^Sphere$|^Cone$|^Disc$|^Torus$", "tool", "orca_project"),
    (r"^Add instance|^Remove instance|^Set number of instances|^Instances|^Fill bed with (copies|instances)|^Clone|^Duplicate Current Plate|^Set as An Individual Object|^To Objects|^To Parts|^Merge with", "tool", "orca_project"),
    (r"^Delete$|^Delete All|^Rename|^Printable|^Hide|^Order By|^Height Range Modifier|^Modify|^Edit$|^Choose precise seam subtype", "tool", "orca_project"),
    (r"^Arrange|^Auto orientation|^Auto Rotate|^Drop|^Center|^Align/Distribute|^Along [XYZ] Axis|^Mirror|^Transform|^Scale to build volume|^Assemble", "tool", "orca_project"),
    (r"^Split$|^Mesh boolean|^Simplify Model|^Subdivision mesh|^Fix Model|^Fix All|^Decompose Color", "tool", "orca_project"),
    (r"^Flush into", "tool", "orca_project"),
    (r"^Remove the selected plate|^All Plates|^Select All Plates|^Fix All Plates", "tool", "orca_project"),
    # calibration
    (r"^Temperature$|^Flow ratio|^Pressure advance|^Retraction$|^VFA$|^Max flowrate|^Cornering|^Input Shaping", "tool", "orca_calibrate"),
    (r"^Calibration Guide", "na", None),
    # the window itself
    (r"^Select All|^Deselect All|^Show |^Use (Orthogonal|Perspective) View|^Auto Perspective|^Reset Window Layout|^Show Gridlines|^Show &|^Show all collision", "view", None),
    # not slicing
    (r"^New Window|^Open PrusaSlicer|^Open &Slicer|^&Quit|^Quit$|^Setup Wizard|^Check for Updates|^Show Configuration Folder|^Show Tip|^Troubleshoot|^Benchmark|^Open Network Test|^Plugins|^More$", "na", None),
    (r"^Download Models|^Upload Models", "later", None),
]
CONTEXT = {
    "add_svg": "orca_project", "add_text": "orca_project", "edit_svg": "orca_project", "edit_text": "orca_project", "align_distribute": "orca_project",
    "auto_drop": "orca_project", "set_auto_drop": "orca_project", "center": "orca_project", "change_extruder": "orca_project", "change_filament": "orca_project",
    "change_type": "orca_project", "clone": "orca_project", "delete": "orca_project", "drop": "orca_project", "export_drc": "orca_export",
    "export_stl": "orca_export", "fill_bed": "orca_project", "fix_through_cgal": "orca_project", "instance_to_object": "orca_project",
    "invalidate_cut_info": "orca_project", "layers_editing": "orca_project", "locked": "orca_project", "merge_to_multipart_object": "orca_project",
    "merge_to_single_object": "orca_project", "modify": "orca_project", "per_object_process": "orca_project", "per_object_settings": "orca_project",
    "plate_delete": "orca_project", "plate_name": "orca_project", "precise_seam_submenu": "orca_project", "printable": "orca_project",
    "set_printable": "orca_project", "reload_from_disk": "orca_project", "rename": "orca_project", "replace_all_with_stl": "orca_project",
    "replace_with_stl": "orca_project", "scale_selection_to_fit_print_volume": "orca_project", "settings": "orca_project", "simplify": "orca_project",
    "smooth_mesh": "orca_project", "transform": "orca_project", "add_volume": "orca_project", "convert_unit": "orca_project", "flush_options": "orca_project",
    "instance_manipulation": "orca_project", "add_generic": "orca_project", "add_handy_model": "orca_project", "more": "na", "set_visible": "view",
}
TOOLBAR = {"add": "orca_project", "addplate": "orca_project", "orient": "orca_project", "arrange": "orca_project", "more": "orca_project",
           "fewer": "orca_project", "splitobjects": "orca_project", "splitvolumes": "orca_project", "layersediting": "orca_project", "assembly_view": "view"}
GIZMOS = {
    "GLGizmoMove3D": "orca_project", "GLGizmoRotate3D": "orca_project", "GLGizmoScale3D": "orca_project", "GLGizmoFlatten": "orca_project",
    "GLGizmoCut3D": "orca_project", "GLGizmoMeshBoolean": "orca_project", "GLGizmoFdmSupports": "orca_paint", "GLGizmoSeam": "orca_paint",
    "GLGizmoFuzzySkin": "orca_paint", "GLGizmoMmuSegmentation": "orca_paint", "GLGizmoTextureDisplacement": "orca_project", "GLGizmoEmboss": "orca_project",
    "GLGizmoSVG": "orca_project", "GLGizmoMeasure": "measure", "GLGizmoAssembly": "orca_project", "GLGizmoSimplify": "orca_project",
    "GLGizmoBrimEars": "orca_paint",
}
# The plate's own buttons (PartPlate) and the G-code preview (GCodeViewer).
PLATE_BUTTONS = {"delete": "orca_project", "arrange": "orca_project", "orient": "orca_project", "lock": "orca_project", "settings": "orca_project",
                 "rename": "orca_project", "move to front": "orca_project"}
PREVIEW = {
    "layers slider (one layer, a range)": "gcode_read", "moves slider (one move)": "gcode_read", "view: feature type": "gcode_read",
    "view: height": "gcode_read", "view: width": "gcode_read", "view: speed": "gcode_read", "view: actual speed": "gcode_read",
    "view: fan speed": "gcode_read", "view: temperature": "gcode_read", "view: volumetric flow": "gcode_read", "view: actual flow": "gcode_read",
    "view: layer time": "gcode_read", "view: filament / tool": "gcode_read", "view: colour print": "gcode_read", "view: acceleration": "gcode_read",
    "statistics: time and filament per feature": "gcode_read", "statistics: per filament and colour change": "gcode_read",
    "show travel, wipe, retract, seams": "gcode_read", "pause / colour change / custom G-code on a layer": "orca_gcode",
    "export the toolpaths as OBJ": "orca_export", "G-code window (the lines of the move)": "gcode_read",
}
SIDEBAR = {"printer preset": "slicer_presets", "process preset": "slicer_presets", "filament presets (each slot)": "slicer_presets",
           "add / remove a filament slot": "orca_project", "filament colour": "orca_project", "bed type": "orca_project",
           "flushing volumes": "orca_project", "slice plate": "slice_with", "slice all": "slice_read", "print plate / send": None, "export plate sliced file": "orca_export",
           "compare presets": "slicer_presets", "save / rename / delete a preset": "slicer_presets", "edit a preset's settings": "orca_project"}


def judge_menu(label):
    clean = label.replace("&", "")
    for pat, group, tool in MENU:
        if re.search(pat, label) or re.search(pat, clean):
            return group, tool
    return "gap", None


def agent_tools(al):
    names = set()
    for root, _, files in os.walk(al):
        for f in files:
            if f.endswith(".py"):
                names.update(re.findall(r'Tool\(\s*"([a-z_0-9]+)"', open(os.path.join(root, f), encoding="utf-8", errors="replace").read()))
    return names


def main(inv_path, al, out=None):
    inv = json.load(open(inv_path))
    have = agent_tools(al)
    rows = []

    def add(kind, name, group, tool, why="", fallback=None):
        if group == "tool" and tool not in have and fallback in have:
            tool, why = fallback, f"today through {fallback}" + (f"; {why}" if why else "")
        if group == "tool" and tool not in have:
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
        add("setting", r["key"], g, t, why, fallback="slice_with" if r.get("preset") == "process" else None)
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
        add("toolbar", t["name"], "view" if tool == "view" else ("tool" if tool != "gap" else "gap"), None if tool in ("view", "gap") else tool)
    for gz in inv["gizmos"]:
        add("gizmo", gz["name"], "tool", GIZMOS.get(gz["name"]))
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
    gaps = Counter(r["tool"] or "unjudged" for r in rows if r["group"] == "gap")
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
