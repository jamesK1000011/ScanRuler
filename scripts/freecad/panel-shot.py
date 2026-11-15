# SPDX-License-Identifier: AGPL-3.0-only
# Run inside the FreeCAD GUI (freecad panel-shot.py): the Agent Link panel
# opened on a small part, each of its tabs worked as a person would (a
# review, and with Workshop Make and Documents installed a setup made, a
# material given, a fit sized, a manual made) and pictured; a tab whose
# add-on is absent is skipped.
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
    from agentlink import hooks
    from agentlink import panel as pm

    pm.show()
    p = pm._panel
    p.resize(520, 760)
    tabs = p.tabs
    titles = [tabs.tabText(i) for i in range(tabs.count())]
    print("panel tabs:", titles, "| reviewers:", len(hooks.REVIEWERS), flush=True)
    # Setups, Materials and Fits are Workshop Make's tabs and Manual is
    # Workshop Documents' (hooks.register_tab): each is worked through its own
    # widget when that add-on is installed, and skipped when it is not.
    tab = getattr(p, "addon_tabs", {}).get

    def setups():
        w = tab("Setups")
        w.fill()
        w.kind.setCurrentText("print")
        w.body.setCurrentText("Base")
        w.new()
        assert w.setups.topLevelItemCount() == 1, w.msg.text()
        it = w.setups.topLevelItem(0)
        print("setups:", it.text(0), "|", it.text(1), "|", w.msg.text(), flush=True)

    def materials():
        w = tab("Materials")
        w.fill()
        w.find.setText("petg")
        w.search()
        assert w.hits.topLevelItemCount() > 0, w.msg.text()
        assert w.parts.topLevelItemCount() > 0, w.msg.text()
        w.parts.setCurrentItem(w.parts.topLevelItem(0))
        w.hits.setCurrentItem(w.hits.topLevelItem(0))
        w.give()
        it = w.parts.topLevelItem(0)
        print("materials:", it.text(0), it.text(1), "|", w.msg.text(), flush=True)

    def fits():
        w = tab("Fits")
        w.fill()
        w.nominal.setValue(6.0)
        w.size()
        assert w.table.topLevelItemCount() > 0, w.msg.text()
        print("fits:", [(w.table.topLevelItem(i).text(0), w.table.topLevelItem(i).text(1)) for i in range(w.table.topLevelItemCount())], flush=True)

    def manual():
        w = tab("Manual")
        w.fill()
        for title in ("Base", "Lid"):
            for i in range(w.parts.count()):
                it = w.parts.item(i)
                it.setCheckState(QtCore.Qt.Checked if it.text() == title else QtCore.Qt.Unchecked)
            w.title.setText(title + " in place")
            w.add()
        w.name.setText("PanelShot")
        w.make()
        assert w.file, w.msg.text()
        print("manual:", w.msg.text(), flush=True)

    def review():
        p.fill_bodies()
        p.review_pick.setCurrentText("Base")
        p.review()
        if not hooks.REVIEWERS:
            # No reviewer installed: the panel says so, and Body check gives
            # the core soundness check as the findings.
            print("review:", p.verdict.text(), flush=True)
            p.body_check()
        assert p.verdict.text() and not p.verdict.text().startswith("Could not"), p.verdict.text()
        assert p.findings.topLevelItemCount() > 0, p.verdict.text()
        p._finding_picked(p.findings.topLevelItem(0), 0)
        print("review:", p.verdict.text(), "|", p.findings.topLevelItemCount(), "findings |", p.figures.text()[:120], flush=True)

    for title, fn in (("Review", review), ("Setups", setups), ("Materials", materials), ("Fits", fits), ("Manual", manual)):
        if title not in titles:
            print(f"panel-shot: no {title} tab (its add-on is not installed), skipped", flush=True)
            continue
        tabs.setCurrentIndex(titles.index(title))
        step(fn)
        Gui.updateGui()
        p.grab().save(os.path.join(out, f"panel-{title.lower()}.png"))
    if "Activity" in titles:
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
