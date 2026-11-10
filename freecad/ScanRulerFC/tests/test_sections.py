# SPDX-License-Identifier: AGPL-3.0-only
# Sections, their fits and the sketch they become — ported from ScanRuler's
# tests/section.test.ts and the profile road, run through Agent Link.
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

from meshkit import box_mesh, cylinder_mesh, subdivide, write_stl  # noqa: E402
from scanrulerfc import section_core as SC  # noqa: E402
from scanrulerfc.chainsegment import profile_curves, segment_chain  # noqa: E402


def path_length(c):
    return float(np.linalg.norm(np.diff(c, axis=0), axis=1).sum())


def chains(cut):
    P, off, _ = cut
    return [P[off[i]:off[i + 1]] for i in range(len(off) - 1)]


def grid_plate(keep, size=(20, 10), step=0.5):
    """A flat plate of small triangles on z 0, the cells keep(cx, cy) says."""
    xs = np.arange(0, size[0] + 1e-9, step)
    ys = np.arange(0, size[1] + 1e-9, step)
    V = np.array([(x, y, 0.0) for x in xs for y in ys])
    at = lambda i, j: i * len(ys) + j  # noqa: E731
    F = []
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            if keep(xs[i] + step / 2, ys[j] + step / 2):
                a, b, c, d = at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)
                F += [(a, b, c), (a, c, d)]
    return V, np.array(F)


class Shadow(unittest.TestCase):
    """The shadow's loops (ScanRuler's core/section/shadow.ts), numpy only."""

    FRAME = {"origin": [0, 0, 0], "normal": [0, 0, 1], "basisU": [1, 0, 0], "basisV": [0, 1, 0]}

    def test_l_plate_hole_filled(self):
        from scanrulerfc import shadow_core as SH

        # An L, 20 x 10 less its 10 x 5 corner, with a 2 x 2 hole: the
        # shadow is the L's outline alone, the hole filled.
        V, F = grid_plate(lambda x, y: not (x > 10 and y > 5) and not (2 < x < 4 and 2 < y < 4))
        loops, cell = SH.shadow_loops(V, F, self.FRAME, 0.1)
        self.assertEqual(len(loops), 1)
        self.assertAlmostEqual(SH.area(loops[0]), 150, delta=150 * 0.01)
        self.assertEqual(len(loops[0]), 6)

    def test_two_islands_and_edge_on(self):
        from scanrulerfc import shadow_core as SH

        V, F = grid_plate(lambda x, y: x < 5 or x > 15)
        loops, _ = SH.shadow_loops(V, F, self.FRAME, 0.1)
        self.assertEqual(len(loops), 2)
        # Seen edge on (along y), a flat plate casts no shadow.
        side = {"origin": [0, 0, 0], "normal": [0, 1, 0], "basisU": [1, 0, 0], "basisV": [0, 0, 1]}
        self.assertEqual(SH.shadow_loops(V, F, side, 0.1)[0], [])


