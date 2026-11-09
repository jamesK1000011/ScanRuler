# SPDX-License-Identifier: AGPL-3.0-only
# The measuring tools through Agent Link's server, on scans made with
# FreeCAD's Mesh module (a sphere) and with numpy (a box, a shaft), noise
# added along the normals, written to STL and opened with scan_open.
import json
import os
import sys
import tempfile
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
try:
    import FreeCAD  # noqa: F401
    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False

import synth  # noqa: E402


def freecad_sphere(path, r=12.5, sampling=60, sigma=0.01):
    import Mesh

    m = Mesh.createSphere(r, sampling)
    pts, tris = m.Topology
    P = np.array([[p.x, p.y, p.z] for p in pts]) + np.array([3.0, -2.0, 7.0])
    F = np.array(tris, dtype=np.int64)
    synth.stl(path, *synth.noisy(P, F, sigma))


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Measure(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from agentlink.tools import Session, build_server

        cls.dir = tempfile.mkdtemp()
        cls.server = build_server(Session(out_dir=cls.dir), lean=False)
        cls.ball = os.path.join(cls.dir, "ball.stl")
        freecad_sphere(cls.ball)
        cls.box = os.path.join(cls.dir, "box.stl")
        synth.stl(cls.box, *synth.box(size=(40, 30, 20), sigma=0.01))
        cls.shaft = os.path.join(cls.dir, "shaft.stl")
        synth.stl(cls.shaft, *synth.cylinder(r=8, h=30, sigma=0.01))

    def call(self, name, args=None):
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        return r.get("isError", False), json.loads(r["content"][0]["text"])

    def ok(self, name, args=None):
        err, o = self.call(name, args)
        self.assertFalse(err, f"{name}: {o}")
        return o

    def open(self, path):
        return self.ok("scan_open", {"path": path, "discard": True})

    def test_tools_listed(self):
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})["result"]
        names = {t["name"] for t in r["tools"]}
        for n in ("scan_nearest", "scan_query", "scan_segment", "element_fit", "element_construct", "align_datum", "align_symmetry", "scan_scale", "dimension_add", "report_get", "export_csv"):
            self.assertIn(n, names)

    def test_sphere_from_freecad(self):
        self.open(self.ball)
        near = self.ok("scan_nearest", {"at": {"point": [3 + 12.5, -2, 7]}})
        self.assertLess(near["distance"], 1.0)
        el = self.ok("element_fit", {"kind": "sphere", "at": {"vertex": near["vertex"]}})["element"]
        self.assertAlmostEqual(el["fit"]["radius"], 12.5, delta=0.05)
        np.testing.assert_allclose(el["fit"]["center"], [3, -2, 7], atol=0.05)
        held = self.ok("element_fit", {"kind": "sphere", "at": {"vertex": near["vertex"]}, "knownDiameter": 25})["element"]
        self.assertEqual(held["fit"]["radius"], 12.5)
        d = self.ok("dimension_add", {"refs": [el["id"]], "type": "size-diameter", "limit": {"kind": "band", "nominal": 25, "plus": 0.1, "minus": 0.1}})["dimension"]
        self.assertTrue(d["verdict"]["pass"])
        s = self.ok("dimension_add", {"refs": [el["id"]], "type": "form-sphericity"})["dimension"]
        self.assertLess(s["value"], 0.2)
        err, o = self.call("element_fit", {"kind": "point", "at": [{"vertex": 0}, {"vertex": 1}]})
        self.assertTrue(err)

    def test_shaft(self):
        self.open(self.shaft)
        el = self.ok("element_fit", {"kind": "cylinder", "at": {"point": [8, 0, 15]}, "side": "outside"})
        f = el["element"]["fit"]
        self.assertAlmostEqual(f["radius"], 8, delta=0.01)
        self.assertGreater(abs(f["axis"][2]), 0.9999)
        circ = self.ok("element_fit", {"kind": "circle", "at": [{"point": [8, 0, 15]}, {"point": [0, 8, 15]}, {"point": [-8, 0, 15]}, {"point": [0, -8, 15]}]})["element"]
        self.assertAlmostEqual(circ["fit"]["radius"], 8, delta=0.1)
        cyl = self.ok("dimension_add", {"refs": [el["element"]["id"]], "type": "form-cylindricity"})["dimension"]
        self.assertLess(cyl["value"], 0.1)

    def test_box_flow(self):
        self.open(self.box)
        seg = self.ok("scan_segment", {})
        self.assertEqual(seg["found"], 6)
        q = self.ok("scan_query", {"box": {"min": [-1, -1, 19.9], "max": [41, 31, 20.1]}, "normal": {"dir": [0, 0, 1]}, "limit": 50, "mark": True})
        self.assertGreater(q["matched"], 500)
        top = self.ok("element_fit_marked", {"kind": "plane", "marked": True, "name": "Top"})["element"]
        bottom = self.ok("element_fit", {"kind": "plane", "at": {"point": [20, 15, 0]}})["element"]
        side = self.ok("element_fit", {"kind": "plane", "at": {"point": [0, 15, 10]}})["element"]
        front = self.ok("element_fit", {"kind": "plane", "at": {"point": [20, 0, 10]}})["element"]
        h = self.ok("dimension_add", {"refs": ["Top", bottom["id"]], "limit": {"kind": "band", "nominal": 20, "plus": 0.05, "minus": 0.05}})["dimension"]
        self.assertEqual(h["type"], "dist-plane-plane")
        self.assertAlmostEqual(h["value"], 20, delta=0.01)
        ang = self.ok("dimension_add", {"refs": [side["id"], bottom["id"]], "type": "angle-plane-plane"})["dimension"]
        self.assertAlmostEqual(ang["value"], 90, delta=0.1)
        perp = self.ok("dimension_add", {"refs": [side["id"], bottom["id"]], "type": "orient-perpendicularity", "limit": {"kind": "max", "max": 0.1}})["dimension"]
        self.assertTrue(perp["verdict"]["pass"])
        flat = self.ok("dimension_add", {"refs": ["Top"], "type": "form-flatness"})["dimension"]
        self.ok("dimension_set_limit", {"dimension": flat["id"], "limit": {"kind": "max", "max": 0.001}})
        corner = self.ok("element_construct", {"kind": "point", "method": "point-three-planes", "refs": [bottom["id"], side["id"], front["id"]]})["element"]
        np.testing.assert_allclose(corner["fit"]["center"], [0, 0, 0], atol=0.02)
        mid = self.ok("element_construct", {"kind": "plane", "method": "plane-midplane", "refs": ["Top", bottom["id"]]})["element"]
        self.assertAlmostEqual(mid["fit"]["center"][2], 10, delta=0.01)
        # Level on the top face, upside down; clock on the front; zero at the corner.
        a = self.ok("align_datum", {"primary": {"element": "Top"}, "primaryAxis": "z-", "secondary": {"element": front["id"]}, "secondaryAxis": "y-", "origin": {"element": corner["id"]}})
        self.assertEqual(a["elements"], 6)
        c = self.ok("element_list")["elements"]
        # The top owns z (it lands on 0, the part below it); the corner the
        # two coordinates left open.
        moved = next(e for e in c if e["id"] == corner["id"])
        np.testing.assert_allclose(moved["fit"]["center"], [0, 0, 20], atol=0.02)
        self.assertAlmostEqual(next(e for e in c if e["name"] == "Top")["fit"]["center"][2], 0, delta=1e-6)
        info = self.ok("scan_info")
        self.assertAlmostEqual(info["scan"]["box"]["min"][2], 0, delta=0.05)
        self.assertAlmostEqual(info["scan"]["box"]["max"][2], 20, delta=0.05)
        self.assertAlmostEqual(self.ok("report_get")["report"]["dimensions"][0]["value"], 20, delta=0.01)
        self.ok("align_clear")
        self.assertAlmostEqual(self.ok("scan_info")["scan"]["box"]["min"][2], 0, delta=0.05)
        rep = self.ok("report_get", {"format": "json"})["report"]
        self.assertEqual(rep["checks"], {"checked": 3, "pass": 2, "fail": 1})
        txt = self.ok("report_get", {"format": "text"})["text"]
        self.assertIn("Checked against limits: 3 — 2 pass, 1 fail", txt)
        out = self.ok("export_csv", {"path": os.path.join(self.dir, "box.csv")})
        with open(out["path"]) as fh:
            self.assertIn("dist-plane-plane", fh.read())
        sc = self.ok("scan_scale", {"references": [{"dimension": h["id"], "true": 40}], "dryRun": True})
        self.assertAlmostEqual(sc["factor"], 2, delta=0.002)
        self.ok("scan_scale", {"factor": 0.5})
        self.assertAlmostEqual(self.ok("report_get")["report"]["dimensions"][0]["value"], 10, delta=0.01)
        self.ok("element_rename", {"element": side["id"], "name": "Datum A"})
        self.ok("element_set_visible", {"element": "Datum A", "visible": False})
        sym = self.ok("element_construct", {"kind": "plane", "method": "plane-symmetry", "seed": "XZ"})
        self.assertLess(sym["symmetry"]["rms"], 0.05)
        self.assertIn("Settled", self.ok("align_symmetry")["note"])
        self.ok("align_clear")
        gone = self.ok("element_remove", {"element": bottom["id"]})
        self.assertGreaterEqual(len(gone["removed"]), 3)
        err, o = self.call("align_clear")
        self.assertTrue(err)


if __name__ == "__main__":
    unittest.main()
