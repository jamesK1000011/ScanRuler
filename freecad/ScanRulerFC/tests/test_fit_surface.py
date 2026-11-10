# SPDX-License-Identifier: AGPL-3.0-only
# A patch fitted as a surface: a tilted plane reads as a plane, a sphere's
# cap as a dome of the sphere's radius, a saddle as a saddle, a cylinder's
# strip as a cylinder along its axis.
import math
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from scanrulerfc import height_surface as HS  # noqa: E402


def grid(n=30, span=8.0):
    g = np.linspace(-span, span, n)
    U, V = np.meshgrid(g, g)
    return U.ravel(), V.ravel()


class Surface(unittest.TestCase):
    def test_plane(self):
        u, v = grid()
        P = np.column_stack([u, v, 0.3 * u - 0.2 * v + 5])
        r = HS.fit_models(P + np.random.default_rng(1).normal(0, 0.005, P.shape))
        self.assertEqual(r["best"], "plane")

    def test_dome(self):
        u, v = grid(span=6)
        R = 40.0
        P = np.column_stack([u, v, np.sqrt(R * R - u * u - v * v)])
        r = HS.fit_models(P)
        q = next(f for f in r["fits"] if f["model"] == "quadric")
        self.assertEqual(r["best"], "quadric")
        self.assertEqual(q["curvature"]["shape"], "dome")
        self.assertAlmostEqual(abs(q["curvature"]["r1"]), R, delta=1.0)
        self.assertAlmostEqual(abs(q["curvature"]["r2"]), R, delta=1.0)

    def test_saddle_and_cylinder(self):
        u, v = grid()
        r = HS.fit_models(np.column_stack([u, v, 0.01 * (u * u - v * v)]))
        self.assertEqual(next(f for f in r["fits"] if f["model"] == "quadric")["curvature"]["shape"], "saddle")
        R = 30.0
        a = np.linspace(-0.3, 0.3, 30)
        A, Y = np.meshgrid(a, np.linspace(-10, 10, 30))
        P = np.column_stack([R * np.sin(A.ravel()), Y.ravel(), R * np.cos(A.ravel())])
        q = next(f for f in HS.fit_models(P)["fits"] if f["model"] == "quadric")
        self.assertEqual(q["curvature"]["shape"], "cylinder")
        self.assertAlmostEqual(abs(q["curvature"]["r1"]), R, delta=1.0)
        self.assertAlmostEqual(abs(q["curvature"]["axis2"][1]), 1, delta=0.01)  # straight along Y

    def test_line_refused(self):
        t = np.linspace(0, 10, 20)
        self.assertIsNone(HS.fit_models(np.column_stack([t, 2 * t, 3 * t])))


if __name__ == "__main__":
    unittest.main()