class Slice(unittest.TestCase):
    """ScanRuler's tests/section.test.ts, sliceMesh."""

    def test_box_loop(self):
        V, F = box_mesh(20, 20, 20, 8)
        cs = chains(SC.slice_mesh(V, F, [0, 0, 3.3], [0, 0, 1]))
        self.assertEqual(len(cs), 1)
        self.assertTrue(np.array_equal(cs[0][0], cs[0][-1]))
        self.assertTrue(np.allclose(cs[0][:, 2], 3.3))
        self.assertAlmostEqual(path_length(cs[0]), 80, places=4)

    def test_cylinder_circle(self):
        V, F = cylinder_mesh(10, 20, 96)
        cs = chains(SC.slice_mesh(V, F, [0, 0, 4], [0, 0, 1]))
        self.assertEqual(len(cs), 1)
        r = np.hypot(cs[0][:, 0], cs[0][:, 1])
        sag = 10 * (1 - math.cos(math.pi / 96))
        self.assertTrue(np.all(r <= 10 + 1e-5) and np.all(r >= 10 - sag - 1e-5))
        self.assertAlmostEqual(path_length(cs[0]), 96 * 2 * 10 * math.sin(math.pi / 96), places=2)

    def test_cylinder_along_axis(self):
        V, F = cylinder_mesh(10, 30, 96)
        cs = chains(SC.slice_mesh(V, F, [0, 0, 0], [0, 1, 0]))
        self.assertEqual(len(cs), 1)
        self.assertAlmostEqual(path_length(cs[0]), 100, places=3)

    def test_open_surface(self):
        V = np.array([[0, 0, 0], [20, 0, 0], [20, 0, 10], [0, 0, 10]], dtype=float)
        F = np.array([[0, 1, 2], [0, 2, 3]])
        cs = chains(SC.slice_mesh(V, F, [0, 0, 2], [0, 0, 1]))
        self.assertEqual(len(cs), 1)
        self.assertFalse(np.array_equal(cs[0][0], cs[0][-1]))
        self.assertAlmostEqual(path_length(cs[0]), 20, places=5)

    def test_misses_and_specks(self):
        V, F = box_mesh(20, 20, 20, 4)
        self.assertEqual(len(SC.slice_mesh(V, F, [0, 0, 50], [0, 0, 1])[1]) - 1, 0)
        self.assertEqual(len(SC.slice_mesh(V, F, [0, 0, 1], [0, 0, 1], min_length=100)[1]) - 1, 0)

    def test_vertex_on_plane(self):
        V, F = box_mesh(20, 20, 20, 4)
        cs = chains(SC.slice_mesh(V, F, [0, 0, 0], [0, 0, 1]))
        self.assertEqual(len(cs), 1)
        self.assertAlmostEqual(path_length(cs[0]), 80, places=4)

    def test_outward_normals(self):
        V, F = cylinder_mesh(10, 20, 96)
        P, off, N = SC.slice_mesh(V, F, [0, 0, 4], [0, 0, 1])
        radial = P[:, :2] / np.linalg.norm(P[:, :2], axis=1)[:, None]
        self.assertTrue(np.all((N[:, :2] * radial).sum(axis=1) > 0.99))

    def test_frames(self):
        self.assertEqual(SC.parse_plane_name("XY"), "z")
        self.assertEqual(SC.parse_plane_name("zx plane"), "y")
        self.assertIsNone(SC.parse_plane_name("XX"))
        f = SC.section_frame_along(SC.world_cut_axis("z", [5, 6, 7]), 4)
        self.assertTrue(np.allclose(f["origin"], [5, 6, 4]) and np.allclose(f["basisU"], [1, 0, 0]) and np.allclose(f["basisV"], [0, 1, 0]))
        s = SC.sketch_frame_on([3, 4, 20], [0, 0, 1])
        self.assertTrue(np.allclose(s["origin"], [0, 0, 20]) and np.allclose(s["basisU"], [1, 0, 0]))
        r = SC.radial_frame({"origin": [0, 0, 0], "dir": [0, 0, -1]}, 90)
        self.assertTrue(np.allclose(r["basisV"], [0, 0, 1]) and np.allclose(r["basisU"], [0, 1, 0]))
        self.assertTrue(np.allclose(np.cross(r["basisU"], r["basisV"]), r["normal"]))


def rounded_rect(w, h, r, step=0.1, noise=0.0, seed=1):
    def line(a, b):
        n = max(1, int(math.dist(a, b) / step))
        return [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n)]

    def arc(c, a0):
        n = max(1, int(r * math.pi / 2 / step))
        return [(c[0] + r * math.cos(math.radians(a0 + 90 * i / n)), c[1] + r * math.sin(math.radians(a0 + 90 * i / n))) for i in range(n)]

    p = line((w / 2, -h / 2 + r), (w / 2, h / 2 - r)) + (arc((w / 2 - r, h / 2 - r), 0) if r else [])
    p += line((w / 2 - r, h / 2), (-w / 2 + r, h / 2)) + (arc((-w / 2 + r, h / 2 - r), 90) if r else [])
    p += line((-w / 2, h / 2 - r), (-w / 2, -h / 2 + r)) + (arc((-w / 2 + r, -h / 2 + r), 180) if r else [])
    p += line((-w / 2 + r, -h / 2), (w / 2 - r, -h / 2)) + (arc((w / 2 - r, -h / 2 + r), 270) if r else [])
    P = np.array(p + [p[0]])
    P[:-1] += np.random.default_rng(seed).normal(0, noise, P[:-1].shape)
    P[-1] = P[0]
    return P


