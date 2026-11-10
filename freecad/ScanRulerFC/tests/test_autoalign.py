# SPDX-License-Identifier: AGPL-3.0-only
# Auto-align, ported from ScanRuler (tests/autoAlign.test.ts): numpy only.
import math
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from meshkit import cylinder_mesh, weld  # noqa: E402

from scanrulerfc import autoalign as AA  # noqa: E402
from scanrulerfc.meshgraph import MeshGraph  # noqa: E402

FACES = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]]


def cuboid(sx, sy, sz, at=(0, 0, 0)):
    return [[at[0] + (sx if i & 1 else -sx) / 2, at[1] + (sy if i & 2 else -sy) / 2, at[2] + (sz if i & 4 else -sz) / 2] for i in range(8)]


def block(c, grid, noise, seed, skip=()):
    """Triangle soup of a six-sided block through eight corners, each face a
    grid with noise along its normal, the borders exact."""
    rng = np.random.default_rng(seed)
    c = np.asarray(c, dtype=float)
    tris = []
    for fi, f in enumerate(FACES):
        if fi in skip:
            continue
        a, b, d, e = c[f[0]], c[f[1]], c[f[2]], c[f[3]]
        n = np.cross(b - a, e - a)
        n /= np.linalg.norm(n)
        rows = []
        for i in range(grid + 1):
            row = []
            for j in range(grid + 1):
                q = (a + (b - a) * i / grid) * (1 - j / grid) + (e + (d - e) * i / grid) * (j / grid)
                border = i in (0, grid) or j in (0, grid)
                k = 0 if noise == 0 or border else rng.normal() * noise
                row.append(q + n * k)
            rows.append(row)
        for i in range(grid):
            for j in range(grid):
                tris += [[rows[i][j], rows[i + 1][j], rows[i + 1][j + 1]], [rows[i][j], rows[i + 1][j + 1], rows[i][j + 1]]]
    return np.array(tris)


def rot(axis, ang):
    a = np.asarray(axis, float) / np.linalg.norm(axis)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * K @ K


R0 = rot([0.3, -0.5, 0.81], 0.9)
T0 = np.array([12.0, -7, 30])


def posed(soup):
    P = soup.reshape(-1, 3) @ R0.T + T0
    F = np.arange(len(P)).reshape(-1, 3)
    V, F = weld(P, F)
    return MeshGraph(V, F)


def pdir(d):
    return R0 @ np.asarray(d, float)


def ppt(q):
    return R0 @ np.asarray(q, float) + T0


def off(a, b):
    return math.degrees(math.acos(min(1.0, abs(float(np.dot(a, b))))))


