# SPDX-License-Identifier: AGPL-3.0-only
# Rotational repeats on a fan's cut: six blades round a hub read as six,
# the hub as a ring, and the one blade set 3° out of place found.
import math
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from scanrulerfc import repeat_core as RC  # noqa: E402


def blade(angle, r0=10.0, r1=22.0, w=3.0):
    pts = np.array([[r0, -w / 2], [r1, -w / 2], [r1, w / 2], [r0, w / 2], [r0, -w / 2]])
    # a few points along each side, so the outline is sampled evenly
    dense = np.concatenate([np.linspace(pts[i], pts[i + 1], 20, endpoint=False) for i in range(4)] + [pts[-1:]])
    c, s = math.cos(angle), math.sin(angle)
    return dense @ np.array([[c, s], [-s, c]])


class Repeat(unittest.TestCase):
    def test_fan(self):
        a = np.linspace(0, 2 * math.pi, 200)
        hub = np.column_stack([5 * np.cos(a), 5 * np.sin(a)])
        angles = [math.radians(15 + 60 * k) for k in range(6)]
        angles[4] += math.radians(3)
        r = RC.rotational_repeat([hub] + [blade(t) for t in angles])
        self.assertEqual(r["count"], 6, (r.get("tried"), r["score"]))
        self.assertEqual(len(r["rings"]), 1)
        self.assertAlmostEqual(r["rings"][0]["radius"], 5, delta=0.05)
        offs = [abs(i["offDeg"]) for i in r["instances"]]
        self.assertGreater(max(offs), 2)
        self.assertEqual(int(np.argmax(offs)), r["worstInstance"])

    def test_plain_ring_is_no_pattern(self):
        a = np.linspace(0, 2 * math.pi, 400)
        r = RC.rotational_repeat([np.column_stack([8 * np.cos(a), 8 * np.sin(a)]), np.column_stack([3 * np.cos(a), 3 * np.sin(a)])])
        self.assertEqual(r["count"], 1)
        self.assertEqual(len(r["rings"]), 2)


try:
    from agentlink.protocol import ToolError  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False


@unittest.skipUnless(HAVE, "Agent Link is not importable here")
class Tool(unittest.TestCase):
    def test_scan_pattern(self):
        sys.path.insert(0, HERE)
        from meshkit import box_mesh, cylinder_mesh
        from scanrulerfc import fam_scan
        from scanrulerfc import scanstate as S

        parts = [cylinder_mesh(5, 10, seg=96, rows=4)]
        for k in range(5):
            V, F = box_mesh(12, 3, 10, n=6, center=(16, 0, 0))
            t = math.radians(72 * k + 10)
            c, s_ = math.cos(t), math.sin(t)
            parts.append((V @ np.array([[c, s_, 0], [-s_, c, 0], [0, 0, 1]]), F))
        Vs, Fs, base = [], [], 0
        for V, F in parts:
            Vs.append(V)
            Fs.append(F + base)
            base += len(V)

        class Sess:
            family_state = {}
            out_dir = "."

        sess = Sess()
        S.state(sess)["scan"] = S.Scan("fan.stl", np.concatenate(Vs), np.concatenate(Fs))
        tool = next(t for t in fam_scan.tools(sess) if t.name == "scan_pattern")
        o = tool.fn({"axis": "Z", "at": [0.5]})
        h = o["heights"][0]
        self.assertEqual(h["count"], 5, h)
        self.assertAlmostEqual(h["rings"][0]["radius"], 5, delta=0.05)


if __name__ == "__main__":
    unittest.main()
