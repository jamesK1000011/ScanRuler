#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Everything OrcaSlicer offers, read from its own source (the fork's
agent-cli branch): every setting (PrintConfig.cpp, with its type, label,
tooltip, category, enum values, limits, default and which presets hold it),
every command-line option, every menu and context-menu item (MainFrame.cpp,
GUI_Factories.cpp), every canvas toolbar button (GLCanvas3D.cpp) and gizmo
(GLGizmosManager.cpp), and the calibration tests. The audit judges each
row (judge.py); the counts are the coverage.

    python3 inventory.py <orcaslicer checkout> <out.json>
"""

import json
import re
import sys
from collections import Counter

ADD = re.compile(r'def\s*=\s*this->add(?:_nullable)?\(\s*"([^"]+)"\s*,\s*(co\w+)\s*\)')
STR = r'(?:_?L|_u8L|_CTX)\(\s*"((?:[^"\\]|\\.)*)"'


def first(pat, text):
    m = re.search(pat, text, re.S)
    return m.group(1) if m else None


def settings(src):
    text = open(f"{src}/src/libslic3r/PrintConfig.cpp", encoding="utf-8", errors="replace").read()
    sections = [(m.start(), m.group(0)) for m in re.finditer(r"\n(?:void\s+)?\w+ConfigDef::(\w+)\(\)", text)]

    def section_at(pos):
        name = "?"
        for p, s in sections:
            if p <= pos:
                name = re.search(r"::(\w+)\(\)", s).group(1)
        return name

    hits = list(ADD.finditer(text))
    out = []
    for i, m in enumerate(hits):
        end = hits[i + 1].start() if i + 1 < len(hits) else len(text)
        body = text[m.end():end]
        sec = section_at(m.start())
        row = {"key": m.group(1), "type": m.group(2), "section": sec}
        row["label"] = first(r"def->label\s*=\s*" + STR, body)
        row["full_label"] = first(r"def->full_label\s*=\s*" + STR, body)
        row["category"] = first(r"def->category\s*=\s*" + STR, body)
        row["tooltip"] = first(r"def->tooltip\s*=\s*" + STR, body)
        row["sidetext"] = first(r"def->sidetext\s*=\s*" + STR, body)
        row["mode"] = first(r"def->mode\s*=\s*(\w+)", body)
        mn, mx = first(r"def->min\s*=\s*([-\w.]+)", body), first(r"def->max\s*=\s*([-\w.]+)", body)
        row["min"], row["max"] = mn, mx
        ev = re.findall(r'def->enum_values\.push_back\(\s*"([^"]*)"', body)
        if ev:
            row["enum"] = ev
        dv = first(r"set_default_value\(\s*new\s+\w+\s*(.{0,160}?)\)\s*;", body)
        if dv:
            row["default"] = dv.strip()
        row["readonly"] = "readonly = true" in body
        row["cli_only"] = 'def->cli = ConfigOptionDef::nocli' in body
        out.append(row)
    return out


def preset_kinds(src):
    text = open(f"{src}/src/libslic3r/Preset.cpp", encoding="utf-8", errors="replace").read()
    kinds = {}
    for var, kind in (("s_Preset_print_options", "process"), ("s_Preset_filament_options", "filament"), ("s_Preset_machine_limits_options", "machine"),
                      ("s_Preset_printer_options", "machine")):
        m = re.search(var + r"\s*\{(.*?)\};", text, re.S)
        if not m:
            continue
        body = re.sub(r"/\*.*?\*/", "", m.group(1), flags=re.S)
        body = re.sub(r"//[^\n]*", "", body)
        for k in re.findall(r'"([^"]+)"', body):
            kinds.setdefault(k, kind)
    return kinds


def menus(src):
    rows = []
    gui = f"{src}/src/slic3r/GUI"
    for f in ("MainFrame.cpp", "GUI_Factories.cpp", "GUI_ObjectList.cpp", "Plater.cpp"):
        text = open(f"{gui}/{f}", encoding="utf-8", errors="replace").read()
        func = "?"
        for ln, line in enumerate(text.splitlines(), 1):
            fm = re.match(r"^[\w:<>*&\s]+?(\w+::\w+)\s*\(", line)
            if fm and not line.strip().startswith(("//", "return", "if", "else")):
                func = fm.group(1)
            if line.strip().startswith("//"):
                continue
            if re.search(r"append_menu_(?:item|check_item|radio_item)\(|append_submenu\(", line):
                label = first(STR, line) or first(r'wxString\("((?:[^"\\]|\\.)*)"', line)
                if not label:
                    nxt = "\n".join(text.splitlines()[ln:ln + 2])
                    label = first(STR, nxt)
                if label:
                    rows.append({"file": f, "line": ln, "in": func, "label": label.replace("\\\"", '"'),
                                 "kind": "submenu" if "append_submenu" in line else "menu"})
    return rows


def toolbar(src):
    text = open(f"{src}/src/slic3r/GUI/GLCanvas3D.cpp", encoding="utf-8", errors="replace").read()
    rows = []
    for m in re.finditer(r'\bitem\.name\s*=\s*"([^"]+)"', text):
        tip = first(r"item\.tooltip\s*=\s*" + r"(?:_utf8\()?" + STR, text[m.end():m.end() + 600])
        rows.append({"name": m.group(1), "tooltip": tip})
    return rows


def gizmos(src):
    text = open(f"{src}/src/slic3r/GUI/Gizmos/GLGizmosManager.cpp", encoding="utf-8", errors="replace").read()
    return [{"name": g} for g in re.findall(r"^\s*m_gizmos\.emplace_back\(new (GLGizmo\w+)\(", text, re.M)]


def cli(src):
    return [r for r in settings(src) if r["section"] in ("CLIActionsConfigDef", "CLITransformConfigDef", "CLIMiscConfigDef")]


def main(src, out):
    s = settings(src)
    kinds = preset_kinds(src)
    for r in s:
        r["preset"] = kinds.get(r["key"])
    inv = {
        "settings": [r for r in s if r["section"] in ("init_common_params", "init_fff_params", "PrintConfigDef")],
        "sla": [r["key"] for r in s if r["section"] == "init_sla_params"],
        "placeholders": [r["key"] for r in s if r["section"].endswith("StatesConfigDef") or r["section"] in (
            "PrintStatisticsConfigDef", "ObjectsInfoConfigDef", "DimensionsConfigDef", "TemperaturesConfigDef", "TimestampsConfigDef",
            "OtherPresetsConfigDef", "CustomGcodeSpecificConfigDef")],
        "cli": [r for r in s if r["section"] in ("CLIActionsConfigDef", "CLITransformConfigDef", "CLIMiscConfigDef")],
        "menus": menus(src),
        "toolbar": toolbar(src),
        "gizmos": gizmos(src),
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(inv, f, indent=1)
    c = Counter(r["section"] for r in s)
    print({k: len(v) for k, v in inv.items()}, dict(c))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
