# SPDX-License-Identifier: AGPL-3.0-only
# Mesh Tools (ScanRuler's plugin) ported: the numpy maths, and the tools run
# through Agent Link on an STL from FreeCAD's Mesh module.
import json
import math
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

from meshkit import box_mesh, cylinder_mesh, subdivide, volume, write_stl  # noqa: E402
from scanrulerfc import mesh_core as M  # noqa: E402


def with_hole(V, F, at, half):
    c = V[F].mean(axis=1)
    drop = np.all(np.abs(c - np.asarray(at)) < half, axis=1)
    V2, F2, _ = M.compact_edit(V, F[~drop], len(V))
    return V2, F2


class Maths(unittest.TestCase):
    def test_round125(self):
        self.assertEqual([M.round125(x) for x in (0.042, 0.13, 3.3, 7, 10)], [0.05, 0.2, 5, 10, 10])

    def test_islands(self):
        V, F = box_mesh(20, 20, 20, 4)
        V2, F2 = box_mesh(1, 1, 1, 1, center=(30, 0, 0))
        V, F = np.vstack([V, V2]), np.vstack([F, F2 + len(V)])
        s, mask, centres = M.survey_pieces(V, F, 2.0)
        self.assertEqual((s["pieces"], s["islands"], s["islandTriangles"]), (2, 1, 12))
        self.assertTrue(np.allclose(centres[0], [30, 0, 0]))
        V3, F3, _ = M.without_triangles(V, F, mask)
        self.assertAlmostEqual(M.describe(V3, F3)["volume"], 8000, places=6)

    def test_holes_filled(self):
        V, F = box_mesh(20, 20, 20, 8)
        Vh, Fh = with_hole(V, F, [0, 0, 10], [5, 5, 0.5])
        d = M.describe(Vh, Fh)
        self.assertGreater(d["open"], 0)
        self.assertIsNone(d["volume"])
        survey, centres = M.survey_holes(Vh, Fh, 30)
        self.assertEqual(survey["holes"], 1)
        self.assertTrue(np.allclose(centres[0], [0, 0, 10]))
        for mode in ("flat", "curved"):
            Vf, Ff, _, r = M.fill_holes(Vh, Fh, 30, mode)
            self.assertEqual(r["filled"], 1)
            d = M.describe(Vf, Ff)
            self.assertEqual((d["open"], d["bad"]), (0, 0))
            self.assertAlmostEqual(d["volume"], 8000, delta=1)
        with self.assertRaises(M.MeshError):
            M.fill_holes(Vh, Fh, 1)

    def test_curved_fill_on_a_cylinder(self):
        V, F = cylinder_mesh(10, 30, 64, 20)
        Vh, Fh = with_hole(V, F, [10, 0, 0], [3, 3, 3])
        Vf, Ff, _, r = M.fill_holes(Vh, Fh, 20, "curved")
        d = M.describe(Vf, Ff)
        self.assertEqual(d["open"], 0)
        # The patch carries the curve across: its new points lie near the
        # cylinder, not on the chord.
        new = Vf[len(Vh):]
        if len(new):
            self.assertLess(np.abs(np.hypot(new[:, 0], new[:, 1]) - 10).max(), 0.3)

    def test_cut_and_cap(self):
        V, F = box_mesh(20, 20, 20, 8)
        V2, F2, _, r = M.cut_mesh(V, F, [0, 0, 3.3], [0, 0, 1], True)
        self.assertEqual(r["capped"], 1)
        d = M.describe(V2, F2)
        self.assertEqual(d["open"], 0)
        self.assertAlmostEqual(d["volume"], 20 * 20 * 13.3, places=4)
        V3, F3, _, r = M.cut_mesh(V, F, [0, 0, 3.3], [0, 0, 1], False)
        self.assertGreater(M.describe(V3, F3)["open"], 0)
        with self.assertRaises(M.MeshError):
            M.cut_mesh(V, F, [0, 0, 50], [0, 0, 1], True)

    def test_cut_a_tube_leaves_a_ring(self):
        Vo, Fo = cylinder_mesh(10, 20, 64, 8, closed=False)
        Vi, Fi = cylinder_mesh(6, 20, 64, 8, closed=False)
        Fi = Fi[:, [0, 2, 1]]
        V, F = np.vstack([Vo, Vi]), np.vstack([Fo, Fi + len(Vo)])
        V2, F2, _, r = M.cut_mesh(V, F, [0, 0, 1], [0, 0, 1], True)
        self.assertEqual(r["capped"], 1)
        cap = F2[-r["capTriangles"]:]
        t = V2[cap]
        area = np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1).sum() / 2
        ring = 0.5 * 64 * math.sin(2 * math.pi / 64) * (100 - 36)
        self.assertAlmostEqual(area, ring, places=4)

    def test_mirror(self):
        V, F = box_mesh(20, 20, 20, 8, center=(5, 0, 0))
        V2, F2, _, r = M.mirror_mesh(V, F, [0, 0, 0], [1, 0, 0], "whole")
        self.assertAlmostEqual(M.describe(V2, F2)["volume"], 8000, places=6)
        self.assertAlmostEqual(V2[:, 0].min(), -15)
        V3, F3, _, r = M.mirror_mesh(V, F, [0, 0, 0], [-1, 0, 0], "symmetric")
        d = M.describe(V3, F3)
        self.assertEqual(d["open"], 0)
        self.assertAlmostEqual(d["volume"], 30 * 20 * 20, places=4)

    def test_flip(self):
        V, F = box_mesh(20, 20, 20, 2)
        V2, F2, _, n = M.flip_triangles(V, F)
        self.assertEqual(n, len(F))
        self.assertAlmostEqual(M.describe(V2, F2)["volume"], -8000)

    def test_offset_keeps_edges_sharp(self):
        V, F = box_mesh(20, 20, 20, 6)
        V2, F2, _, r = M.offset_mesh(V, F, 1.0)
        self.assertAlmostEqual(M.describe(V2, F2)["volume"], 22 ** 3, places=4)
        self.assertAlmostEqual(r["maxMove"], math.sqrt(3), places=6)
        V3, F3, _, _ = M.offset_mesh(V, F, -2.0)
        self.assertAlmostEqual(M.describe(V3, F3)["volume"], 16 ** 3, places=4)

    def test_smooth_takes_scatter_not_shape(self):
        V, F = cylinder_mesh(10, 20, 96, 20)
        Vn = V + np.random.default_rng(1).normal(0, 0.05, V.shape)
        Vs, Fs, _, r = M.smooth_mesh(Vn, F, 2.0, 0.2)
        side = np.abs(Vs[:, 2]) < 8

        def spread(W):
            return np.std(np.hypot(W[side, 0], W[side, 1]))

        self.assertLess(spread(Vs), 0.6 * spread(Vn))
        self.assertAlmostEqual(np.mean(np.hypot(Vs[side, 0], Vs[side, 1])), 10, delta=0.02)
        self.assertLessEqual(r["maxMove"], 0.2 + 1e-9)

    def test_regions(self):
        V, F = box_mesh(20, 20, 20, 4)
        top = M.select_vertices(V, F, {"box": {"min": [-11, -11, -11], "max": [11, 11, 11]}, "facing": [0, 0, 1]})
        self.assertTrue(np.allclose(V[top, 2], 10))
        with self.assertRaises(M.MeshError):
            M.select_vertices(V, F, {})


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Tools(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import Mesh
        from agentlink.tools import Session, build_server

        cls.dir = tempfile.mkdtemp()
        cls.session = Session(out_dir=cls.dir)
        cls.server = build_server(cls.session, lean=False)
        m = Mesh.createBox(30, 20, 10)
        pts, tris = m.Topology
        V, F = subdivide(np.array([[p.x, p.y, p.z] for p in pts]), np.array(tris), 2.0)
        cls.vol = abs(volume(V, F))
        lo, hi = V.min(axis=0), V.max(axis=0)
        top = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, hi[2]])
        V, F = with_hole(V, F, top, [3, 3, 0.1])
        Vi, Fi = box_mesh(0.5, 0.5, 0.5, 1, center=hi + 20)
        V, F = np.vstack([V, Vi]), np.vstack([F, Fi + len(V)])
        cls.stl = os.path.join(cls.dir, "holed.stl")
        write_stl(cls.stl, V + np.random.default_rng(2).normal(0, 0.003, V.shape), F)

    def call(self, name, args=None):
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        return r.get("isError", False), json.loads(r["content"][0]["text"])

    def ok(self, name, args=None):
        err, o = self.call(name, args)
        self.assertFalse(err, f"{name}: {o}")
        return o

    def test_clean_reduce_export(self):
        self.ok("scan_open", {"path": self.stl, "discard": True})
        i = self.ok("mesh_inspect", {"holeSize": 15})
        self.assertEqual(i["working"], "scan")
        self.assertEqual(i["islands"]["islands"], 1)
        self.assertEqual(i["holes"]["holes"], 1)
        self.assertIsNone(i["volume"])
        r = self.ok("mesh_remove_islands")
        self.assertEqual(r["mesh"]["working"], "edited copy")
        f = self.ok("mesh_fill_holes", {"size": 15})
        self.assertEqual((f["mesh"]["open"], f["mesh"]["bad"]), (0, 0))
        self.assertAlmostEqual(f["mesh"]["volume"], self.vol, delta=self.vol * 0.005)
        # The scan is measured until the copy is taken into use.
        self.assertEqual(self.ok("scan_info")["scan"]["triangles"], i["triangles"])
        self.ok("mesh_use_edited")
        self.assertEqual(self.ok("scan_info")["scan"]["triangles"], f["mesh"]["triangles"])
        red = self.ok("mesh_reduce", {"tolerance": 0.05})["reduced"]
        self.assertLess(red["triangles"], f["mesh"]["triangles"])
        self.assertLess(red["p999"], 0.1)
        out = self.ok("mesh_export", {"part": "reduced"})
        import Mesh

        self.assertEqual(Mesh.Mesh(out["file"]["path"]).CountFacets, red["triangles"])
        self.ok("mesh_undo")
        self.assertEqual(self.ok("scan_info")["scan"]["triangles"], i["triangles"])

    def test_cut_mirror_undo(self):
        self.ok("scan_open", {"path": self.stl, "discard": True})
        box = self.ok("scan_info")["scan"]["box"]
        mid = (box["min"][2] + box["max"][2]) / 2
        c = self.ok("mesh_cut", {"plane": "XY", "offset": mid, "keep": "minus"})
        self.assertLessEqual(c["mesh"]["bounds"]["max"][2], mid + 1e-6)
        self.assertEqual(c["report"]["capped"], 1)
        m = self.ok("mesh_mirror", {"plane": "XY", "offset": mid, "mode": "symmetric", "keep": "minus"})
        self.assertGreater(m["mesh"]["bounds"]["max"][2], mid + 1)
        u = self.ok("mesh_undo")
        self.assertEqual(u["mesh"]["triangles"], c["mesh"]["triangles"])
        self.ok("mesh_discard_edited")
        err, o = self.call("mesh_export", {"part": "edited"})
        self.assertTrue(err)


if __name__ == "__main__":
    unittest.main()