class AutoAlign(unittest.TestCase):
    def test_noisy_block(self):
        r = AA.auto_align(posed(block(cuboid(60, 40, 10), 40, 0.02, 3)))
        self.assertEqual(r["method"], "planes")
        self.assertEqual(r["base"], "face")
        for k, d in enumerate(([1, 0, 0], [0, 1, 0], [0, 0, 1])):
            self.assertLess(off(r["axes"][k], pdir(d)), 0.05)
        self.assertGreater(r["planeShare"], 0.7)
        self.assertLess(min(np.linalg.norm(r["origin"] - ppt([0, 0, -5])), np.linalg.norm(r["origin"] - ppt([0, 0, 5]))), 0.05)
        x, y, z = r["axes"]
        self.assertLess(np.linalg.norm(np.cross(x, y) - z), 1e-9)

    def test_open_side(self):
        r = AA.auto_align(posed(block(cuboid(30, 20, 50), 30, 0.02, 5, [4])))
        self.assertEqual(r["base"], "open-side")
        self.assertGreater(r["axes"][2] @ pdir([0, 0, 1]), 0.9999)
        self.assertLess(np.linalg.norm(r["origin"] - ppt([0, 0, -25])), 0.05)

    def test_rim_of_an_open_housing(self):
        c = cuboid(40, 60, 20)
        for i in (4, 5, 6, 7):
            c[i][1] += -20 if i & 2 else 20
        r = AA.auto_align(posed(block(c, 30, 0.01, 11, [4])))
        self.assertEqual(r["base"], "open-side")
        up = pdir([0, 0, 1])
        self.assertGreater(r["axes"][2] @ up, 0.99999)
        self.assertLess(off(r["axes"][0], pdir([0, 1, 0])), 0.05)
        self.assertLess(abs((r["origin"] - ppt([0, 0, -10])) @ up), 0.05)

    def test_closed_is_not_open(self):
        self.assertEqual(AA.auto_align(posed(block(cuboid(30, 20, 50), 20, 0.02, 13)))["base"], "face")

    def test_shaft(self):
        V, F = cylinder_mesh(8, 50, 96, 40)
        rng = np.random.default_rng(4)
        V = V + np.array([3, -4, 0]) + rng.normal(0, 0.02, V.shape) * np.array([1, 1, 0])
        g = MeshGraph(V @ R0.T + T0, F)
        r = AA.auto_align(g)
        self.assertEqual(r["method"], "axis")
        self.assertLess(off(r["axes"][2], pdir([0, 0, 1])), 0.05)
        self.assertTrue(r["onAxis"])
        self.assertLess(min(np.linalg.norm(r["origin"] - ppt([3, -4, -25])), np.linalg.norm(r["origin"] - ppt([3, -4, 25]))), 0.05)

    def test_lug(self):
        soup = np.concatenate([block(cuboid(80, 20, 20), 30, 0.02, 6), block(cuboid(14, 14, 14, (30, 17, 3)), 12, 0.02, 7)])
        r = AA.auto_align(posed(soup))
        self.assertLess(off(r["axes"][0], pdir([1, 0, 0])), 0.05)
        self.assertLess(min(off(r["axes"][2], pdir([0, 1, 0])), off(r["axes"][2], pdir([0, 0, 1]))), 0.05)

    def test_twelve_triangles(self):
        r = AA.auto_align(posed(block(cuboid(60, 40, 10), 1, 0, 1)))
        self.assertEqual(r["method"], "planes")
        self.assertLess(off(r["axes"][0], pdir([1, 0, 0])), 0.01)
        self.assertLess(off(r["axes"][2], pdir([0, 0, 1])), 0.01)
        r = AA.auto_align(posed(block(cuboid(100, 100, 10), 1, 0, 1)))
        self.assertLess(off(r["axes"][2], pdir([0, 0, 1])), 0.01)
        self.assertGreater(r["planeShare"], 0.99)

    def test_drafted_walls(self):
        lean = 10 * math.tan(math.radians(2))
        c = cuboid(40, 30, 10)
        for i in (4, 5, 6, 7):
            c[i][0] += -lean if i & 1 else lean
        r = AA.auto_align(posed(block(c, 30, 0.01, 8)))
        self.assertLess(off(r["axes"][0], pdir([1, 0, 0])), 0.05)
        self.assertLess(off(r["axes"][2], pdir([0, 0, 1])), 0.05)

    def test_rigid_puts_it_on_the_axes(self):
        g = posed(block(cuboid(60, 40, 10), 20, 0.02, 9))
        r = AA.auto_align(g)
        R, t = AA.rigid(r)
        Q = g.P @ R.T + t
        lo, hi = Q.min(0), Q.max(0)
        np.testing.assert_allclose(hi - lo, [60, 40, 10], atol=0.2)
        self.assertLess(abs(lo[2]), 0.1)
        np.testing.assert_allclose((lo + hi)[:2] / 2, [0, 0], atol=0.1)

    def test_tilts_and_largest(self):
        # One large face leaning 0.5° off the rest.
        c = cuboid(60, 40, 10)
        d = 60 * math.tan(math.radians(0.5))
        for i in (4, 6):
            c[i][2] -= d / 2
        for i in (5, 7):
            c[i][2] += d / 2
        g = posed(block(c, 30, 0.0, 2))
        t = AA.tilts(AA.auto_align(g))
        self.assertIsNotNone(t["largest"])
        r = AA.auto_align(g, level="largest")
        tl = AA.tilts(r)
        self.assertLess(tl["largest"]["tiltDeg"], 1e-3)
        self.assertIn("largest face", AA.note(r, tl, "largest"))


if __name__ == "__main__":
    unittest.main()
