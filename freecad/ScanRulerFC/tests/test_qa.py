# SPDX-License-Identifier: AGPL-3.0-only
# The scan check: a plate's thickness and its closed skin, a wedge's taper
# called out, an open tube's rims read as circles, a CAD tessellation told.
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
from meshkit import box_mesh, cylinder_mesh, subdivide  # noqa: E402

try:
    from agentlink.protocol import ToolError  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False


@unittest.skipUnless(HAVE, "Agent Link is not importable here")
class QA(unittest.TestCase):
    def qa(self, V, F, **a):
        from scanrulerfc import fam_scan
        from scanrulerfc import scanstate as S

        class Sess:
            family_state = {}
            out_dir = "."

        s = Sess()
        S.state(s)["scan"] = S.Scan("part.stl", V, F)
        return next(t for t in fam_scan.tools(s) if t.name == "scan_qa").fn(a)

    def test_plate(self):
        V, F = box_mesh(40, 30, 4, n=24)
        V = V + np.random.default_rng(2).normal(0, 0.02, V.shape)
        o = self.qa(V, F)
        self.assertEqual(o["rims"]["count"], 0)
        self.assertAlmostEqual(o["thickness"]["p50"], 4, delta=0.1)
        self.assertEqual(o["thickness"]["axisFrom"], "the way most of the surface faces")
        self.assertTrue(any("Closed skin" in n for n in o["notes"]))
        self.assertNotIn("tessellation", o)

    def test_wedge(self):
        V, F = box_mesh(40, 30, 4, n=24)
        V = V.copy()
        top = V[:, 2] > 0
        V[top, 2] += 0.02 * (V[top, 0] + 20)  # 2 mm to 2.8 mm over 40
        V = V + np.random.default_rng(3).normal(0, 0.01, V.shape)
        o = self.qa(V, F, axis="z")
        self.assertGreater(o["thickness"]["tiltDeg"], 1)
        self.assertTrue(any("apart" in n for n in o["notes"]))

    def test_tube_and_cad(self):
        V, F = cylinder_mesh(5, 20, seg=64, rows=20, closed=False)
        V = V + np.random.default_rng(4).normal(0, 0.01, V.shape)
        o = self.qa(V, F, axis="z")
        self.assertEqual(o["rims"]["count"], 2)
        self.assertAlmostEqual(o["rims"]["largest"][0]["circle"]["diameter"], 10, delta=0.1)
        Vb, Fb = subdivide(*box_mesh(20, 20, 20, n=2), 4.0)
        o = self.qa(Vb, Fb)
        self.assertTrue(o["tessellation"]["cad"])
        self.assertEqual(o["noise"]["median"], 0)


if __name__ == "__main__":
    unittest.main()
