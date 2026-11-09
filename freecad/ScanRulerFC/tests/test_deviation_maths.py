# SPDX-License-Identifier: AGPL-3.0-only
# The deviation maths alone, numpy only — no FreeCAD. Ported from ScanRuler's
# tests/deviation.test.ts, tests/hotspots.test.ts and tests/align.test.ts
# where they apply.
import math
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from meshes import box_mesh, subdivide  # noqa: E402
from scanrulerfc import dev_rigid as R  # noqa: E402
from scanrulerfc.dev_align import align_from_pairs, auto_align, AlignError  # noqa: E402
from scanrulerfc.dev_field import nice_ceil, nice_floor  # noqa: E402
from scanrulerfc.dev_hotspots import hotspots, point_spacing  # noqa: E402
from scanrulerfc.dev_map import DEFAULT_MAP_FACING_DEG, MAX_AUTO_RANGE, compute_deviation, deviation_report, deviation_stats, suggest_range, vertex_normals  # noqa: E402
from scanrulerfc.dev_surface import NominalSurface  # noqa: E402


def random_rigid(rand, shift):
    axis = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1]
    m = R.from_axis_angle(axis, (rand() - 0.5) * 2 * math.pi)
    m.t = np.array([(rand() - 0.5) * 2 * shift for _ in range(3)])
    return m


def box_sdf(p, h):
    q = np.abs(p) - h
    return np.linalg.norm(np.maximum(q, 0), axis=1) + np.minimum(q.max(axis=1), 0)


class Rigid(unittest.TestCase):
    def test_inverts_and_composes_to_identity(self):
        rand = R.mulberry32(5)
        for _ in range(20):
            m = random_rigid(rand, 100)
            i = R.compose(m, R.invert(m))
            self.assertLess(np.abs(i.r - np.eye(3)).max(), 1e-12)
            self.assertLess(np.abs(i.t).max(), 1e-10)

    def test_keeps_an_accumulated_rotation_orthonormal(self):
        m = R.identity()
        step = R.from_axis_angle([0.3, 0.7, -0.2], 0.01)
        for _ in range(1000):
            m = R.compose(step, m)
            m.r = m.r * (1 + 1e-7)  # drift
            m = R.reorthonormalize(m)
        self.assertLess(np.abs(m.r @ m.r.T - np.eye(3)).max(), 1e-12)
        self.assertAlmostEqual(np.linalg.det(m.r), 1, places=12)

    def test_mulberry32_matches_scanruler(self):
        # The first draws of mulberry32(1), as JavaScript gives them.
        r = R.mulberry32(1)
        self.assertAlmostEqual(r(), 0.6270739405881613, places=15)
        self.assertAlmostEqual(r(), 0.002735721180215478, places=15)


class AbsoluteOrientation(unittest.TestCase):
    def test_recovers_a_known_transform(self):
        rand = R.mulberry32(9)
        m = random_rigid(rand, 50)
        src = np.array([[rand() * 40, rand() * 40, rand() * 40] for _ in range(6)])
        r = R.absolute_orientation(src, m.apply(src))
        self.assertLess(r["rms"], 1e-9)
        self.assertLess(np.abs(r["transform"].r - m.r).max(), 1e-9)
        self.assertLess(np.abs(r["transform"].t - m.t).max(), 1e-8)

    def test_never_a_reflection(self):
        src = np.array([[0, 0, 0], [10, 0, 0], [0, 10, 0], [0, 0, 10.0]])
        tgt = src * [1, 1, -1]
        r = R.absolute_orientation(src, tgt)
        self.assertAlmostEqual(np.linalg.det(r["transform"].r), 1, places=9)
        self.assertGreater(r["rms"], 1)

    def test_flags_a_line_and_refuses_two(self):
        line = np.array([[0, 0, 0], [10, 0, 0], [20, 0, 0.0]])
        self.assertLess(R.absolute_orientation(line, line + 1)["conditioning"], 0.02)
        self.assertIsNone(R.absolute_orientation(line[:2], line[:2]))


