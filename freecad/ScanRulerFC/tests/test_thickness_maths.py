# SPDX-License-Identifier: AGPL-3.0-only
# Wall thickness maths alone, numpy only. Ported from ScanRuler's
# tests/thickness.test.ts.
import math
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from meshes import box_mesh, hollow_box  # noqa: E402
from scanrulerfc.dev_map import vertex_normals  # noqa: E402
from scanrulerfc.dev_surface import NominalSurface  # noqa: E402
from scanrulerfc.wall_thickness import compute_thickness, suggest_thickness_scale, thickness_stats  # noqa: E402


def measure(V, F, **opts):
    s = NominalSurface(V, F)
    N = vertex_normals(V, F)
    diag = s.bbox_diagonal
    o = dict(method="ray", cone_rays=0, cone_angle=math.radians(30), max_normal_deviation=None, max_thickness=diag, epsilon=diag * 1e-5)
    o.update(opts)
    return compute_thickness(s, V, N, **o), N


def flat(N):
    return np.nonzero(np.abs(N).max(axis=1) > 0.999)[0]


class WallThickness(unittest.TestCase):
    def test_solid_block_full_width(self):
        V, F = box_mesh(20, 6)
        v, N = measure(V, F)
        f = flat(N)
        self.assertGreater(len(f), 100)
        np.testing.assert_allclose(v[f], 20, atol=1e-3)

    def test_hollow_box_wall_not_cavity(self):
        V, F = hollow_box(20, 4, (5, 4))
        v, N = measure(V, F)
        f = flat(N)
        self.assertGreater(len(f), 100)
        np.testing.assert_allclose(v[f], 4, atol=1e-3)

    def test_nothing_behind_is_unmeasured(self):
        V, F = box_mesh(20, 4)
        v, _ = measure(V, F[:1])
        used = np.unique(F[:1])
        self.assertTrue(np.isnan(v[used]).all())

    def test_refuses_a_wall_thicker_than_searched(self):
        V, F = box_mesh(20, 4)
        v, _ = measure(V, F, max_thickness=8)
        self.assertTrue(np.isnan(v).all())
        v, _ = measure(V, F, max_thickness=25)
        self.assertTrue((np.abs(v - 20) < 1e-3).any())

    def test_cone_never_longer(self):
        V, F = box_mesh(20, 5)
        single, _ = measure(V, F)
        cone, _ = measure(V, F, cone_rays=6)
        self.assertTrue((cone <= single + 1e-4).all())
        self.assertGreater((cone < single - 1e-4).sum(), 0)

    def test_cone_does_not_escape_with_facing(self):
        V, F = box_mesh(20, 5)
        v, N = measure(V, F, cone_rays=6, cone_angle=math.radians(22), max_normal_deviation=math.radians(60))
        f = flat(N)
        self.assertGreater(len(f), 50)
        np.testing.assert_allclose(v[f], 20, atol=1e-3)

    def test_sphere_across_the_wall_never_wider(self):
        V, F = hollow_box(20, 4, (5, 4))
        ray, _ = measure(V, F)
        sph, N = measure(V, F, method="sphere")
        f = flat(N)
        np.testing.assert_allclose(sph[f], 4, atol=1e-2)
        ok = ~np.isnan(ray)
        self.assertTrue((sph[ok] <= ray[ok] + 1e-4).all())

    def test_block_at_its_edges(self):
        V, F = box_mesh(20, 4)
        ray, N = measure(V, F)
        sph, _ = measure(V, F, method="sphere")
        edges = []
        for i, n in enumerate(N):
            zero = np.nonzero(np.abs(n) < 1e-6)[0]
            if len(zero) != 1 or (np.abs(n) > 0.6).sum() != 2:
                continue
            if abs(V[i, zero[0]]) < 1e-6:
                edges.append(i)
        self.assertEqual(len(edges), 12)
        np.testing.assert_allclose(ray[edges], 20 * math.sqrt(2), atol=1e-2)
        np.testing.assert_allclose(sph[edges], 20, atol=1e-2)

    def test_stats_and_scale(self):
        s = thickness_stats(np.array([0.8, 1.2, 2, np.nan, 0.5]), 1)
        self.assertEqual((s["measured"], s["total"], s["belowLimit"]), (4, 5, 2))
        self.assertAlmostEqual(s["min"], 0.5)
        self.assertAlmostEqual(s["mean"], (0.8 + 1.2 + 2 + 0.5) / 4)
        v = np.concatenate([np.full(1000, 3.0), [80.0] * 10])
        low, high = suggest_thickness_scale(v)
        self.assertLess(high, 10)


if __name__ == "__main__":
    unittest.main()
