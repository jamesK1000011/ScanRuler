# SPDX-License-Identifier: AGPL-3.0-only
# A height map of a two-tier block: the grid reads 10 and 15 mm, the levels
# gather into the two tiers, each with a level plane facing up.
import os
import sys
import tempfile
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
from meshkit import box_mesh  # noqa: E402

try:
    from agentlink.protocol import ToolError  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False


@unittest.skipUnless(HAVE, "Agent Link is not importable here")
class Heightmap(unittest.TestCase):
    def test_tiers(self):
        from scanrulerfc import fam_scan
        from scanrulerfc import scanstate as S

        a = box_mesh(40, 30, 10, n=12, center=(0, 0, 5))
        b = box_mesh(20, 30, 5, n=12, center=(10, 0, 12.5))
        V = np.concatenate([a[0], b[0]]) + np.random.default_rng(7).normal(0, 0.01, (len(a[0]) + len(b[0]), 3))
        F = np.concatenate([a[1], b[1] + len(a[0])])

        class Sess:
            family_state = {}
            out_dir = tempfile.mkdtemp()

        s = Sess()
        S.state(s)["scan"] = S.Scan("tiers.stl", V, F)
        tool = next(t for t in fam_scan.tools(s) if t.name == "scan_heightmap")
        o = tool.fn({})
        self.assertAlmostEqual(o["max"], 15, delta=0.1)
        vals = np.array([x for row in o["grid"] for x in row if x is not None])
        self.assertAlmostEqual(float(np.percentile(vals, 10)), 10, delta=0.1)  # a few edge cells graze the walls
        o = tool.fn({"levels": True, "picture": True})
        hs = sorted(round(l["height"]) for l in o["levels"][:2])
        self.assertEqual(hs, [10, 15])
        for l in o["levels"][:2]:
            self.assertGreater(l["sharePct"], 40)
            self.assertGreater(l["plane"]["normal"][2], 0.999)
        self.assertTrue(os.path.isfile(o["picture"]["path"]))


    def _tool(self, V, F, name="t.stl"):
        from scanrulerfc import fam_scan
        from scanrulerfc import scanstate as S

        class Sess:
            family_state = {}
            out_dir = tempfile.mkdtemp()

        s = Sess()
        S.state(s)["scan"] = S.Scan(name, V, F)
        return s, next(t for t in fam_scan.tools(s) if t.name == "scan_heightmap")

    @staticmethod
    def _sheet(fn, n=60, size=60.0):
        x = np.linspace(-size / 2, size / 2, n)
        X, Y = np.meshgrid(x, x)
        Z = fn(X, Y)
        V = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
        F = []
        for r in range(n - 1):
            for c in range(n - 1):
                i = r * n + c
                F += [[i, i + 1, i + n + 1], [i, i + n + 1, i + n]]
        return V, np.array(F)

    def test_plane_mode(self):
        a = box_mesh(40, 30, 10, n=12, center=(0, 0, 5))
        s, tool = self._tool(*a)
        o = tool.fn({"plane": "XY"})
        self.assertEqual(o["along"], "normal")
        self.assertAlmostEqual(o["max"], 10, delta=0.05)
        o = tool.fn({"plane": "XY", "flip": True})
        self.assertTrue(o["plane"]["flipped"])
        self.assertAlmostEqual(o["max"], 0, delta=0.05)  # looking up from below: the base, height counted down the flipped normal
        o = tool.fn({"plane": {"origin": [0, 0, 10], "normal": [0, 0, 1]}, "levels": True})
        self.assertGreater(o["levels"][0]["plane"]["normal"][2], 0.999)
        self.assertAlmostEqual(o["levels"][0]["plane"]["origin"][2], 10, delta=0.05)
        with self.assertRaises(Exception):
            tool.fn({"plane": "XY", "axis": "-z"})
        with self.assertRaises(Exception):
            tool.fn({"flip": True})
        with self.assertRaises(Exception):
            tool.fn({"smooth": 2})
        with self.assertRaises(Exception):
            tool.fn({"slopeDeg": 20})
        o = tool.fn({"plane": "XY", "box": {"min": [500, 500, -5], "max": [520, 520, 20]}})
        self.assertIn("scanLies", o)

    def test_relief(self):
        # A raised round boss 0.6 mm high, 8 mm across, on a sheet leaning 10°.
        lean = np.tan(np.radians(10))
        V, F = self._sheet(lambda X, Y: lean * X + 0.6 * (np.hypot(X - 5, Y) < 4), n=121)
        s, tool = self._tool(V, F)
        o = tool.fn({"of": "relief", "cell": 1.0, "smooth": 6})
        G = np.array([[np.nan if x is None else x for x in row] for row in o["grid"]])
        cell = o["cell"]
        c0, r0 = int((5 - o["origin"][0]) // cell), int((0 - o["origin"][1]) // cell)
        self.assertGreater(G[r0, c0], 0.3)
        far = G[2:6, 2:6]
        self.assertLess(float(np.nanmax(np.abs(far))), 0.05)

    def test_warp(self):
        # A sheet bowed 1.5 mm with a pad 0.8 mm proud of it: read straight,
        # the bow runs the sheet and the pad together.
        bow = lambda X, Y: 1.5 * (X ** 2 + Y ** 2) / (2 * 30 ** 2)
        V, F = self._sheet(lambda X, Y: bow(X, Y) + 0.8 * ((np.abs(X) < 8) & (np.abs(Y) < 8)), n=121)
        s, tool = self._tool(V, F)
        o = tool.fn({"levels": True, "cell": 1.0})
        self.assertIn("warp", o)
        tall = [l for l in o["levels"] if l["sharePct"] >= 5]
        self.assertGreaterEqual(len(tall), 2)
        gap = abs(tall[0]["height"] - tall[1]["height"])
        self.assertAlmostEqual(gap, 0.8, delta=0.15)

    def test_deviation(self):
        from scanrulerfc import fam_deviation as FD

        V, F = self._sheet(lambda X, Y: 0 * X, n=31)
        s, tool = self._tool(V, F)
        d = FD.dstate(s)
        from scanrulerfc import scanstate as S

        d["scan"] = S.state(s)["scan"]
        d["values"] = V[:, 0] / 100.0  # reading x/100 mm
        d["maxDistance"] = 3.0
        o = tool.fn({"of": "deviation", "cell": 5.0})
        G = np.array([[np.nan if x is None else x for x in row] for row in o["grid"]])
        xs = o["origin"][0] + (np.arange(o["cols"]) + 0.5) * 5.0
        np.testing.assert_allclose(np.nanmean(G, 0), xs / 100.0, atol=1e-3)
        d["values"] = None
        with self.assertRaises(Exception):
            tool.fn({"of": "deviation"})


if __name__ == "__main__":
    unittest.main()
