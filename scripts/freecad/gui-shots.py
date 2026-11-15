# SPDX-License-Identifier: AGPL-3.0-only
# Run inside the FreeCAD GUI (freecad gui-shots.py), once per theme: every
# installed add-on's workbench opened, its toolbars, docks, task panels and
# dialogs pictured, and each surface checked by machine against FreeCAD's
# design guide (DevelopersHandbook/designguide): text that does not fit,
# widgets outside their parent or on top of a sibling, text contrast below
# WCAG AA, toolbar buttons without a real tooltip, icons missing or shared
# with another command, task panels wider than the guide's 360 px, and
# command names, buttons and group titles not in Title Case.
#
# GUI_THEME_CFG  the preference pack's .cfg to apply first
# GUI_THEME      a short name for it (folder and report key)
# GUI_SHOTS      where pictures and gui-report.json go
# GUI_PREFIXES   command-name prefixes that are ours (comma-separated)
# Results are written as they come, so a hang still leaves a report.
import hashlib
import json
import os
import re
import time
import traceback
import xml.etree.ElementTree as ET

import FreeCAD
import FreeCADGui as Gui
from PySide import QtCore, QtGui, QtWidgets

THEME = os.environ.get("GUI_THEME", "theme")
OUT = os.path.join(os.environ["GUI_SHOTS"], THEME)
PREFIXES = tuple(p for p in os.environ.get("GUI_PREFIXES", "AgentLink_,ScanRuler_,Texturizer_,SafetyNet_,Workshop_").split(",") if p)
# Commands that would end the run or wait on something that never comes.
SKIP = set(filter(None, os.environ.get("GUI_SKIP", "AgentLink_Update").split(",")))
os.makedirs(OUT, exist_ok=True)
REPORT = os.path.join(OUT, "gui-report.json")
state = {"theme": THEME, "surfaces": [], "findings": [], "commands": {}, "done": False}
SMALL = re.compile(r"^(a|an|and|as|at|but|by|for|from|in|into|of|on|or|per|the|to|vs|via|with)$")


def save_report():
    with open(REPORT, "w") as f:
        json.dump(state, f, indent=1)


def pump(ms=250):
    end = time.time() + ms / 1000
    while time.time() < end:
        QtWidgets.QApplication.processEvents(QtCore.QEventLoop.AllEvents, 50)
        time.sleep(0.01)


# --- theme ---------------------------------------------------------------
SETTERS = {"FCText": lambda g, n, v: g.SetString(n, v or ""), "FCUInt": lambda g, n, v: g.SetUnsigned(n, int(v)), "FCInt": lambda g, n, v: g.SetInt(n, int(v)),
           "FCBool": lambda g, n, v: g.SetBool(n, v == "1"), "FCFloat": lambda g, n, v: g.SetFloat(n, float(v))}


def load(el, path):
    for child in el:
        if child.tag == "FCParamGroup":
            load(child, f"{path}/{child.get('Name')}" if path else child.get("Name"))
        elif child.tag in SETTERS and path:
            SETTERS[child.tag](FreeCAD.ParamGet("User parameter:" + path), child.get("Name"), child.get("Value") if child.tag != "FCText" else child.text)


def apply_theme():
    cfg = os.environ.get("GUI_THEME_CFG")
    if not cfg:
        return
    load(ET.parse(cfg).getroot().find("FCParamGroup"), "")
    mw = FreeCAD.ParamGet("User parameter:BaseApp/Preferences/MainWindow")
    theme, sheet = mw.GetString("Theme"), mw.GetString("StyleSheet")
    mw.SetString("StyleSheet", "")
    mw.SetString("Theme", theme)
    mw.SetString("StyleSheet", sheet)


# --- checks --------------------------------------------------------------
def lum(c):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2])