class SignedDistance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        V, F = box_mesh(20, 8)
        cls.surface = NominalSurface(V, F)

    def test_agrees_with_the_analytic_box(self):
        rng = np.random.default_rng(17)
        P = (rng.random((4000, 3)) - 0.5) * 32
        h = self.surface.closest(P)
        self.assertTrue(h.found.all())
        self.assertLess(np.abs(h.signed - box_sdf(P, 10)).max(), 1e-3)

    def test_sign_right_on_edges_and_corners(self):
        rng = np.random.default_rng(23)
        pts = []
        for _ in range(6000):
            pick = lambda: -10 if rng.random() < 0.5 else 10  # noqa: E731
            along = lambda: (rng.random() * 2 - 1) * 10  # noqa: E731
            base = [pick(), pick(), pick()] if rng.random() < 0.35 else [along(), pick(), pick()]
            rng.shuffle(base)
            eps = (rng.random() - 0.5) * 0.4
            pts.append(np.array(base) + eps * (rng.random(3) - 0.5))
        P = np.array(pts)
        truth = box_sdf(P, 10)
        m = np.abs(truth) > 1e-6
        self.assertGreater(m.sum(), 4000)
        h = self.surface.closest(P[m])
        self.assertTrue((np.sign(h.signed) == np.sign(truth[m])).all())
        self.assertLess(np.abs(h.signed - truth[m]).max(), 1e-3)

    def test_no_hit_past_the_cap(self):
        self.assertFalse(self.surface.closest([[1000, 0, 0]], 5).found[0])
        self.assertTrue(self.surface.closest([[1000, 0, 0]]).found[0])

    def test_facing_search_skips_what_faces_away(self):
        # Just inside the top face: the nearest surface is the top (+Z); the
        # nearest facing -Z is the bottom, 19.9 away.
        h = self.surface.closest([[0, 0, 9.9]], facing=np.array([[0, 0, -1.0]]), min_dot=0.5)
        self.assertAlmostEqual(h.distance[0], 19.9, places=9)
        self.assertAlmostEqual(h.signed[0], -19.9, places=9)


class FacingLimitAcrossAThinWall(unittest.TestCase):
    """A 20 x 20 plate 1 mm thick, top face at z = +0.5 (deviation.test.ts)."""

    @classmethod
    def setUpClass(cls):
        V, F = box_mesh(1, 8, dims=(20, 20, 1))
        cls.surface = NominalSurface(V, F)
        up = [0, 0, 1]
        pts = [
            ([1, 2, 0.6], up),
            ([-3, 1, -0.2], up),
            ([2, -4, -0.7], up),
            ([0, 0, 0.8], [1, 0, 0]),
            ([5, 5, 0.6], [math.sin(1.22), 0, math.cos(1.22)]),
        ]
        for i in range(6):
            for j in range(6):
                pts.append(([i * 3 - 7.5, j * 3 - 7.5, 0.52], up))
        fit = R.from_axis_angle([0.3, -0.5, 0.8], 0.9)
        fit.t = np.array([4, -7, 2.5])
        to_scan = R.invert(fit)
        cls.fit = fit
        cls.positions = to_scan.apply(np.array([p for p, _ in pts], dtype=float))
        cls.normals = to_scan.rotate(np.array([n for _, n in pts], dtype=float))

    def test_plain_map_off_the_nearest_surface(self):
        plain = compute_deviation(self.surface, self.positions, self.fit)
        self.assertAlmostEqual(plain[0], 0.1, places=5)
        self.assertAlmostEqual(plain[1], -0.3, places=5)
        self.assertAlmostEqual(plain[2], 0.2, places=5)
        off = compute_deviation(self.surface, self.positions, self.fit, self.normals, None)
        np.testing.assert_array_equal(off, plain)

    def test_sunk_point_off_its_own_face(self):
        v = compute_deviation(self.surface, self.positions, self.fit, self.normals, math.radians(DEFAULT_MAP_FACING_DEG))
        self.assertAlmostEqual(v[0], 0.1, places=5)
        self.assertAlmostEqual(v[1], -0.7, places=5)
        self.assertAlmostEqual(v[2], -1.2, places=5)
        self.assertAlmostEqual(v[4], 0.1, places=5)
        self.assertAlmostEqual(v[5], 0.02, places=5)

    def test_nothing_facing_is_unmeasured(self):
        v = compute_deviation(self.surface, self.positions, self.fit, self.normals, math.radians(60))
        self.assertTrue(math.isnan(v[3]))
        self.assertTrue(math.isnan(v[4]))
        self.assertAlmostEqual(v[5], 0.02, places=5)

    def test_inside_out_scan_reads_the_same(self):
        a = compute_deviation(self.surface, self.positions, self.fit, self.normals, math.radians(90))
        b = compute_deviation(self.surface, self.positions, self.fit, -self.normals, math.radians(90))
        np.testing.assert_array_equal(a, b)

    def test_report_carries_the_limit(self):
        v = compute_deviation(self.surface, self.positions, self.fit, self.normals, math.radians(90))
        stats = deviation_stats(v, 3, 0.1)
        align = {"source": "auto", "rms": 0.01, "matched": 10, "sampled": 12, "iterations": 5}
        text = deviation_report("scan.stl", "ref.step", align, stats, 0.3, 3, 90)
        self.assertIn("facing limit         90°", text)
        self.assertIn("Alignment: rigid best fit (6 DOF, no scale), automatic", text)
        off = deviation_report("scan.stl", "ref.step", align, stats, 0.3, 3, None)
        self.assertIn("off — the nearest surface counts", off)


