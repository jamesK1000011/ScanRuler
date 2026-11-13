# SPDX-License-Identifier: AGPL-3.0-only
# Red team: fits that report a confident answer for the wrong shape, the
# minimum zone checked against an exact optimum, the zone cache, and a
# circle through too few points. numpy (+ scipy for the LP, skipped without).
import math
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from meshkit import box_mesh, cylinder_mesh  # noqa: E402
from scanrulerfc import dimensions as D  # noqa: E402
from scanrulerfc import grow as G  # noqa: E402
from scanrulerfc import shapes  # noqa: E402
from scanrulerfc.linalg import FitError  # noqa: E402
from scanrulerfc.meshgraph import MeshGraph  # noqa: E402
from scanrulerfc.min_zone import minimum_zone  # noqa: E402

SET = {"method": "gaussian", "sigma": 3}


class MarkedFitsRefuseWrongShapes(unittest.TestCase):
    """element_fit_marked (grow.ON_SELECTION) judges as the seeded path does:
    scale, scatter against the radius, arc actually covered, and a plane."""

    def setUp(self):
        V, F = box_mesh(40, 30, 20, n=20)
        self.g = MeshGraph(V, F)
        self.top = np.nonzero(np.isclose(V[:, 2], 10))[0]
        self.edge = np.nonzero((V[:, 2] > 5) & (V[:, 0] > 15))[0]

    def test_cylinder_on_a_flat_face_is_refused(self):
        # Was: radius ~34 062 mm, sigma 0.001, coverage 0.05 deg, accepted.
        with self.assertRaises(FitError) as e:
            G.ON_SELECTION["cylinder"](self.g, self.top, dict(SET))
        self.assertIn("flat", str(e.exception))

    def test_cone_on_a_flat_face_is_refused(self):
        # Was: radius ~14.2 mm, sigma 5.4 mm, formError 23.5 mm, accepted.
        with self.assertRaises(FitError):
            G.ON_SELECTION["cone"](self.g, self.top, dict(SET))

    def test_sharp_edge_is_not_a_fillet(self):
        # Was: a 90 deg box edge came back as a 2.5 mm cylinder with 310 deg
        # coverage. Either refuse, or report the coverage the points span.
        try:
            f = G.ON_SELECTION["cylinder"](self.g, self.edge, dict(SET))
        except FitError:
            return
        self.assertLess(f["coverage"], 180, "coverage overstated for two flat faces")
        self.assertGreater(f["sigma"] / f["radius"], 0.05, "a sharp edge should not fit a round tightly")

    def test_true_partial_cylinder_still_fits(self):
        V, F = cylinder_mesh(10, 20, seg=360, rows=10, closed=False)
        g = MeshGraph(V, F)
        ang = np.degrees(np.arctan2(V[:, 1], V[:, 0]))
        sel = np.nonzero(np.abs(ang) < 45)[0]
        f = G.ON_SELECTION["cylinder"](g, sel, dict(SET))
        self.assertAlmostEqual(f["radius"], 10.0, delta=1e-3)
        self.assertIsInstance(f["radius"], float)
        self.assertAlmostEqual(f["coverage"], 90, delta=3)

    def test_too_short_an_arc_is_refused(self):
        V, F = cylinder_mesh(10, 20, seg=360, rows=10, closed=False)
        g = MeshGraph(V, F)
        ang = np.degrees(np.arctan2(V[:, 1], V[:, 0]))
        sel = np.nonzero(np.abs(ang) < 10)[0]
        with self.assertRaises(FitError) as e:
            G.ON_SELECTION["cylinder"](g, sel, dict(SET))
        self.assertIn("arc", str(e.exception))


class MinimumZoneIsMinimal(unittest.TestCase):
    def test_plane_matches_linear_programme(self):
        try:
            from scipy.optimize import linprog
        except ImportError:
            self.skipTest("scipy not installed")
        rng = np.random.default_rng(3)
        for _trial in range(10):
            n = int(rng.integers(20, 300))
            P = np.c_[rng.uniform(-20, 20, (n, 2)), rng.normal(0, 0.05, n)]
            P[int(rng.integers(n)), 2] += 0.5
            A, b = [], []
            for x, y, z in P:
                A += [[-x, -y, -1, -0.5], [x, y, 1, -0.5]]
                b += [-z, z]
            r = linprog([0, 0, 0, 1], A_ub=A, b_ub=b, bounds=[(None, None)] * 3 + [(0, None)])
            exact = r.x[3] / math.sqrt(1 + r.x[0] ** 2 + r.x[1] ** 2)
            z = minimum_zone(P, {"kind": "plane", "center": P.mean(0).tolist(), "normal": [0, 0, 1]})
            self.assertLessEqual(z["width"], exact * (1 + 1e-4))
            self.assertLessEqual(z["width"], z["start"] + 1e-12)


class ZoneCacheKeyedOnContent(unittest.TestCase):
    def test_new_fit_does_not_inherit_a_freed_fits_zone(self):
        # The cache was keyed on (id(fit), len(surface)): a fit dict freed and
        # a new one allocated at the same address got the old width.
        rng = np.random.default_rng(0)
        rough = np.c_[rng.uniform(-10, 10, (200, 2)), rng.uniform(-0.5, 0.5, 200)]
        flat = np.c_[rng.uniform(-10, 10, (200, 2)), rng.uniform(-0.01, 0.01, 200)]

        def fit():
            return {"kind": "plane", "center": [0, 0, 0], "normal": [0, 0, 1], "formError": 1.0, "usedPoints": 200}

        D._ZONES.clear()
        f1 = fit()
        D._form("Flatness", f1, rough)
        del f1
        f2 = fit()
        w = D._form("Flatness", f2, flat)["raw"]
        self.assertLess(w, 0.05, f"flatness of a 0.02 mm-flat patch read as {w:.3f} mm (stale cache)")

    def test_same_fit_and_points_hit_the_cache(self):
        rng = np.random.default_rng(1)
        pts = np.c_[rng.uniform(-10, 10, (100, 2)), rng.uniform(-0.1, 0.1, 100)]
        f = {"kind": "plane", "center": [0, 0, 0], "normal": [0, 0, 1], "formError": 1.0, "usedPoints": 100}
        D._ZONES.clear()
        a = D._form("Flatness", f, pts)["raw"]
        self.assertEqual(len(D._ZONES), 1)
        b = D._form("Flatness", dict(f), pts.copy())["raw"]
        self.assertEqual(len(D._ZONES), 1)
        self.assertEqual(a, b)


class CircleThroughFewPoints(unittest.TestCase):
    def test_three_points_have_no_form_error(self):
        f = shapes.circle_from_points([[1, 0, 0], [0, 1, 0], [-1, 0, 0]])
        self.assertIsNone(f["formError"])
        self.assertIsNone(f["sigma"])
        self.assertIn("warning", f)
        r = D._form("Circularity", f)
        self.assertIn("invalid", r)

    def test_under_six_points_warn_but_measure(self):
        t = np.radians([0, 70, 150, 220, 300])
        f = shapes.circle_from_points(np.c_[np.cos(t), np.sin(t), np.zeros(5)])
        self.assertIsNotNone(f["formError"])
        self.assertIn("warning", f)
        t = np.radians(np.arange(0, 360, 45))
        self.assertNotIn("warning", shapes.circle_from_points(np.c_[np.cos(t), np.sin(t), np.zeros(8)]))


if __name__ == "__main__":
    unittest.main()
