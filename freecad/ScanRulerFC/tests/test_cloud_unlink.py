# SPDX-License-Identifier: AGPL-3.0-only
# The scan as a point cloud, and a construction frozen where it stands.
import os
import struct
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
from meshkit import box_mesh  # noqa: E402

try:
    from agentlink.protocol import ToolError

    HAVE = True
except ImportError:
    HAVE = False


@unittest.skipUnless(HAVE, "Agent Link is not importable here")
class Tools(unittest.TestCase):
    def setUp(self):
        from scanrulerfc import fam_elements, fam_scan
        from scanrulerfc import scanstate as S

        class Sess:
            family_state = {}
            out_dir = tempfile.mkdtemp()

        self.s = Sess()
        V, F = box_mesh(10, 10, 10, n=4)
        S.state(self.s)["scan"] = S.Scan("b.stl", V, F)
        self.T = {t.name: t for t in fam_scan.tools(self.s) + fam_elements.tools(self.s)}

    def test_cloud(self):
        o = self.T["scan_cloud"].fn({})
        with open(o["file"]["path"], "rb") as f:
            data = f.read()
        head, body = data.split(b"end_header\n", 1)
        self.assertIn(b"element vertex %d" % o["points"], head)
        self.assertEqual(len(body), 24 * o["points"])
        x, y, z = struct.unpack("<3f", body[:12])
        self.assertLessEqual(max(abs(x), abs(y), abs(z)), 5.0001)
        o = self.T["scan_cloud"].fn({"format": "xyz"})
        with open(o["file"]["path"]) as f:
            self.assertEqual(len(f.readline().split()), 6)

    def test_unlink(self):
        c = self.T["element_construct"].fn
        p1 = c({"kind": "point", "method": "point-coords", "params": [0, 0, 0]})["element"]
        p2 = c({"kind": "point", "method": "point-coords", "params": [3, 4, 0]})["element"]
        ln = c({"kind": "line", "method": "line-two-points", "refs": [p1["id"], p2["id"]]})["element"]
        u = self.T["element_unlink"].fn({"element": ln["id"]})["element"]
        self.assertEqual((u["source"]["method"], u["source"]["refs"]), ("line-coords", []))
        self.assertEqual(u["source"]["params"][:2], [0.6, 0.8])
        with self.assertRaises(ToolError):
            self.T["element_unlink"].fn({"element": p1["id"]})


if __name__ == "__main__":
    unittest.main()
