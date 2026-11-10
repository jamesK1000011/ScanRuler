# SPDX-License-Identifier: AGPL-3.0-only
# Draft on a scan: a moulded box whose sides lean 2° toward the pull reads
# four patches at +2°; turned over, the same walls read −2° (back draft);
# a split plane keeps a wall's two halves apart.
import math
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
from meshkit import box_mesh  # noqa: E402
from scanrulerfc import draft_core as DC  # noqa: E402
from scanrulerfc.meshgraph import MeshGraph  # noqa: E402


def moulded(deg=2.0, n=30):
    V, F = box_mesh(40, 30, 20, n=n, center=(0, 0, 10))
    V = V.copy()
    k = math.tan(math.radians(deg)) * V[:, 2]
    V[:, 0] -= np.sign(V[:, 0]) * k
    V[:, 1] -= np.sign(V[:, 1]) * k
    V += np.random.default_rng(6).normal(0, 0.005, V.shape)
    g = MeshGraph(V, F)
    return g.P, g.N


class Draft(unittest.TestCase):
    def test_four_walls(self):
        P, N = moulded()
        r = DC.draft_patches(P, N, [0, 0, 1])
        walls = [p for p in r["patches"] if p["area"] > 100]
        self.assertEqual(len(walls), 4, [(round(p["draftDeg"], 2), round(p["area"])) for p in r["patches"]])
        for p in walls:
            self.assertAlmostEqual(p["draftDeg"], 2.0, delta=0.15)

    def test_back_draft_and_split(self):
        P, N = moulded()
        r = DC.draft_patches(P, N, [0, 0, -1])
        self.assertTrue(all(p["draftDeg"] < -1.8 for p in r["patches"] if p["area"] > 100))
        r = DC.draft_patches(P, N, [0, 0, 1], split={"point": [0, 0, 0], "normal": [1, 0, 0]})
        sides = sorted(p.get("side", 0) for p in r["patches"] if p["area"] > 100)
        self.assertEqual(len(sides), 6, sides)  # ±Y walls cut in two; ±X walls whole


if __name__ == "__main__":
    unittest.main()