class ScaleAndStatistics(unittest.TestCase):
    def test_nice_numbers(self):
        self.assertAlmostEqual(nice_ceil(0.61), 0.8)
        self.assertAlmostEqual(nice_ceil(0.42), 0.5)
        self.assertAlmostEqual(nice_ceil(1.05), 1.2)
        self.assertAlmostEqual(nice_ceil(0.0031), 0.004)
        self.assertAlmostEqual(nice_floor(0.61), 0.6)
        self.assertAlmostEqual(nice_floor(2.9), 2.5)
        self.assertEqual(nice_floor(0), 0)
        self.assertEqual(repr(nice_ceil(0.55)), "0.6")

    def test_range_ignores_the_tail_and_is_capped(self):
        v = np.array([0.1 if i % 2 else -0.1 for i in range(1000)] + [9.0])
        self.assertLess(suggest_range(v, 100), 1)
        v = np.array([0.03 if i % 2 else -0.03 for i in range(600)] + [6.0] * 300)
        self.assertEqual(suggest_range(v, 100), MAX_AUTO_RANGE)
        self.assertLess(suggest_range(np.full(100, 0.04), 100), 0.1)

    def test_counts_only_what_the_search_distance_matched(self):
        s = deviation_stats(np.array([0.1, -0.2, 5, -6, 0.05]), 1, 0.15)
        self.assertEqual(s["measured"], 3)
        self.assertEqual(s["total"], 5)
        self.assertAlmostEqual(s["min"], -0.2)
        self.assertAlmostEqual(s["max"], 0.1)
        self.assertEqual(s["withinTolerance"], 2)
        self.assertAlmostEqual(s["rms"], math.sqrt((0.01 + 0.04 + 0.0025) / 3), places=6)


def sheet(n, z, at):
    pts, vals = [], []
    for i in range(n):
        for j in range(n):
            pts.append((i, j, z))
            vals.append(at(i, j))
    return pts, vals


def field(*sheets):
    return np.array([p for s in sheets for p in s[0]], dtype=float), np.array([v for s in sheets for v in s[1]], dtype=float)


class Hotspots(unittest.TestCase):
    def test_two_faces_a_wall_apart(self):
        P, v = field(sheet(20, 0, lambda x, y: 1), sheet(20, 10, lambda x, y: -0.5), sheet(20, 20, lambda x, y: 0.05))
        r = hotspots(P, v, 0.1)
        self.assertEqual(r["over"], 800)
        self.assertEqual(r["found"], 2)
        self.assertAlmostEqual(r["spacing"], 1, places=6)
        self.assertAlmostEqual(r["grain"], 3, places=6)
        a, b = r["patches"]
        self.assertEqual(a["count"], 400)
        self.assertEqual(a["extreme"], 1)
        self.assertAlmostEqual(a["area"], 400)
        self.assertAlmostEqual(a["excess"], 360, places=3)
        np.testing.assert_allclose(a["centroid"], [9.5, 9.5, 0])
        np.testing.assert_array_equal(a["min"], [0, 0, 0])
        np.testing.assert_array_equal(a["max"], [19, 19, 0])
        self.assertEqual(b["extreme"], -0.5)
        self.assertEqual(v[b["index"]], -0.5)

    def test_bridges_a_gap_and_parts_the_sides(self):
        P, v = field(sheet(20, 0, lambda x, y: 0 if (x == 10 and y == 10) else 1))
        self.assertEqual(hotspots(P, v, 0.1)["found"], 1)
        P2, v2 = field(sheet(20, 0, lambda x, y: 1 if x < 10 else -1))
        r = hotspots(P2, v2, 0.1)
        self.assertEqual(r["found"], 2)
        self.assertEqual(sorted(p["extreme"] for p in r["patches"]), [-1, 1])
        self.assertEqual(hotspots(P, v, 0.1, group=(P[:, 0] < 10).astype(int))["found"], 2)

    def test_ranks_caps_and_drops_specks(self):
        P, v = field(sheet(20, 0, lambda x, y: 0.2), sheet(5, 30, lambda x, y: 3), ([(50, 50, 50), (51, 50, 50)], [5, 5]))
        r = hotspots(P, v, 0.1)
        self.assertEqual(r["found"], 2)
        self.assertEqual(r["patches"][0]["count"], 25)
        self.assertEqual(r["patches"][1]["count"], 400)
        self.assertEqual(len(hotspots(P, v, 0.1, limit=1)["patches"]), 1)
        self.assertEqual(hotspots(P, v, 0.1, min_count=1)["found"], 3)
        self.assertEqual(hotspots(P, v, 0.1, only=P[:, 2] > 20)["over"], 27)
        self.assertEqual(hotspots(P, v, 0.1, grain=0.5, min_count=1)["found"], 427)

    def test_missing_pad_among_texture(self):
        step, n = 0.25, 161
        pts, vals = [], []
        for i in range(n):
            for j in range(n):
                x, y = i * step, j * step
                pad = 17 <= x < 23 and 17 <= y < 23
                pts.append((x, y, 0))
                vals.append((1 if pad else 0) + 0.3 * math.sin(2 * math.pi * x / 4) * math.sin(2 * math.pi * y / 4))
        r = hotspots(np.array(pts), np.array(vals), 0.25, limit=50)
        self.assertAlmostEqual(r["spacing"], step, places=6)
        self.assertGreater(r["found"], 20)
        self.assertEqual(r["features"]["count"], 1)
        first, rest = r["patches"][0], r["patches"][1:]
        self.assertEqual(first["kind"], "feature")
        self.assertTrue(36 < first["area"] < 40)
        self.assertTrue(0.9 < first["depth"] < 1.1)
        self.assertTrue(25 < first["volume"] < 30)
        self.assertTrue(all(p["kind"] == "texture" and p["depth"] < 0.3 and p["area"] < 1 for p in rest))
        self.assertTrue(0.8 < r["features"]["shareOfExcess"] <= 1)

    def test_broad_and_deep(self):
        P, v = field(sheet(10, 0, lambda x, y: 0.15))
        self.assertEqual(hotspots(P, v, 0.1)["patches"][0]["kind"], "texture")
        P, v = field(sheet(4, 0, lambda x, y: 2))
        self.assertEqual(hotspots(P, v, 0.1)["patches"][0]["kind"], "texture")
        P, v = field(sheet(5, 0, lambda x, y: 0.2))
        r = hotspots(P, v, 0.1)
        self.assertEqual(r["patches"][0]["kind"], "feature")
        self.assertEqual(r["features"], {"count": 1, "shareOfExcess": 1})
        P, v = field(sheet(10, 0, lambda x, y: 1.3))
        self.assertEqual(hotspots(P, v, 1)["patches"][0]["kind"], "texture")
        self.assertEqual(hotspots(P, v, 1, feature_depth=0.2)["patches"][0]["kind"], "feature")

    def test_spacing_and_nothing_over(self):
        P, v = field(sheet(30, 0, lambda x, y: 1))
        self.assertAlmostEqual(point_spacing(P, np.arange(900)), 1, places=6)
        P, v = field(sheet(10, 0, lambda x, y: 1))
        self.assertAlmostEqual(hotspots(P * 2.5, v, 0.1)["spacing"], 2.5, places=6)
        r = hotspots(P, np.full(100, np.nan), 0.1)
        self.assertEqual((r["found"], r["over"], r["patches"]), (0, 0, []))


