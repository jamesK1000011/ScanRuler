# SPDX-License-Identifier: AGPL-3.0-only
# The wall thickness tools through Agent Link, on a "scan" of a hollow box
# made in FreeCAD: 4 mm of wall all round.
import json
import os
import sys
import tempfile
import unittest

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


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Thickness(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import FreeCAD
        import Part
        from agentlink.tools import Session, build_server

        from test_deviation import mesh_of, write_obj

        cls.dir = tempfile.mkdtemp()
        cls.server = build_server(Session(out_dir=cls.dir), lean=False)
        shell = Part.makeBox(20, 20, 20).cut(Part.makeBox(12, 12, 12, FreeCAD.Vector(4, 4, 4)))
        V, F = mesh_of(shell, 2.0)
        cls.obj = os.path.join(cls.dir, "shell.obj")
        write_obj(cls.obj, V, F)

    def call(self, name, args=None):
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        return r.get("isError", False), json.loads(r["content"][0]["text"])

    def test_reads_a_known_wall(self):
        err, o = self.call("thickness_measure")
        self.assertTrue(err, "no scan, no measurement")
        err, o = self.call("scan_open", {"path": self.obj})
        self.assertFalse(err, o)
        err, o = self.call("thickness_settings", {"maxThickness": 6, "limit": 1})
        self.assertFalse(err, o)
        self.assertEqual(o["thickness"]["settings"]["maxThickness"], 6)
        err, o = self.call("thickness_measure")
        self.assertFalse(err, o)
        s = o["thickness"]["stats"]
        self.assertGreater(s["measured"], 0.5 * s["total"])
        # 4 mm square across a face; up to 4 * sqrt(2) along an edge's normal.
        self.assertGreater(s["min"], 3.9)
        self.assertLessEqual(s["max"], 6)
        self.assertAlmostEqual(s["mean"], 4, delta=0.5)
        self.assertEqual(s["belowLimit"], 0)
        self.assertEqual(o["thinSpots"]["count"], 0)
        self.assertIn("ScanRuler — wall thickness", o["report"])

        err, o = self.call("thickness_settings", {"limit": 4.5})
        self.assertFalse(err, o)
        self.assertGreater(o["thickness"]["stats"]["belowLimit"], 0)
        self.assertGreater(o["thinSpots"]["found"], 0)
        spot = o["thinSpots"]["patches"][0]
        self.assertAlmostEqual(spot["minThickness"], 4, delta=0.1)

        err, o = self.call("thickness_measure", {"method": "sphere"})
        self.assertFalse(err, o)
        self.assertAlmostEqual(o["thickness"]["stats"]["mean"], 4, delta=0.5)
        self.assertLessEqual(o["thickness"]["stats"]["max"], 6)


if __name__ == "__main__":
    unittest.main()