def ratio(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def text_contrast(w):
    """Contrast of a widget's text against its own background, read from
    the pixels: the commonest colour is the background, the text the
    colour (of at least 1% of the pixels) furthest from it."""
    img = w.grab().toImage().convertToFormat(QtGui.QImage.Format_RGB32)
    if img.width() < 4 or img.height() < 4:
        return None
    counts = {}
    step = max(1, int(((img.width() * img.height()) / 4000) ** 0.5))
    for y in range(0, img.height(), step):
        for x in range(0, img.width(), step):
            c = QtGui.QColor(img.pixel(x, y))
            k = (c.red() & 0xF0, c.green() & 0xF0, c.blue() & 0xF0)
            counts[k] = counts.get(k, 0) + 1
    total = sum(counts.values())
    if not total:
        return None
    bg = max(counts, key=counts.get)
    fg = [k for k, n in counts.items() if n >= total * 0.01 and k != bg]
    if not fg:
        return None
    return min(21.0, max(ratio(bg, k) for k in fg))


def plain(s):
    if "<" in s and ">" in s:
        d = QtGui.QTextDocument()
        d.setHtml(s)
        return d.toPlainText()
    return s


def title_case_problem(text):
    words = [w for w in re.split(r"\s+", text.replace("&", "").replace("…", "").strip(" .:")) if w]
    bad = [w for i, w in enumerate(words) if w[:1].isalpha() and w[:1].islower() and not (i and SMALL.match(w))]
    return bad


def path_of(w, root):
    parts = []
    while w is not None and w is not root:
        n = w.objectName() or type(w).__name__
        t = getattr(w, "text", None)
        if callable(t):
            try:
                tt = t()
                if isinstance(tt, str) and tt:
                    n += f'["{tt[:30]}"]'
            except Exception:
                pass
        parts.append(n)
        w = w.parentWidget()
    return "/".join(reversed(parts))


def find(surface, root, w, check, detail, severity="warn"):
    state["findings"].append({"surface": surface["id"], "addon": surface["addon"], "widget": path_of(w, root) if w is not None else "", "check": check, "detail": detail, "severity": severity})


def lint(surface, root):
    """The machine checks over one captured surface."""
    if isinstance(root, QtWidgets.QWidget) and surface["kind"] == "task" and root.width() > 380:
        find(surface, root, None, "task-width", f"task panel {root.width()} px wide; the design guide sets 360", "info")
    for w in [root] + root.findChildren(QtWidgets.QWidget):
        if not w.isVisible() or w.width() <= 0:
            continue
        fm = w.fontMetrics()
        if isinstance(w, QtWidgets.QLabel) and w.text() and w.pixmap() is None and not w.wordWrap():
            txt = plain(w.text())
            need = max(fm.horizontalAdvance(line) for line in txt.split("\n")) if txt else 0
            if need > w.contentsRect().width() + 2:
                find(surface, root, w, "clipped", f"label needs {need} px, has {w.contentsRect().width()}", "fail")
        if isinstance(w, QtWidgets.QAbstractButton) and w.text():
            if w.sizeHint().width() > w.width() + 2:
                find(surface, root, w, "clipped", f"button needs {w.sizeHint().width()} px, has {w.width()}", "fail")
            if isinstance(w, QtWidgets.QPushButton):
                bad = title_case_problem(w.text())
                if bad:
                    find(surface, root, w, "title-case", f"button '{w.text()}': {bad}", "info")
        if isinstance(w, QtWidgets.QToolButton) and not w.text() and w.toolButtonStyle() == QtCore.Qt.ToolButtonIconOnly:
            a = w.defaultAction()
            tip = w.toolTip() or (a.toolTip() if a else "")
            if not tip:
                find(surface, root, w, "tooltip", "icon-only button with no tooltip", "fail")
        if isinstance(w, QtWidgets.QGroupBox) and w.title():
            if fm.horizontalAdvance(w.title()) + 16 > w.width():
                find(surface, root, w, "clipped", f"group title '{w.title()}' wider than its box", "fail")
            bad = title_case_problem(w.title())
            if bad:
                find(surface, root, w, "title-case", f"group '{w.title()}': {bad}", "info")
        if isinstance(w, QtWidgets.QTabBar):
            for i in range(w.count()):
                if w.isTabVisible(i) and fm.horizontalAdvance(w.tabText(i)) + 8 > w.tabRect(i).width():
                    find(surface, root, w, "clipped", f"tab '{w.tabText(i)}' elided", "warn")
        p = w.parentWidget()
        if p is not None and w is not root and not isinstance(p, (QtWidgets.QScrollArea, QtWidgets.QAbstractScrollArea)) and p.objectName() != "qt_scrollarea_viewport":
            g, pr = w.geometry(), p.contentsRect().adjusted(-1, -1, 1, 1)
            if not isinstance(p, (QtWidgets.QStackedWidget, QtWidgets.QSplitter)) and (g.right() > pr.right() + 2 or g.bottom() > pr.bottom() + 2):
                find(surface, root, w, "overflow", f"{g.width()}x{g.height()} at {g.x()},{g.y()} outside parent {p.width()}x{p.height()}", "fail")
        if isinstance(w, (QtWidgets.QLabel, QtWidgets.QAbstractButton)) and w.isEnabled() and (w.text() if not isinstance(w, QtWidgets.QLabel) or w.pixmap() is None else ""):
            r = text_contrast(w)
            if r is not None and r < 3.0:
                find(surface, root, w, "contrast", f"text contrast {r:.2f}:1 (AA needs 4.5)", "fail")
            elif r is not None and r < 4.5:
                find(surface, root, w, "contrast", f"text contrast {r:.2f}:1 (AA needs 4.5)", "warn")
        sheet = w.styleSheet() if w.parentWidget() is not None else ""
        if sheet and re.search(r"(?<![-\w])(color|background(-color)?)\s*:\s*(#[0-9a-fA-F]{3,8}|white|black|rgb)", sheet) and "palette(" not in sheet:
            find(surface, root, w, "hard-colour", "stylesheet sets a fixed colour; check it in the other theme", "info")
    # Siblings on top of each other in one layout.
    for lay in root.findChildren(QtWidgets.QLayout):
        items = [lay.itemAt(i).widget() for i in range(lay.count())]
        items = [x for x in items if x is not None and x.isVisible() and x.width() > 0]
        for i, a in enumerate(items):
            for b in items[i + 1:]:
                inter = a.geometry().intersected(b.geometry())
                if inter.width() > 2 and inter.height() > 2:
                    find(surface, root, a, "overlap", f"overlaps {path_of(b, root)} by {inter.width()}x{inter.height()}", "fail")


SHOT_N = [0]


def capture(kind, addon, name, widget, lint_it=True):
    SHOT_N[0] += 1
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", f"{kind}-{name}")[:80]
    fn = f"{SHOT_N[0]:03d}-{safe}.png"
    surface = {"id": fn, "kind": kind, "addon": addon, "name": name, "size": [widget.width(), widget.height()]}
    try:
        pump(150)
        widget.grab().save(os.path.join(OUT, fn))
        if lint_it:
            lint(surface, widget)
    except Exception as e:
        surface["error"] = repr(e)
    state["surfaces"].append(surface)
    save_report()
    return surface


# --- the run -------------------------------------------------------------
def ours(cmd):
    return cmd.startswith(PREFIXES)


def addon_of(cmd):
    return cmd.split("_")[0] if "_" in cmd else cmd


def wb_addon(wb):
    try:
        import inspect

        f = inspect.getfile(type(wb))
    except Exception:
        return None
    mod = os.path.join(FreeCAD.getUserAppDataDir(), "Mod")
    return os.path.relpath(f, mod).split(os.sep)[0] if f.startswith(mod) else None


def docks():
    return {d.objectName() or d.windowTitle(): d for d in Gui.getMainWindow().findChildren(QtWidgets.QDockWidget)}


def toplevels():
    return {id(w): w for w in QtWidgets.QApplication.topLevelWidgets() if w.isVisible() and w is not Gui.getMainWindow()}


def task_view():
    for w in Gui.getMainWindow().findChildren(QtWidgets.QWidget):
        if w.metaObject().className() == "Gui::TaskView::TaskView" and w.isVisible():
            return w
    return None


def scene():
    doc = FreeCAD.newDocument("GuiShots")
    body = doc.addObject("PartDesign::Body", "Body")
    box = body.newObject("PartDesign::AdditiveBox", "Box")
    box.Length, box.Width, box.Height = 40, 30, 12
    try:
        import Mesh

        m = doc.addObject("Mesh::Feature", "Scan")
        m.Mesh = Mesh.Mesh(Mesh.createBox(30, 20, 10))
        m.Placement.Base = FreeCAD.Vector(60, 0, 0)
    except Exception:
        pass
    doc.recompute()
    return doc, body, box


def select(doc, box):
    Gui.Selection.clearSelection()
    try:
        Gui.Selection.addSelection(doc.Name, "Body", "Box.Face6")
    except Exception:
        Gui.Selection.addSelection(doc.Name, box.Name)


def run_command(addon, cmd, doc, box):
    info = {"addon": addon}
    state["commands"][cmd] = info
    c = Gui.Command.get(cmd)
    if c is None:
        info["state"] = "missing"
        return
    try:
        ri = c.getInfo()
        info["menu"], info["tooltip"] = ri.get("menuText", ""), ri.get("toolTip", "")
    except Exception:
        pass
    if cmd in SKIP:
        info["state"] = "skipped"
        return
    select(doc, box)
    pump(100)
    if not c.isActive():
        info["state"] = "inactive"
        return
    before_docks, before_top = set(docks()), toplevels()
    caught = []

    def catch_modal():
        # A modal dialog runs its own loop inside Activated: picture it from
        # in there and close it, so the run goes on.
        m = QtWidgets.QApplication.activeModalWidget()
        if m is not None and id(m) not in [id(x) for x in caught]:
            caught.append(m)
            capture("dialog", addon, f"{cmd}-{m.windowTitle() or type(m).__name__}", m)
            try:
                m.reject() if hasattr(m, "reject") else m.close()
            except Exception:
                m.close()
        if len(caught) < 4:
            QtCore.QTimer.singleShot(900, catch_modal)

    QtCore.QTimer.singleShot(900, catch_modal)
    t0 = time.time()
    try:
        c.run()
        info["state"] = "ran"
    except Exception as e:
        info["state"] = f"error: {e!r}"[:200]
    info["seconds"] = round(time.time() - t0, 2)
    pump(1200)
    tv = task_view()
    if Gui.Control.activeDialog() and tv is not None:
        capture("task", addon, cmd, tv)
        info["task"] = True
        try:
            Gui.Control.closeDialog()
        except Exception:
            pass
    for k, d in docks().items():
        if k not in before_docks and d.isVisible():
            capture("dock", addon, f"{cmd}-{k}", d)
            info.setdefault("docks", []).append(k)
    for k, w in toplevels().items():
        if k not in before_top and all(w is not x for x in caught):
            capture("window", addon, f"{cmd}-{w.windowTitle() or type(w).__name__}", w)
            try:
                w.close()
            except Exception:
                pass
    Gui.Selection.clearSelection()
    save_report()


def icon_key(action):
    ic = action.icon()
    if ic.isNull():
        return None
    img = ic.pixmap(32, 32).toImage().convertToFormat(QtGui.QImage.Format_ARGB32)
    b = img.constBits()
    data = bytes(b) if not hasattr(b, "tobytes") else b.tobytes()
    return hashlib.sha1(data[: img.sizeInBytes()]).hexdigest()


def main():
    apply_theme()
    pump(500)
    mw = Gui.getMainWindow()
    mw.resize(1440, 900)
    for sw in mw.findChild(QtWidgets.QMdiArea).subWindowList():
        if sw.windowTitle().startswith("Start"):
            sw.close()
    Gui.activateWorkbench("PartDesignWorkbench")
    doc, body, box = scene()
    Gui.SendMsgToActiveView("ViewFit")
    pump(500)
    capture("window", "core", "main-partdesign", mw, lint_it=False)
    # Core icons first, for the clash check: the workbenches a person of these
    # add-ons uses most.
    core_icons = {}
    for wbn in ("PartWorkbench", "SketcherWorkbench", "MeshWorkbench", "TechDrawWorkbench", "PartDesignWorkbench"):
        try:
            Gui.activateWorkbench(wbn)
            pump(300)
        except Exception:
            pass
    for name in Gui.Command.listAll():
        if ours(name):
            continue
        try:
            for a in Gui.Command.get(name).getAction() or []:
                k = icon_key(a)
                if k:
                    core_icons.setdefault(k, name)
        except Exception:
            pass
    ours_wbs = []
    for name, wb in Gui.listWorkbenches().items():
        a = wb_addon(wb)
        if a:
            ours_wbs.append((name, a, wb))
    state["workbenches"] = [(n, a) for n, a, _ in ours_wbs]
    print("gui-shots: workbenches", state["workbenches"], flush=True)
    icon_owner = {}
    for name, addon, wb in ours_wbs:
        try:
            Gui.activateWorkbench(name)
        except Exception as e:
            state["findings"].append({"surface": name, "addon": addon, "widget": "", "check": "workbench", "detail": f"would not open: {e!r}", "severity": "fail"})
            continue
        pump(800)
        Gui.SendMsgToActiveView("ViewFit")
        capture("workbench", addon, name, mw, lint_it=False)
        try:
            bars = wb.getToolbarItems()
        except Exception:
            bars = {}
        try:
            menus = wb.listMenus()
        except Exception:
            menus = []
        state.setdefault("menus", {})[name] = menus
        cmds = []
        for bar_name, items in bars.items():
            for tb in mw.findChildren(QtWidgets.QToolBar):
                if tb.isVisible() and (tb.objectName() == bar_name or tb.windowTitle() == bar_name):
                    s = capture("toolbar", addon, f"{name}-{bar_name}", tb)
                    for act in tb.actions():
                        if act.isSeparator() or not act.isVisible():
                            continue
                        k = icon_key(act)
                        label = act.text().replace("&", "")
                        if k is None:
                            find(s, tb, None, "icon", f"'{label}' has no icon", "fail")
                        else:
                            if k in core_icons:
                                find(s, tb, None, "icon-clash", f"'{label}' uses the same icon as core {core_icons[k]}", "warn")
                            prev = icon_owner.setdefault(k, label)
                            if prev != label:
                                find(s, tb, None, "icon-clash", f"'{label}' and '{prev}' share one icon", "warn")
                        tip = plain(act.toolTip() or "").strip()
                        if not tip or tip.rstrip(".") == label.rstrip("."):
                            find(s, tb, None, "tooltip", f"'{label}' tooltip only repeats its name", "warn")
                        bad = title_case_problem(label)
                        if bad:
                            find(s, tb, None, "title-case", f"command '{label}': {bad}", "info")
            cmds += [c for c in items if ours(c) and c not in cmds]
        for cmd in cmds:
            if cmd in state["commands"]:
                continue
            print("gui-shots: command", cmd, flush=True)
            try:
                run_command(addon, cmd, doc, box)
            except Exception:
                traceback.print_exc()
            if FreeCAD.ActiveDocument is None or "GuiShots" not in FreeCAD.listDocuments():
                doc, body, box = scene()
            else:
                FreeCAD.setActiveDocument(doc.Name)
    state["done"] = True
    save_report()
    fails = sum(1 for f in state["findings"] if f["severity"] == "fail")
    print(f"gui-shots: {THEME}: {len(state['surfaces'])} surfaces, {len(state['findings'])} findings ({fails} fail)", flush=True)
    os._exit(0)


def start():
    try:
        main()
    except Exception:
        traceback.print_exc()
        save_report()
        os._exit(2)


QtCore.QTimer.singleShot(3000, start)
