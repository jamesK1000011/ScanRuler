# SPDX-License-Identifier: AGPL-3.0-only
# Wear repair on a box dented on one side: read against its own mirrored
# half, rebuilt, kept regions left alone; and a pre-warp that undoes a
# print's swell, with the stop rule.
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

from meshkit import box_mesh  # noqa: E402
from scanrulerfc import wear_core as W  # noqa: E402

try:
    import FreeCAD  # noqa: F401
    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False

DENT = {"kind": "sphere", "center": [20, 0, 0], "radius": 6}


def dented(depth=0.5, sigma=0.01):
    V, F = box_mesh(40, 20, 20, n=40)
    V = V.copy()
    on = np.isclose(V[:, 0], 20)
    r = np.hypot(V[:, 1], V[:, 2])
    bump = np.clip(1 - r / 4, 0, 1)
    V[on, 0] -= depth * bump[on]
    V += np.random.default_rng(4).normal(0, sigma, V.shape)
    return V, F


class Core(unittest.TestCase):
    def test_regions(self):
        P = np.array([[20, 0, 0], [26.5, 0, 0], [30, 0, 0]], float)
        w = W.weight([DENT], [], 1.0, P)
        self.assertEqual(list(w), [1.0, 0.5, 0.0])
        self.assertEqual(list(W.weight([DENT], [{"kind": "box", "min": [19, -1, -1], "max": [21, 1, 1]}], 1.0, P)), [0.0, 0.5, 0.0])

    def test_mirror_reads_and_repairs_the_dent(self):
        V, F = dented()
        mV, mF = W.mirror(V, F, [0, 0, 0], [1, 0, 0])
        ref = W.surface(mV, mF)
        before = W.diff(V, ref, [{"name": "dent", "region": DENT}], 0.05, 2.0)[0]
        self.assertAlmostEqual(before["lost"], -0.5, delta=0.06)
        self.assertGreater(before["pointsLost"], 10)
        s = W.scatter(V, ref, [DENT], 2.0)
        self.assertLess(s["mm"], 0.03)
        self.assertEqual(W.tolerance_floor(s)["by"], "scatter")
        self.assertIsNotNone(W.scatter_note(s, 0.01))
        self.assertEqual(W.tolerance_floor(s, {"sigmaMm": 0.05})["by"], "noise")
        V2, moved, largest = W.rebuild(V, ref, [DENT], [], 1.0, 2.0)
        self.assertGreater(moved, 10)
        self.assertAlmostEqual(largest, 0.5, delta=0.06)
        after = W.diff(V2, ref, [{"name": "dent", "region": DENT}], 0.05, 2.0)[0]
        self.assertGreater(after["lost"], -0.05)
        # Kept, nothing moves.
        _V3, moved, _l = W.rebuild(V, ref, [DENT], [{"kind": "sphere", "center": [20, 0, 0], "radius": 7}], 1.0, 2.0)
        self.assertEqual(moved, 0)
        # Add mode leaves proud material; both trims it.
        Vp, Fp = dented(depth=-0.4)
        mVp, mFp = W.mirror(Vp, Fp, [0, 0, 0], [1, 0, 0])
        refp = W.surface(mVp, mFp)
        # (add still settles the scan's scatter under the surface.)
        self.assertLess(W.rebuild(Vp, refp, [DENT], [], 0, 2.0, "add")[2], 0.06)
        self.assertAlmostEqual(W.rebuild(Vp, refp, [DENT], [], 0, 2.0, "both")[2], 0.4, delta=0.06)

    def test_prewarp_undoes_a_swell(self):
        TV, TF = box_mesh(30, 20, 10, n=20)

        def printed(V):
            return V * 1.01  # the printer swells everything a percent

        tgt = W.surface(*map(np.asarray, (printed(TV), TF)))
        V1, res = W.prewarp(TV, TF, tgt, 1.0, 2, 2.0)
        self.assertGreater(res["rms"], 0.04)
        again = W.surface(printed(V1), TF)
        _V2, res2 = W.prewarp(TV, TF, again, 1.0, 2, 2.0)
        self.assertLess(res2["rms"], 0.4 * res["rms"])
        runs = [{"n": 1, "rms": res["rms"]}]
        self.assertFalse(W.stop_rule(runs, 0.01)["stop"])
        runs.append({"n": 2, "rms": 0.9 * res["rms"]})
        self.assertIn("less than a fifth", W.stop_rule(runs, 0.01)["why"])
        self.assertTrue(W.stop_rule([{"n": 1, "rms": 0.005}], 0.01)["stop"])

    def test_stl(self):
        V, F = box_mesh(10, 10, 10, n=2)
        p = os.path.join(tempfile.mkdtemp(), "b.stl")
        W.write_stl(p, V, F)
        self.assertEqual(os.path.getsize(p), 84 + 50 * len(F))


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Tools(unittest.TestCase):
    def test_through_agent_link(self):
        from agentlink.tools import Session, build_server

        d = tempfile.mkdtemp()
        server = build_server(Session(out_dir=d), lean=False)

        def call(n, a=None):
            r = server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": n, "arguments": a or {}}})["result"]
            return r.get("isError", False), json.loads(r["content"][0]["text"])

        V, F = dented()
        path = os.path.join(d, "dented.stl")
        W.write_stl(path, V, F)
        self.assertFalse(call("scan_open", {"path": path})[0])
        self.assertTrue(call("wear_diff")[0])
        err, o = call("wear_setup", {"tag": [{"name": "dent", "region": DENT}], "reference": {"source": "mirror", "plane": "x"}})
        self.assertFalse(err, o)
        err, o = call("wear_diff")
        self.assertFalse(err, o)
        self.assertLess(o["regions"][0]["lost"], -0.4)
        err, o = call("wear_rebuild")
        self.assertFalse(err, o)
        self.assertTrue(os.path.isfile(o["file"]["path"]))
        self.assertGreater(o["after"][0]["lost"], -0.05)


if __name__ == "__main__":
    unittest.main()
