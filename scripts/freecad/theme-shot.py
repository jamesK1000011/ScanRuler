# SPDX-License-Identifier: AGPL-3.0-only
# Run inside the FreeCAD GUI (freecad theme-shot.py): apply a preference
# pack's settings, show a small part, and save the main window as a PNG.
# THEME_CFG names the pack's .cfg, THEME_SHOT the picture to write.
import os
import traceback
import xml.etree.ElementTree as ET

import FreeCAD
import FreeCADGui as Gui
from PySide import QtCore

cfg, shot = os.environ["THEME_CFG"], os.environ["THEME_SHOT"]
SETTERS = {"FCText": lambda g, n, v: g.SetString(n, v or ""), "FCUInt": lambda g, n, v: g.SetUnsigned(n, int(v)), "FCInt": lambda g, n, v: g.SetInt(n, int(v)),
           "FCBool": lambda g, n, v: g.SetBool(n, v == "1"), "FCFloat": lambda g, n, v: g.SetFloat(n, float(v))}


def load(el, path):
    """A preference pack's settings set one by one, as applying it would."""
    for child in el:
        if child.tag == "FCParamGroup":
            load(child, f"{path}/{child.get('Name')}" if path else child.get("Name"))
        elif child.tag in SETTERS and path:
            SETTERS[child.tag](FreeCAD.ParamGet("User parameter:" + path), child.get("Name"), child.get("Value") if child.tag != "FCText" else child.text)


try:
    load(ET.parse(cfg).getroot().find("FCParamGroup"), "")
except Exception:
    traceback.print_exc()
    os._exit(2)
mw = FreeCAD.ParamGet("User parameter:BaseApp/Preferences/MainWindow")
theme, sheet = mw.GetString("Theme"), mw.GetString("StyleSheet")
# Set the sheet's name last, cleared first, so the stylesheet and its
# theme parameters are read afresh.
mw.SetString("StyleSheet", "")
mw.SetString("Theme", theme)
mw.SetString("StyleSheet", sheet)

try:
    Gui.activateWorkbench("PartDesignWorkbench")
    doc = FreeCAD.newDocument("Shot")
    body = doc.addObject("PartDesign::Body", "Body")
    box = body.newObject("PartDesign::AdditiveBox", "Box")
    box.Length, box.Width, box.Height = 40, 30, 12
    cyl = body.newObject("PartDesign::SubtractiveCylinder", "Hole")
    cyl.Radius, cyl.Height = 6, 30
    cyl.AttachmentOffset = FreeCAD.Placement(FreeCAD.Vector(20, 15, -5), FreeCAD.Rotation())
    doc.recompute()
except Exception:
    traceback.print_exc()
    os._exit(2)
Gui.getMainWindow().resize(1440, 900)


def grab():
    from PySide import QtWidgets

    try:
        # The Start page and its first-run welcome would hide the part.
        for sw in Gui.getMainWindow().findChild(QtWidgets.QMdiArea).subWindowList():
            if sw.windowTitle().startswith("Start"):
                sw.close()
        Gui.SendMsgToActiveView("ViewFit")
        Gui.ActiveDocument.ActiveView.viewIsometric()
        Gui.Selection.addSelection(doc.Name, box.Name)
    except Exception as e:  # the picture is still worth having
        FreeCAD.Console.PrintWarning(f"view: {e}\n")
    QtCore.QTimer.singleShot(1500, save)


def save():
    os.makedirs(os.path.dirname(shot), exist_ok=True)
    ok = Gui.getMainWindow().grab().save(shot)
    print(f"theme-shot: {shot} {'saved' if ok else 'NOT saved'}", flush=True)
    os._exit(0 if ok else 1)


QtCore.QTimer.singleShot(3000, grab)
