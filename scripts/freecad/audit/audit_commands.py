# SPDX-License-Identifier: AGPL-3.0-only
# Run inside the FreeCAD GUI (freecad commands.py): every workbench brought
# up in turn, and every command FreeCAD then has written out with its menu
# text and tip, and which workbench's toolbars and menus hold it — what the
# coverage audit measures Agent Link's tools against. AUDIT_OUT names the
# JSON file.
import json
import os
import traceback

import FreeCAD
import FreeCADGui as Gui
from PySide import QtCore

out_path = os.environ["AUDIT_OUT"]


def menu_commands():
    from PySide import QtGui

    try:
        from PySide import QtWidgets
    except ImportError:
        QtWidgets = QtGui
    bar = Gui.getMainWindow().menuBar()
    seen = []

    def walk(actions, path):
        for a in actions:
            m = a.menu()
            if m is not None:
                walk(m.actions(), path + [a.text().replace("&", "")])
            elif a.objectName():
                seen.append({"cmd": a.objectName(), "menu": " > ".join(path + [a.text().replace("&", "")])})

    walk(bar.actions(), [])
    return seen


def run():
    data = {"freecad": ".".join(FreeCAD.Version()[:3]), "workbenches": {}, "commands": {}}
    for name in sorted(Gui.listWorkbenches()):
        if name in ("NoneWorkbench",):
            continue
        rec = {}
        try:
            Gui.activateWorkbench(name)
            Gui.updateGui()
            wb = Gui.getWorkbench(name)
            rec["title"] = getattr(wb, "MenuText", name)
            try:
                rec["toolbars"] = wb.getToolbarItems()
            except Exception as e:
                rec["toolbars"] = {}
                rec["toolbarError"] = str(e)
            rec["menus"] = menu_commands()
        except Exception as e:
            rec["error"] = str(e)[:300]
        data["workbenches"][name] = rec
    for c in sorted(Gui.listCommands()):
        info = {}
        try:
            info = dict(Gui.Command.get(c).getInfo())
        except Exception:
            pass
        data["commands"][c] = {k: info.get(k) for k in ("menuText", "toolTip", "whatsThis", "statusTip", "shortcut") if info.get(k)}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, sort_keys=True)
    print(f"audit: {len(data['commands'])} commands, {len(data['workbenches'])} workbenches -> {out_path}", flush=True)


def start():
    try:
        run()
    except Exception:
        traceback.print_exc()
        os._exit(2)
    os._exit(0)


QtCore.QTimer.singleShot(3000, start)
