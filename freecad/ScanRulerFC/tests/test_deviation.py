# SPDX-License-Identifier: AGPL-3.0-only
# The deviation tools through Agent Link: a reference made in FreeCAD and
# written to STEP, a "scan" tessellated from it, moved by a known small
# transform, with noise and a known bump; the alignment must recover the
# transform, the map and the patches the bump's height, the volume its
# volume.
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
try:
    import FreeCAD  # noqa: F401
    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False

from meshes import subdivide, weld_soup  # noqa: E402

BUMP = 0.5


def write_obj(path, V, F):
    with open(path, "w") as f:
        f.write("".join(f"v {x:.6f} {y:.6f} {z:.6f}\n" for x, y, z in V))
        f.write("".join(f"f {a + 1} {b + 1} {c + 1}\n" for a, b, c in F))


def reference_shape():
    import FreeCAD
    import Part

    box = Part.makeBox(40, 25, 12)
    boss = Part.makeCylinder(4, 6, FreeCAD.Vector(30, 8, 12))
    return box.fuse(boss).removeSplitter()


def mesh_of(shape, edge):
    """An even tessellation, triangles about `edge` across, as a scanner
    gives: Mefisto with a longest edge, else the standard mesher refined."""
    import MeshPart

    try:
        m = MeshPart.meshFromShape(Shape=shape, MaxLength=edge)
        refine = False
    except Exception:
        m = MeshPart.meshFromShape(Shape=shape, LinearDeflection=0.02, AngularDeflection=0.2, Relative=False)
        refine = True
    pts, tris = m.Topology
    V = np.array([[p.x, p.y, p.z] for p in pts], dtype=float)
    F = np.array(tris, dtype=np.int64)
    V, F = weld_soup(V[F].reshape(-1, 3), 1e-5)
    if volume_of(V, F) < 0:
        F = F[:, ::-1].copy()
    return subdivide(V, F, edge * 1.5) if refine else (V, F)


