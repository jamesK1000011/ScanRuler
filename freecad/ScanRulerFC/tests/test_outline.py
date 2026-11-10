# SPDX-License-Identifier: AGPL-3.0-only
# The outline of a plate seen from above: a rounded rectangle with a round
# hole, read back as four corners with their rounds and one circle.
import os
import sys
import tempfile
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

try:
    from agentlink.protocol import ToolError  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False


def plate(w=40.0, h=30.0, r=5.0, hole=5.0, step=0.1):
    """A flat plate (top face only) as a triangle soup over a fine grid,
    the cells outside the rounded rectangle or inside the hole left out."""
    xs = np.arange(-w / 2, w / 2 + 1e-9, step)
    ys = np.arange(-h / 2, h / 2 + 1e-9, step)

    def inside(x, y):
        qx, qy = abs(x) - (w / 2 - r), abs(y) - (h / 2 - r)
        out = np.hypot(max(qx, 0), max(qy, 0)) <= r
        return out and np.hypot(x, y) >= hole

    V, F = [], []
    for x in xs[:-1]:
        for y in ys[:-1]:
            cx, cy = x + step / 2, y + step / 2
            if not inside(cx, cy):
                continue
            i = len(V)
            V += [[x, y, 2], [x + step, y, 2], [x + step, y + step, 2], [x, y + step, 2]]
            F += [[i, i + 1, i + 2], [i, i + 2, i + 3]]
    return np.array(V, float), np.array(F)


@unittest.skipUnless(HAVE, "Agent Link is not importable here")
class Outline(unittest.TestCase):
    def test_plate(self):
        from scanrulerfc import fam_scan
        from scanrulerfc import scanstate as S

        V, F = plate()

        class Sess:
            family_state = {}
            out_dir = tempfile.mkdtemp()

        s = Sess()
        S.state(s)["scan"] = S.Scan("plate.stl", V, F)
        tool = next(t for t in fam_scan.tools(s) if t.name == "scan_outline")
        o = tool.fn({"tolerance": 0.3})
        outer, hole = o["loops"][0], o["loops"][1]
        self.assertFalse(outer["hole"])
        self.assertTrue(hole["hole"])
        self.assertAlmostEqual(hole["circle"]["radius"], 5, delta=0.25)
        self.assertEqual(len(outer["points"]), 4)
        self.assertEqual(len(outer["rounds"]), 4)
        for r in outer["rounds"]:
            self.assertAlmostEqual(r["radius"], 5, delta=0.4)
        xs = sorted(abs(p[0]) for p in outer["points"])
        self.assertAlmostEqual(xs[0], 20, delta=0.3)


if __name__ == "__main__":
    unittest.main()
