# SPDX-License-Identifier: AGPL-3.0-only
# ScanRuler 0.10.1-0.11.2 brought in: form tolerances by the minimum zone, a
# section on the bottom face, DXF text on one line, fit guides that move with
# the part, the curvature comb.
import json
import math
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

from scanrulerfc import curvature as K  # noqa: E402
from scanrulerfc import dimensions as D  # noqa: E402
from scanrulerfc import section_core as SC  # noqa: E402
from scanrulerfc.flat_core import dxf_text  # noqa: E402
from scanrulerfc.min_zone import minimum_zone  # noqa: E402


class MinimumZone(unittest.TestCase):
    def test_raised_corner_reads_narrower_than_peak_to_peak(self):
        rng = np.random.default_rng(1)
        x, y = rng.uniform(0, 50, (2, 4000))
        z = 0.002 * rng.standard_normal(4000) + np.where((x > 45) & (y > 45), 0.05, 0) + 0.001 * x
        P = np.c_[x, y, z]
        c = P.mean(0)
        n = np.linalg.svd(P - c)[2][2]
        z = minimum_zone(P, {"kind": "plane", "center": c, "normal": n})
        self.assertLess(z["width"], z["start"])
        # Tilted plane, exactly: zero.
        Q = np.c_[x, y, 0.01 * x + 0.02 * y]
        self.assertLess(minimum_zone(Q, {"kind": "plane", "center": Q.mean(0), "normal": [0, 0, 1]})["width"], 1e-6)

    def test_sphere_off_centre_and_flatness_tolerance(self):
        rng = np.random.default_rng(2)
        S = rng.standard_normal((3000, 3))
        S = S / np.linalg.norm(S, axis=1)[:, None] * 5 + [0.01, 0, 0]
        self.assertLess(minimum_zone(S, {"kind": "sphere", "center": [0, 0.02, 0]})["width"], 1e-6)
        fit = {"kind": "plane", "center": [0, 0, 0], "normal": [0, 0, 1], "formError": 0.2, "usedPoints": 4}
        pts = np.array([[0, 0, 0], [10, 0, 0.1], [0, 10, 0], [10, 10, 0.1]], float)
        v = D.evaluate_tolerance("form-flatness", [fit], surfaces=[pts])
        self.assertAlmostEqual(v["raw"], 0.0, places=6)
        self.assertIn("Minimum zone", v["detail"])
        v = D.evaluate_tolerance("form-flatness", [fit])
        self.assertEqual(v["raw"], 0.2)


class SectionAndDxf(unittest.TestCase):
    def test_bottom_face_cuts(self):
        V = np.array([[x, y, z] for z in (0, 10) for y in (0, 10) for x in (0, 10)], float)
        F = np.array([[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 5], [0, 5, 4], [2, 6, 7], [2, 7, 3], [0, 4, 6], [0, 6, 2], [1, 3, 7], [1, 7, 5]])
        for z in (0, 10):
            for nz in (1, -1):
                pts, off, _ = SC.slice_mesh(V, F, [0, 0, z], [0, 0, nz])
                self.assertEqual(len(off) - 1, 1, (z, nz))

    def test_dxf_text_on_one_line(self):
        self.assertEqual(dxf_text("a\nb · c"), "a b, c")


class Curvature(unittest.TestCase):
    def test_round_reads_its_radius(self):
        rng = np.random.default_rng(0)
        t = np.linspace(0, 2 * np.pi, int(2 * np.pi * 5 / 0.4) + 1)
        C = np.c_[5 * np.cos(t), 5 * np.sin(t)] + 0.03 * rng.standard_normal((len(t), 2))
        C[-1] = C[0]
        r = K.chain_run(C, 2.0)
        self.assertTrue(r["closed"])
        st = K.stretches(r, 2.0)
        self.assertEqual([s["kind"] for s in st], ["arc"])
        self.assertAlmostEqual(st[0]["radius"], 5, delta=0.1)

    def test_fillet_between_flats(self):
        rng = np.random.default_rng(4)
        pts = [(x, 0) for x in np.arange(0, 20, 0.3)]
        pts += [(20 + 5 * math.cos(a), 5 + 5 * math.sin(a)) for a in np.linspace(-math.pi / 2, 0, 26)]
        pts += [(25, y) for y in np.arange(5, 25, 0.3)]
        P = np.array(pts) + 0.02 * rng.standard_normal((len(pts), 2))
        kinds = [(s["kind"], round(s.get("radius", 0))) for s in K.stretches(K.chain_run(P, 2.0), 2.0)]
        self.assertIn(("arc", 5), kinds)
        self.assertEqual(kinds[0][0], "straight")
        self.assertEqual(kinds[-1][0], "straight")

    def test_exact_arc(self):
        self.assertAlmostEqual(K.stretches(K.fit_run({"kind": "arc", "center": [0, 0], "radius": 3, "start": 0, "sweep": 1.0}))[0]["radius"], 3)


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Tools(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import Mesh
        from agentlink.tools import Session, build_server

        cls.dir = tempfile.mkdtemp()
        cls.session = Session(out_dir=cls.dir)
        cls.server = build_server(cls.session, lean=False)
        cls.cyl = os.path.join(cls.dir, "cyl.stl")
        Mesh.createCylinder(8.0, 30.0, True, 0.05, 180).write(cls.cyl)

    def call(self, name, args=None):
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        return r.get("isError", False), json.loads(r["content"][0]["text"])

    def ok(self, name, args=None):
        err, o = self.call(name, args)
        self.assertFalse(err, f"{name}: {o}")
        return o

    def test_section_comb(self):
        self.ok("scan_open", {"path": self.cyl, "discard": True})
        size = self.ok("scan_info")["scan"]["box"]["size"]
        self.ok("section_cut", {"across": {0: "YZ", 1: "XZ", 2: "XY"}[int(np.argmax(size))], "name": "Round"})
        if self.session.doc is None:
            self.ok("doc_new", {"name": "Comb"})
        c = self.ok("flat_curvature", {"chains": [0], "comb": True})
        st = c["items"][0]["stretches"]
        arcs = [s for s in st if s["kind"] == "arc"]
        self.assertTrue(arcs, st)
        self.assertAlmostEqual(arcs[0]["radius"], 8, delta=0.3)
        self.assertTrue(arcs[0].get("convex"), arcs[0])
        self.assertGreater(c["comb"]["teeth"], 10)
        err, _ = self.call("flat_curvature", {})
        self.assertTrue(err)


if __name__ == "__main__":
    unittest.main()