class Segment(unittest.TestCase):
    """plugins/reverse/core/segment.ts on clean and noisy outlines."""

    def test_rectangle(self):
        s = segment_chain(rounded_rect(40, 20, 0, noise=0.02))
        self.assertEqual([g["kind"] for g in s["segments"]], ["line"] * 4)
        self.assertEqual(sorted(round(g["fit"]["length"]) for g in s["segments"]), [20, 20, 40, 40])

    def test_rounded_rectangle(self):
        s = segment_chain(rounded_rect(40, 20, 3, noise=0.02))
        kinds = [g["kind"] for g in s["segments"]]
        self.assertEqual(sorted(kinds), ["arc"] * 4 + ["line"] * 4)
        for g in s["segments"]:
            if g["kind"] == "arc":
                self.assertAlmostEqual(g["fit"]["radius"], 3, delta=0.1)

    def test_circle(self):
        t = np.linspace(0, 2 * math.pi, 400)
        P = np.stack([12 * np.cos(t), 12 * np.sin(t)], axis=1)
        P[-1] = P[0]
        s = segment_chain(P)
        self.assertEqual(len(s["segments"]), 1)
        self.assertAlmostEqual(s["segments"][0]["fit"]["radius"], 12, places=3)
        curves, closed = profile_curves(s)
        self.assertTrue(closed)
        self.assertEqual(curves[0]["kind"], "circle")

    def test_profile_closes(self):
        s = segment_chain(rounded_rect(40, 20, 3, noise=0.01))
        curves, closed = profile_curves(s)
        self.assertTrue(closed)
        for i, c in enumerate(curves):
            nxt = curves[(i + 1) % len(curves)]
            self.assertLess(np.linalg.norm(c["t"] - nxt["s"]), 1e-9)

    def test_noisy_box_section(self):
        V, F = box_mesh(40, 20, 10, 16)
        V = V + np.random.default_rng(0).normal(0, 0.01, V.shape)
        P, off, _ = SC.slice_mesh(V, F, [0, 0, 0.3], [0, 0, 1])
        fr = SC.section_frame_along(SC.world_cut_axis("z"), 0.3)
        s = segment_chain(SC.project_cut(P, fr))
        self.assertEqual(sorted(round(g["fit"]["length"]) for g in s["segments"]), [20, 20, 40, 40])


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Tools(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from agentlink.tools import Session, build_server

        cls.dir = tempfile.mkdtemp()
        cls.session = Session(out_dir=cls.dir)
        cls.server = build_server(cls.session, lean=False)
        import Mesh

        m = Mesh.createBox(40, 20, 10)
        pts, tris = m.Topology
        V = np.array([[p.x, p.y, p.z] for p in pts])
        V, F = subdivide(V, np.array(tris), 1.5)
        V = V + np.random.default_rng(3).normal(0, 0.01, V.shape)
        cls.box = os.path.join(cls.dir, "box.stl")
        write_stl(cls.box, V, F)
        m = Mesh.createCylinder(8.0, 30.0, True, 0.5, 72)
        cls.cyl = os.path.join(cls.dir, "cyl.stl")
        m.write(cls.cyl)

    def call(self, name, args=None):
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        return r.get("isError", False), json.loads(r["content"][0]["text"])

    def ok(self, name, args=None):
        err, o = self.call(name, args)
        self.assertFalse(err, f"{name}: {o}")
        return o

    def test_box_profile_to_pad(self):
        self.ok("scan_open", {"path": self.box, "discard": True})
        sec = self.ok("section_cut", {"across": "XY", "name": "Mid"})["section"]
        self.assertEqual(sec["chains"], 1)
        got = self.ok("section_get", {"section": "Mid"})
        b = got["chains"][0]["bounds"]
        self.assertAlmostEqual(b["max"][0] - b["min"][0], 40, delta=0.1)
        self.assertAlmostEqual(b["max"][1] - b["min"][1], 20, delta=0.1)
        self.assertTrue(got["chains"][0]["closed"])
        fit = self.ok("section_fit", {"section": sec["id"]})
        pieces = fit["chains"][0]["pieces"]
        self.assertEqual([p["kind"] for p in pieces], ["line"] * 4)
        self.assertEqual(sorted(round(p["length"]) for p in pieces), [20, 20, 40, 40])
        sk = self.ok("section_to_sketch", {"section": sec["id"], "name": "Profile"})
        self.assertEqual(sk["wires"], [{"closed": True, "edges": 4}])
        self.ok("pd_pad", {"body": sk["body"], "sketch": sk["sketch"], "length": 10})
        body = next(o for o in self.session.doc.Objects if o.Label == sk["body"])
        self.assertAlmostEqual(body.Shape.Volume, 40 * 20 * 10, delta=40 * 20 * 10 * 0.01)

    def test_cylinder_profile(self):
        self.ok("scan_open", {"path": self.cyl, "discard": True})
        info = self.ok("scan_info")["scan"]["box"]
        axis = int(np.argmax(info["size"]))
        plane = {0: "YZ", 1: "XZ", 2: "XY"}[axis]
        sec = self.ok("section_cut", {"across": plane})["section"]
        fit = self.ok("section_fit", {"section": sec["id"]})
        pieces = fit["chains"][0]["pieces"]
        self.assertEqual(len(pieces), 1)
        self.assertAlmostEqual(pieces[0]["radius"], 8, delta=0.05)
        sk = self.ok("section_to_sketch", {"section": sec["id"]})
        self.assertTrue(sk["wires"][0]["closed"])
        self.ok("pd_pad", {"body": sk["body"], "sketch": sk["sketch"], "length": 5})
        body = next(o for o in self.session.doc.Objects if o.Label == sk["body"])
        self.assertAlmostEqual(body.Shape.Volume, math.pi * 64 * 5, delta=math.pi * 64 * 5 * 0.02)

    def test_box_shadow_with_play(self):
        # The box seen from above with 1 mm of play: never inside it, between
        # the play and the play plus twice the tolerance outside; round
        # corners from the offset; a sketch that pads.
        self.ok("scan_open", {"path": self.box, "discard": True})
        r = self.ok("section_cut", {"across": "XY", "kind": "shadow", "play": 1.0, "name": "Cutout"})
        print("\nshadow:", json.dumps(r))
        self.assertEqual(r["section"]["chains"], 1)
        self.assertEqual(r["section"]["kind"], "shadow")
        b = self.ok("section_get", {"section": "Cutout"})["chains"][0]["bounds"]
        w, h = b["max"][0] - b["min"][0], b["max"][1] - b["min"][1]
        self.assertGreater(w, 42 - 0.05)
        self.assertLess(w, 42 + 0.45)
        self.assertGreater(h, 22 - 0.05)
        self.assertLess(h, 22 + 0.45)
        fit = self.ok("section_fit", {"section": "Cutout"})
        kinds = [p["kind"] for p in fit["chains"][0]["pieces"]]
        self.assertEqual(kinds.count("line"), 4, kinds)
        self.assertEqual(kinds.count("arc"), 4, kinds)
        sk = self.ok("section_to_sketch", {"section": "Cutout", "name": "CutoutSketch"})
        self.assertTrue(sk["wires"][0]["closed"])
        self.ok("pd_pad", {"body": sk["body"], "sketch": sk["sketch"], "length": 5})

    def test_refusals(self):
        self.ok("scan_open", {"path": self.box, "discard": True})
        err, o = self.call("section_cut", {"across": "XY", "offset": 500})
        self.assertTrue(err)
        err, o = self.call("section_get", {"section": 99})
        self.assertTrue(err)
        self.assertEqual(o["error"]["code"], "not_found")


if __name__ == "__main__":
    unittest.main()
