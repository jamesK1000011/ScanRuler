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


if __name__ == "__main__":
    unittest.main()
