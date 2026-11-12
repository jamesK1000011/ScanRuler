# SPDX-License-Identifier: AGPL-3.0-only
# Run inside the FreeCAD GUI (freecad panel-shot.py): the Agent Link panel
# opened on a small part, each of its tabs worked as a person would (a
# setup made, a material given, a fit sized, a manual made) and pictured.
# PANEL_SHOTS names the folder the pictures go in. Any error is printed and
# the run ends non-zero.
import os
import traceback

import FreeCAD
import FreeCADGui as Gui
from PySide import QtCore

out = os.environ["PANEL_SHOTS"]
os.makedirs(out, exist_ok=True)
FreeCAD.ParamGet("User parameter:BaseApp/Preferences/Mod/AgentLink").SetBool("Echo", False)
failed = []

try:
    Gui.activateWorkbench("PartDesignWorkbench")
    doc = FreeCAD.newDocument("Panel")
    for name, (x, h) in {"Base": (0, 10), "Lid": (60, 4)}.items():
        body = doc.addObject("PartDesign::Body", name)
        box = body.newObject("PartDesign::AdditiveBox", name + "Box")
        box.Length, box.Width, box.Height = 50, 30, h
        body.Placement.Base = FreeCAD.Vector(x, 0, 0)
    doc.recompute()
except Exception:
    traceback.print_exc()
    os._exit(2)
Gui.getMainWindow().resize(1440, 900)


def step(fn):
    try:
        fn()
    except Exception:
        traceback.print_exc()
        failed.append(fn.__name__)


def run():
    from agentlink import panel as pm

    pm.show()
    p = pm._panel
    p.resize(520, 760)
    tabs = p.tabs
    titles = [tabs.tabText(i) for i in range(tabs.count())]
    print("panel tabs:", titles, flush=True)

    def setups():
        p.fill_setups()
        p.setup_kind.setCurrentText("print")
        p.setup_body.setCurrentText("Base")
        p.setup_new()
        assert p.setup_tree.topLevelItemCount() == 1, p.setup_msg.text()
        print("setups:", p.setup_tree.topLevelItem(0).text(0), "|", p.setup_tree.topLevelItem(0).text(1), "|", p.setup_msg.text(), flush=True)

    def materials():
        p.fill_materials()
        p.mat_find.setText("petg")
        p.mat_search()
        assert p.mat_hits.topLevelItemCount() > 0, p.mat_msg.text()
        p.mat_parts.setCurrentItem(p.mat_parts.topLevelItem(0))
        p.mat_hits.setCurrentItem(p.mat_hits.topLevelItem(0))
        p.mat_assign()
        print("materials:", p.mat_parts.topLevelItem(0).text(0), p.mat_parts.topLevelItem(0).text(1), "|", p.mat_msg.text(), flush=True)

    def fits():
        p.fill_fits()
        p.fit_nominal.setValue(6.0)
        p.fit_size()
        assert p.fit_table.topLevelItemCount() > 0, p.fit_msg.text()
        print("fits:", [(p.fit_table.topLevelItem(i).text(0), p.fit_table.topLevelItem(i).text(1)) for i in range(p.fit_table.topLevelItemCount())], flush=True)

    def manual():
        p.fill_manual()
        for title in ("Base", "Lid"):
            for i in range(p.man_parts.count()):
                it = p.man_parts.item(i)
                it.setCheckState(QtCore.Qt.Checked if it.text() == title else QtCore.Qt.Unchecked)
            p.man_title.setText(title + " in place")
            p.man_add()
        p.man_name.setText("PanelShot")
        p.man_make()
        assert p.man_file, p.man_msg.text()
        print("manual:", p.man_msg.text(), flush=True)

    def review():
        p.fill_bodies()
        p.review_pick.setCurrentText("Base")
        p.review()
        assert p.verdict.text() and not p.verdict.text().startswith("Could not"), p.verdict.text()
        assert p.findings.topLevelItemCount() > 0
        p._finding_picked(p.findings.topLevelItem(0), 0)
        print("review:", p.verdict.text(), "|", p.findings.topLevelItemCount(), "findings |", p.figures.text()[:120], flush=True)

    for title, fn in (("Review", review), ("Setups", setups), ("Materials", materials), ("Fits", fits), ("Manual", manual)):
        tabs.setCurrentIndex(titles.index(title))
        step(fn)
        Gui.updateGui()
        p.grab().save(os.path.join(out, f"panel-{title.lower()}.png"))
    tabs.setCurrentIndex(titles.index("Activity"))
    Gui.updateGui()
    p.grab().save(os.path.join(out, "panel-activity.png"))
    print("panel-shot:", "failed " + ", ".join(failed) if failed else "all tabs worked", flush=True)
    os._exit(1 if failed else 0)


def start():
    try:
        run()
    except Exception:
        traceback.print_exc()
        os._exit(2)


QtCore.QTimer.singleShot(3000, start)
