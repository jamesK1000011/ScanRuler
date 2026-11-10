# SPDX-License-Identifier: AGPL-3.0-only
# Scanner noise: the reading on scans of known noise, the CAD tessellation
# refused, the rule for the noise to plan with, and the scanners kept as
# the person's own file, exported and imported.
import json
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

import synth  # noqa: E402
from meshkit import box_mesh, subdivide  # noqa: E402
from scanrulerfc import noise_core as N  # noqa: E402
from scanrulerfc.meshgraph import MeshGraph  # noqa: E402

try:
    import FreeCAD  # noqa: F401
    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False


class Reading(unittest.TestCase):
    def test_noise_follows_the_scatter(self):
        # A plane fit's rms over ~2 rings reads a little under the scatter's
        # sigma (the fit takes some up), but in proportion to it.
        read = []
        for sigma in (0.02, 0.08):
            P, F = synth.box(sigma=sigma)
            read.append(N.local_noise(MeshGraph(P, F))["median"])
            self.assertGreater(read[-1], 0.5 * sigma)
            self.assertLess(read[-1], 1.3 * sigma)
        self.assertAlmostEqual(read[1] / read[0], 4, delta=1)

    def test_cad_is_told_from_a_scan(self):
        V, F = box_mesh(20, 20, 20, n=6)
        cad, share = N.is_cad(MeshGraph(V, F))
        self.assertTrue(cad, share)
        P, F2 = synth.box(sigma=0.03)
        self.assertFalse(N.is_cad(MeshGraph(P, F2))[0])

    def test_spacing(self):
        V, F = subdivide(*box_mesh(10, 10, 10, n=1), 1.0)
        self.assertLess(N.point_spacing(np.asarray(V, float), F), 1.01)


class Rule(unittest.TestCase):
    def test_larger_of_the_two(self):
        n = N.plan({"name": "Revopoint", "noiseMm": 0.05}, {"sigmaMm": 0.02})
        self.assertEqual((n["source"], n["sigmaMm"], n["warning"]), ("profile", 0.05, None))
        n = N.plan({"name": "Revopoint", "noiseMm": 0.05}, {"sigmaMm": 0.09})
        self.assertEqual((n["source"], n["sigmaMm"]), ("measured", 0.09))
        self.assertEqual(n["warning"], {"kind": "worse-than-profile", "ratio": 1.8})
        n = N.plan(None, {"sigmaMm": 0.03})
        self.assertEqual(n["warning"], {"kind": "no-profile"})
        self.assertIsNone(N.plan(None, None))
        self.assertEqual(N.answer(n)["finestMm"], 0.09)
        self.assertEqual(N.at_least(0.01, n), 0.03)
        self.assertEqual(N.at_least(0.05, n), 0.05)


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Tools(unittest.TestCase):
    def setUp(self):
        from agentlink.tools import Session, build_server

        self.dir = tempfile.mkdtemp()
        os.environ.pop("SCANRULERFC_SCANNERS", None)
        self.server = build_server(Session(out_dir=self.dir), lean=False)

    def call(self, name, args=None):
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        return r.get("isError", False), json.loads(r["content"][0]["text"])

    def test_scan_and_scanners(self):
        P, F = synth.sphere(r=20, n=160, m=80, sigma=0.05)
        path = os.path.join(self.dir, "ball.stl")
        synth.stl(path, P, F)
        self.assertFalse(self.call("scan_open", {"path": path})[0])
        err, o = self.call("scan_noise")
        self.assertFalse(err, o)
        self.assertEqual(o["plan"]["source"], "measured")
        self.assertIn("No scanner", o["plan"]["warning"])
        err, o = self.call("scanner", {"action": "add", "scanner": {"name": "Pocket", "noiseMm": 0.1}, "use": True})
        self.assertFalse(err, o)
        self.assertEqual((o["plan"]["source"], o["plan"]["sigmaMm"]), ("profile", 0.1))
        self.assertTrue(os.path.isfile(os.path.join(self.dir, "scanners.json")))
        err, o = self.call("scanner", {"action": "export"})
        self.assertFalse(err, o)
        # Into a fresh store, by file.
        self.call("scanner", {"action": "remove", "name": "Pocket"})
        self.assertEqual(self.call("scanner", {"action": "list"})[1]["scanners"], [])
        err, o = self.call("scanner", {"action": "import", "path": os.path.join(self.dir, "scanners-export.json")})
        self.assertEqual(o["imported"], ["Pocket"])
        self.assertTrue(self.call("scanner", {"action": "add", "scanner": {"name": "x", "noiseMm": 9}})[0])


if __name__ == "__main__":
    unittest.main()