def volume_of(V, F):
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6)


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Deviation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from agentlink.tools import Session, build_server

        from scanrulerfc import dev_rigid as R

        cls.dir = tempfile.mkdtemp()
        cls.session = Session(out_dir=cls.dir)
        cls.server = build_server(cls.session, lean=False)
        shape = reference_shape()
        cls.shape = shape
        cls.step = os.path.join(cls.dir, "bracket.step")
        shape.exportStep(cls.step)
        V, F = mesh_of(shape, 1.5)
        before = volume_of(V, F)
        top = np.isclose(V[:, 2], 12) & (V[:, 0] > 6) & (V[:, 0] < 16) & (V[:, 1] > 6) & (V[:, 1] < 16)
        V = V.copy()
        V[top, 2] += BUMP
        cls.bump_volume = volume_of(V, F) - before
        cls.nominal = V.copy()
        pose = R.from_axis_angle([0.3, 1, 0.2], 0.04)
        pose.t = np.array([0.8, -0.5, 0.3])
        cls.pose = pose
        rng = np.random.default_rng(7)
        scan = pose.apply(V) + rng.normal(0, 0.004, V.shape)
        cls.scan_V, cls.F = scan, F
        cls.obj = os.path.join(cls.dir, "scan.obj")
        write_obj(cls.obj, scan, F)

    def call(self, name, args=None):
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        return r.get("isError", False), json.loads(r["content"][0]["text"])

    def test_0_refusals(self):
        err, o = self.call("scan_open", {"path": self.obj, "discard": True})
        self.assertFalse(err, o)
        err, o = self.call("deviation_measure")
        self.assertTrue(err)
        err, o = self.call("deviation_hotspots")
        self.assertTrue(err)
        err, o = self.call("deviation_open_reference", {"path": "/nope.step"})
        self.assertTrue(err)

    def test_1_pipeline(self):
        err, o = self.call("scan_open", {"path": self.obj, "discard": True})
        self.assertFalse(err, o)
        self.assertEqual(o["opened"]["triangles"], len(self.F))
        err, o = self.call("deviation_open_reference", {"path": self.step})
        self.assertFalse(err, o)
        self.assertGreater(o["deviation"]["reference"]["triangles"], 20)
        self.assertNotIn("openEdges", o["deviation"]["reference"])
        self.assertAlmostEqual(o["deviation"]["reference"]["volume"], 40 * 25 * 12 + np.pi * 16 * 6, delta=5)
        err, o = self.call("deviation_volume")
        self.assertTrue(err, "no volume before an alignment")

        # The alignment recovers the inverse of the pose the scan was moved by.
        err, o = self.call("deviation_align", {})
        self.assertFalse(err, o)
        a = o["deviation"]["align"]
        self.assertEqual(a["source"], "auto")
        self.assertLess(a["rms"], 0.05)
        from scanrulerfc import dev_rigid as R

        m = R.Rigid(a["transform"]["rotation"], a["transform"]["translation"])
        err_mm = np.linalg.norm(m.apply(self.scan_V) - R.invert(self.pose).apply(self.scan_V), axis=1).max()
        self.assertLess(err_mm, 0.02)
        # The scan's vertices moved onto the reference.
        err, i = self.call("scan_info")
        self.assertAlmostEqual(i["scan"]["box"]["min"][0], 0, delta=0.05)

        # The map finds the bump's height.
        stats = o["deviation"]["stats"]
        self.assertAlmostEqual(stats["max"], BUMP, delta=0.05)
        self.assertGreater(stats["withinTolerancePct"], 80)
        self.assertIn("p50", stats["percentiles"])
        err, o = self.call("deviation_settings", {"tolerance": 0.05, "range": 0.2})
        self.assertFalse(err, o)
        self.assertEqual(o["deviation"]["settings"]["tolerance"], 0.05)
        err, o = self.call("deviation_measure")
        self.assertFalse(err, o)

        err, h = self.call("deviation_hotspots")
        self.assertFalse(err, h)
        p = h["patches"][0]
        self.assertEqual(p["side"], "outside")
        self.assertEqual(p["kind"], "feature")
        self.assertAlmostEqual(p["extreme"], BUMP, delta=0.05)
        self.assertAlmostEqual(p["depth"], BUMP, delta=0.1)
        self.assertTrue(5 < p["centroid"][0] < 17 and 5 < p["centroid"][1] < 17, p)
        self.assertEqual(h["far"]["count"], 0)

        # The volume error finds the bump as material the reference lacks.
        err, v = self.call("deviation_volume", {"tolerance": 0.05})
        self.assertFalse(err, v)
        missing = [r for r in v["regions"] if r["kind"] == "missing"]
        self.assertTrue(missing, v)
        self.assertGreater(missing[0]["volume"], 0.6 * self.bump_volume)
        self.assertLess(missing[0]["volume"], 1.15 * self.bump_volume)
        self.assertTrue(5 < missing[0]["centroid"][0] < 17, missing[0])
        self.assertLess(v["totals"]["excess"]["volume"], 0.2 * self.bump_volume)

        # The files.
        for fmt in ("ply", "csv", "npy", "report"):
            err, e = self.call("deviation_export", {"format": fmt})
            self.assertFalse(err, e)
            self.assertTrue(os.path.isfile(e["file"]))
            self.assertEqual(e["readings"], len(self.scan_V))
        with open(os.path.join(self.dir, "scan-deviation-scan.ply"), "rb") as f:
            head = f.read(600)
        self.assertIn(b"property uchar red", head)
        self.assertIn(b"property float deviation", head)
        self.assertIn("Alignment: rigid best fit (6 DOF, no scale), automatic", e["report"])

        # Against an element instead: a plane on the top face.
        from scanrulerfc import scanstate as S

        S.state(self.session)["elements"].append(
            {"id": 901, "name": "Top plane", "kind": "plane", "fit": {"kind": "plane", "center": [20, 12.5, 12], "normal": [0, 0, 1], "basisU": [1, 0, 0], "basisV": [0, 1, 0], "extentU": 20, "extentV": 12.5}}
        )
        try:
            err, o = self.call("deviation_set_target", {"element": "Top plane"})
            self.assertFalse(err, o)
            self.assertEqual(o["deviation"]["source"], "element")
            self.assertEqual(o["deviation"]["target"]["side"], "outward")
            self.assertGreater(o["deviation"]["stats"]["measured"], 50)
            err, h = self.call("deviation_hotspots", {"tolerance": 0.1})
            self.assertFalse(err, h)
            self.assertTrue(any(abs(p["extreme"] - BUMP) < 0.06 for p in h["patches"]), h)
            err, o = self.call("deviation_set_target", {"element": None})
            self.assertEqual(o["deviation"]["source"], "reference")
        finally:
            S.state(self.session)["elements"].pop()

        # A local refinement on the top face.
        top = np.nonzero(np.isclose(self.nominal[:, 2], 12) & (self.nominal[:, 0] > 20))[0].tolist()
        err, o = self.call("deviation_align", {"mode": "local", "vertices": top, "searchDistance": 0.5})
        self.assertFalse(err, o)
        self.assertEqual(o["deviation"]["align"]["source"], "local")

    def test_2_reference_from_the_document(self):
        doc = self.session.doc
        o = doc.addObject("Part::Feature", "RefPart")
        o.Shape = self.shape
        doc.recompute()
        err, r = self.call("scan_open", {"path": self.obj, "discard": True})
        self.assertFalse(err, r)
        err, r = self.call("deviation_open_reference", {"body": "RefPart"})
        self.assertFalse(err, r)
        self.assertEqual(r["deviation"]["reference"]["fileName"], "RefPart")
        self.assertIsNone(r["deviation"]["align"])
        err, r = self.call("deviation_align", {"mode": "points", "pairs": [{"scan": self.pose.apply(p).tolist(), "reference": p} for p in ([0, 0, 0], [40, 0, 0], [40, 25, 12], [0, 25, 12])]})
        self.assertFalse(err, r)
        self.assertEqual(r["deviation"]["align"]["source"], "points")
        self.assertLess(r["deviation"]["align"]["rms"], 0.05)


if __name__ == "__main__":
    unittest.main()
