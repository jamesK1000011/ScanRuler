# SPDX-License-Identifier: AGPL-3.0-only
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
try:
    import FreeCAD  # noqa: F401
    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False


def sphere_stl(path, r=10.0, n=40):
    import Mesh

    m = Mesh.createSphere(r, n)
    m.write(path)


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Scan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from agentlink.tools import Session, build_server

        cls.dir = tempfile.mkdtemp()
        cls.server = build_server(Session(out_dir=cls.dir), lean=False)
        cls.stl = os.path.join(cls.dir, "ball.stl")
        sphere_stl(cls.stl)

    def call(self, name, args=None):
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        return r.get("isError", False), json.loads(r["content"][0]["text"])

    def test_open(self):
        err, o = self.call("scan_open", {"path": self.stl})
        self.assertFalse(err, o)
        self.assertGreater(o["opened"]["triangles"], 100)
        self.assertAlmostEqual(o["opened"]["box"]["size"][0], 20, delta=0.5)
        err, i = self.call("scan_info")
        self.assertEqual(i["elements"], 0)
        err, e = self.call("scan_open", {"path": "/nope.stl"})
        self.assertTrue(err)


if __name__ == "__main__":
    unittest.main()