class BestFit(unittest.TestCase):
    """align.test.ts: a random pose of the nominal recovered against itself."""

    @classmethod
    def setUpClass(cls):
        V, F = box_mesh(1, 6, dims=(40, 25, 12))
        # A notch off one corner, so the box has one right pose, not four.
        cls.V, cls.F = subdivide(V, F, 4)
        cut = (cls.V[:, 0] > 15) & (cls.V[:, 1] > 8) & (cls.V[:, 2] > 5.9)
        cls.V = cls.V.copy()
        cls.V[cut, 2] -= 4
        cls.surface = NominalSurface(cls.V, cls.F)
        cls.N = vertex_normals(cls.V, cls.F)

    def test_recovers_a_random_pose(self):
        rand = R.mulberry32(2024)
        for _ in range(2):
            pose = random_rigid(rand, self.surface.bbox_diagonal * 0.3)
            r = auto_align(self.surface, pose.apply(self.V), pose.rotate(self.N), fine_samples=8000)
            self.assertLess(r["meanDistance"], 0.01)
            back = R.invert(pose)
            moved = pose.apply(self.V)
            err = np.linalg.norm(r["transform"].apply(moved) - back.apply(moved), axis=1).max()
            self.assertLess(err, 0.05)

    def test_from_pairs_and_refuses_a_line(self):
        rand = R.mulberry32(77)
        pose = random_rigid(rand, 20)
        scan = pose.apply(self.V)
        picks = [0, 50, 110, 170]
        jitter = lambda: (rand() - 0.5) * 1.5  # noqa: E731
        pairs = [(scan[v] + [jitter(), jitter(), jitter()], self.V[v]) for v in picks]
        r = align_from_pairs(self.surface, scan, pose.rotate(self.N), pairs, fine_samples=8000)
        self.assertEqual(r["source"], "points")
        err = np.linalg.norm(r["transform"].apply(scan) - self.V, axis=1).max()
        self.assertLess(err, 0.05)
        line = [(np.array([i, 0, 0.0]), np.array([i, 0, 0.0])) for i in (0, 5, 10)]
        with self.assertRaises(AlignError):
            align_from_pairs(self.surface, scan, None, line)


if __name__ == "__main__":
    unittest.main()
