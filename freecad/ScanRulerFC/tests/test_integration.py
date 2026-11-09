# SPDX-License-Identifier: AGPL-3.0-only
# Measuring and comparing share one scan: an element fitted before a best
# fit follows the scan onto the reference, and serves as a deviation target.
import json
import math
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
try:
    import FreeCAD  # noqa: F401
    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False


def _centre(fit):
    for k in ("center", "centre", "origin", "point"):
        if isinstance(fit.get(k), list) and len(fit[k]) == 3:
            return fit[k]
    return None


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Integration(unittest.TestCase):
    def call(self, name, args=None, ok=True):
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        out = json.loads(r["content"][0]["text"])
        if ok:
            self.assertFalse(r.get("isError"), f"{name}: {out}")
        return out

    def test_fit_then_align_then_target(self):
        import FreeCAD as App
        import MeshPart
        import Part

        from agentlink.tools import Session, build_server

        d = tempfile.mkdtemp()
        self.server = build_server(Session(out_dir=d), lean=False)
        box = Part.makeBox(40, 30, 10)
        step = os.path.join(d, "ref.step")
        box.exportStep(step)
        moved = box.copy()
        moved.Placement = App.Placement(App.Vector(0.6, -0.4, 0.3), App.Rotation(App.Vector(0, 0, 1), 2.0))
        stl = os.path.join(d, "scan.stl")
        MeshPart.meshFromShape(Shape=moved, MaxLength=1.5).write(stl)

        self.call("scan_open", {"path": stl})
        top = moved.Placement.multVec(App.Vector(20, 15, 10))
        fit = self.call("element_fit", {"kind": "plane", "at": {"point": [top.x, top.y, top.z]}})
        print("\nfit:", json.dumps(fit)[:400])
        self.call("deviation_open_reference", {"path": step})
        al = self.call("deviation_align", {})
        print("align:", json.dumps(al)[:400])
        els = self.call("element_list")
        print("elements:", json.dumps(els)[:400])
        el = (els.get("elements") or [els])[0]
        c = _centre(el.get("fit") or el)
        self.assertIsNotNone(c, el)
        # On the reference now: the top face at z = 10.
        self.assertAlmostEqual(c[2], 10.0, delta=0.05)
        tg = self.call("deviation_set_target", {"element": el.get("id", 1)})
        print("target:", json.dumps(tg)[:300])

    def test_pictures_of_the_maps(self):
        """The deviation and thickness maps drawn: the agent sees the boss
        stand proud where the numbers put it."""
        import base64

        import MeshPart
        import Part

        import FreeCAD as App
        from agentlink.tools import Session, build_server

        d = tempfile.mkdtemp()
        out = os.environ.get("AGENTLINK_RENDERS") or d
        os.makedirs(out, exist_ok=True)
        self.server = build_server(Session(out_dir=d), lean=False)
        box = Part.makeBox(40, 30, 10)
        step = os.path.join(d, "ref.step")
        box.exportStep(step)
        scanned = box.fuse(Part.makeCylinder(4, 0.5, App.Vector(28, 15, 10)))
        stl = os.path.join(d, "scan.stl")
        MeshPart.meshFromShape(Shape=scanned, MaxLength=1.0).write(stl)
        self.call("scan_open", {"path": stl})
        self.call("deviation_open_reference", {"path": step})
        self.call("deviation_align", {})
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "view_render", "arguments": {"map": "deviation", "views": ["iso", "top"], "path": os.path.join(out, "scan_deviation.png")}}})["result"]
        self.assertFalse(r.get("isError"), r)
        meta = json.loads(r["content"][0]["text"])
        print("\ndeviation picture:", json.dumps(meta["map"]))
        self.assertEqual(base64.b64decode(r["content"][1]["data"])[:4], b"\x89PNG")
        w = meta["map"]["worst"]
        self.assertAlmostEqual(w["value"], 0.5, delta=0.1)
        self.assertLess(math.hypot(w["at"][0] - 28, w["at"][1] - 15), 4.5)
        self.call("thickness_measure")
        t = self.call("view_render", {"map": "thickness", "views": "all", "section": {"axis": "y"}, "inline": False, "path": os.path.join(out, "scan_thickness.png")})
        print("thickness picture:", json.dumps(t["map"]))
        self.assertGreater(t["map"]["max"], 5)
        both = self.call("view_render", {"objects": [], "layers": ["scan", "reference"], "inline": False, "path": os.path.join(out, "scan_and_reference.png")})
        self.assertEqual(sorted(x["layer"] for x in both["layers"]), ["reference", "scan"])


if __name__ == "__main__":
    unittest.main()
