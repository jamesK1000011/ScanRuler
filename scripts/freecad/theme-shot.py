# SPDX-License-Identifier: AGPL-3.0-only
# Run inside the FreeCAD GUI (freecad theme-shot.py): apply a preference
# pack's settings, show a small part, and save the main window as a PNG.
# THEME_CFG names the pack's .cfg, THEME_SHOT the picture to write.
import os

import FreeCAD
import FreeCADGui as Gui
from PySide import QtCore

cfg, shot = os.environ["THEME_CFG"], os.environ["THEME_SHOT"]
root = FreeCAD.ParamGet("User parameter:")
root.Import(cfg)
mw = FreeCAD.ParamGet("User parameter:BaseApp/Preferences/MainWindow")
theme, sheet = mw.GetString("Theme"), mw.GetString("StyleSheet")
# An import does not tell the observers: set the names again so the
# stylesheet and its parameters are read afresh.
mw.SetString("StyleSheet", "")
mw.SetString("Theme", theme)
mw.SetString("StyleSheet", sheet)

Gui.activateWorkbench("PartDesignWorkbench")
doc = FreeCAD.newDocument("Shot")
body = doc.addObject("PartDesign::Body", "Body")
box = body.newObject("PartDesign::AdditiveBox", "Box")
box.Length, box.Width, box.Height = 40, 30, 12
cyl = body.newObject("PartDesign::SubtractiveCylinder", "Hole")
cyl.Radius, cyl.Height = 6, 30
cyl.AttachmentOffset = FreeCAD.Placement(FreeCAD.Vector(20, 15, -5), FreeCAD.Rotation())
doc.recompute()
Gui.getMainWindow().resize(1440, 900)


def grab():
    try:
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
