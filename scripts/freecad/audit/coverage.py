# SPDX-License-Identifier: AGPL-3.0-only
# The coverage audit: every FreeCAD command (commands.json, from the GUI)
# against Agent Link's tools (tools.json): which a tool does headless, which
# only the window can (view, selection, dialogs: cmd_run / menu_run), which
# are not modelling at all, and which nothing does yet. map.json holds the
# judgements made by reading (command -> tool, "window", "none" or "gap");
# the rest is matched on words, and says so ("named" / "described").
import json
import re
import sys

cmds_path, tools_path, map_path, out_path = sys.argv[1:5]
C = json.load(open(cmds_path))
T = json.load(open(tools_path))
M = json.load(open(map_path))

FAMILY = {
    "PartDesign": ["pd_", "feature_", "sketch_new", "hw_"], "Sketcher": ["sketch_"], "Part": ["part_", "model_", "cut", "measure"],
    "Draft": ["draft_"], "BIM": ["bim_", "ifc_"], "Arch": ["bim_", "ifc_"], "FEM": ["fea_", "strength"], "TechDraw": ["td_", "drawing_"],
    "Assembly": ["asm_"], "CAM": ["cam_", "mill"], "Path": ["cam_"], "Mesh": ["meshobj_", "mesh"], "MeshPart": ["meshobj_", "mesh"],
    "Spreadsheet": ["sheet_", "cells"], "Points": ["points_"], "Surface": ["surface_"], "Inspection": ["insp_"], "OpenSCAD": ["scad_"],
    "Robot": ["robot_"], "Material": ["material_"], "Measure": ["measure", "clearance"], "Std": ["doc_", "object_", "history_", "export_", "import_", "view_", "app_"],
}
# Owners whose commands are about the window, not the model.
WINDOWISH = re.compile(r"^(Std_(View|Tool|Toggle|Draw|Axis|Selection|Window|Tile|Cascade|Close|Activate|Dock|Tree|Workbench|MainFullscreen|Recent|Dlg|About|What|Online|Help|Report|Python|Macro|ProjectUtil|OrthographicCamera|PerspectiveCamera|Freeze|Sync|Mouse|Statusbar|Bounding|Align|Text|Link(Select|Replace|Unlink|Import)|TreeView|Pick|Stereo|Screenshot|Show|Hide|Hidden|Set|Box|Clipping|Toggle|Edit|Refresh|User|Copy|Cut|Paste|Delete|Duplicate|Undo|Redo|Print|Restore|Save|Revert|Merge|Project|Unit|Measure|Send|Group|Persistent|Expression|Customize|Preferences|Placement|Transform|Drag|Close|Tile|Viewer|Edit|Sel)|Start_|Web_|Help_|.*_(Toggle|Show|Hide|View|Select|Highlight|Snap|Grid|WorkingPlane|Preferences|Settings|Help|About|Visib).*)")
STOP = {"create", "new", "add", "make", "the", "a", "an", "of", "to", "set", "tool", "command", "object", "objects", "from", "with", "and", "or", "in", "on", "for", "by", "selected", "selection", "current", "default"}


def words(s):
    s = re.sub(r"([a-z])([A-Z])", r"\1 \2", s or "")
    return [w for w in re.split(r"[^a-zA-Z0-9]+", s.lower()) if w and w not in STOP]


def owner(cmd):
    return cmd.split("_", 1)[0] if "_" in cmd else cmd


tools = {t["name"]: t for t in T["tools"]}
explicit = {}
for tool, cmd in T["echo"].items():
    explicit.setdefault(cmd, []).append(tool)
for kind_map, tool in ((T["kinds"]["CAM_OP"], "cam_op"), (T["kinds"]["CAM_DRESSUP"], "cam_dressup")):
    for _k, cmd in kind_map.items():
        explicit.setdefault(cmd, []).append(tool)

rows = []
for cmd, info in sorted(C["commands"].items()):
    own = owner(cmd)
    text = info.get("menuText") or ""
    status, by = None, []
    if cmd in M:
        v = M[cmd]
        status, by = (("tool", v if isinstance(v, list) else [v]) if v not in ("window", "none", "gap") else (v, []))
    elif cmd in explicit:
        status, by = "tool", explicit[cmd]
    elif WINDOWISH.match(cmd):
        status = "window"
    else:
        cw = set(words(cmd.split("_", 1)[-1])) | set(words(text))
        pref = FAMILY.get(own, [])
        fam = [t for t in tools.values() if any(t["name"].startswith(p) for p in pref)] if pref else []
        named = [t["name"] for t in fam if cw & set(words(t["name"].split("_", 1)[-1]))]
        if named:
            status, by = "named", named[:3]
        else:
            desc = [t["name"] for t in fam if len(cw & set(words(t["description"])) - {"part", "body", "sketch", "face", "edge"}) >= 2]
            status, by = ("described", desc[:3]) if desc else ("gap", [])
    rows.append({"cmd": cmd, "owner": own, "text": text, "status": status, "by": by})

by_owner = {}
for r in rows:
    o = by_owner.setdefault(r["owner"], {"total": 0, "tool": 0, "named": 0, "described": 0, "window": 0, "none": 0, "gap": 0, "gaps": []})
    o["total"] += 1
    o[r["status"]] += 1
    if r["status"] == "gap":
        o["gaps"].append(r["cmd"])

def pct(o):
    model = o["total"] - o["window"] - o["none"]
    return round(100 * (o["tool"] + o["named"] + o["described"]) / model) if model else None

summary = {"freecad": C["freecad"], "commands": len(rows), "tools": len(tools), "owners": {k: {**v, "headless%": pct(v)} for k, v in sorted(by_owner.items())}}
allv = {k: sum(v[k] for v in by_owner.values()) for k in ("total", "tool", "named", "described", "window", "none", "gap")}
summary["all"] = {**allv, "headless%": pct(allv)}
json.dump({"summary": summary, "rows": rows}, open(out_path, "w"), indent=1)
print(f"FreeCAD {C['freecad']}: {len(rows)} commands, {len(tools)} tools")
print(f"{'owner':14} {'cmds':>5} {'tool':>5} {'named':>5} {'descr':>5} {'win':>5} {'none':>5} {'gap':>5} {'head%':>6}")
for k, v in sorted(by_owner.items(), key=lambda kv: -kv[1]["total"]):
    print(f"{k:14} {v['total']:5} {v['tool']:5} {v['named']:5} {v['described']:5} {v['window']:5} {v['none']:5} {v['gap']:5} {str(pct(v)):>6}")
print(f"{'ALL':14} {allv['total']:5} {allv['tool']:5} {allv['named']:5} {allv['described']:5} {allv['window']:5} {allv['none']:5} {allv['gap']:5} {str(pct(allv)):>6}")
