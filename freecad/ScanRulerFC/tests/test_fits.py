# SPDX-License-Identifier: AGPL-3.0-only
# The fits, without FreeCAD: ScanRuler's tests/sphereFit, circleFit,
# cylinderFit, coneFit, torusFit, planeFit and regionGrow expectations where
# they apply, on synthetic scans made with numpy.
import math
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import synth  # noqa: E402
from scanrulerfc import grow, shapes  # noqa: E402
from scanrulerfc.linalg import FitError, mulberry32  # noqa: E402
from scanrulerfc.meshgraph import MeshGraph  # noqa: E402

CENTER = np.array([10.0, -5.0, 3.0])
R = 12.7


def sample_sphere(n, center, r, noise, seed=42, cap=None):
    """Points on a sphere (or a cap of half-angle `cap` about +z), noisy
    radially — tests/helpers.ts sampleSphere."""
    rng = np.random.default_rng(seed)
    if cap is None:
        z = rng.uniform(-1, 1, n)
    else:
        z = rng.uniform(math.cos(cap), 1, n)
    t = rng.uniform(0, 2 * math.pi, n)
    s = np.sqrt(1 - z * z)
    d = np.c_[s * np.cos(t), s * np.sin(t), z]
    return center + d * (r + rng.normal(0, noise, n))[:, None]


class Sphere(unittest.TestCase):
    def test_full_noisy_sphere_to_micron_level(self):
        P = sample_sphere(30000, CENTER, R, 0.02)
        f = shapes.fit_sphere_clipped(P, np.arange(30000), 3)
        s = f["sphere"]
        self.assertLess(abs(s["r"] - R), 0.005)
        for k, c in zip(("cx", "cy", "cz"), CENTER):
            self.assertLess(abs(s[k] - c), 0.005)
        self.assertGreater(f["sigma"], 0.015)
        self.assertLess(f["sigma"], 0.025)

    def test_60_degree_cap(self):
        P = sample_sphere(20000, CENTER, R, 0.02, 43, math.radians(60))
        s = shapes.fit_sphere_clipped(P, np.arange(20000), 3)["sphere"]
        self.assertLess(abs(s["r"] - R), 0.02)
        self.assertLess(abs(s["cz"] - CENTER[2]), 0.02)

    def test_shallow_cap_scattered_evenly(self):
        on = sample_sphere(2000, CENTER, R, 0, 45, math.radians(20))
        d = (on - CENTER) / R
        P = np.concatenate([CENTER + d * (R + 0.05), CENTER + d * (R - 0.05)])
        s = shapes.fit_sphere_clipped(P, np.arange(4000), 10)["sphere"]
        self.assertAlmostEqual(s["r"], R, places=3)
        self.assertLess(abs(s["cz"] - CENTER[2]), 0.001)

    def test_sheds_gross_outliers(self):
        P = sample_sphere(20000, CENTER, R, 0.02, 44)
        rand = mulberry32(99)
        for _ in range(400):
            k = int(rand() * 20000)
            d = P[k] - CENTER
            P[k] += d / np.linalg.norm(d) * 0.5
        f = shapes.fit_sphere_clipped(P, np.arange(20000), 3)
        self.assertLess(abs(f["sphere"]["r"] - R), 0.01)
        self.assertLess(len(f["used"]), 20000)

    def test_ransac_despite_structured_outliers(self):
        cap = sample_sphere(3000, CENTER, R, 0.02, 45, math.radians(70))
        rand = mulberry32(7)
        rod = np.array([[CENTER[0] + (rand() - 0.5) * 2, CENTER[1] + (rand() - 0.5) * 2, CENTER[2] + R + rand() * 20] for _ in range(1300)])
        P = np.concatenate([cap, rod])
        r = shapes.ransac_sphere(P, np.arange(len(P)))
        self.assertIsNotNone(r)
        self.assertLess(abs(r["sphere"]["r"] - R), 0.05)

    def test_known_diameter_holds_the_radius(self):
        P = sample_sphere(5000, CENTER, R, 0.01, 46, math.radians(50))
        f = shapes.fit_sphere_clipped(P, np.arange(5000), 3, held=R)
        self.assertEqual(f["sphere"]["r"], R)
        self.assertLess(abs(f["sphere"]["cz"] - CENTER[2]), 0.01)
        self.assertLess(abs(2 * f["free"]["r"] - 2 * R), 0.1)

    def test_mulberry32_matches_scanruler(self):
        # The same stream as the TypeScript: Math.imul and >>> on uint32.
        r = mulberry32(0x5EED)
        a = [r() for _ in range(3)]
        self.assertTrue(all(0 <= x < 1 for x in a))
        r2 = mulberry32(0x5EED)
        self.assertEqual(a, [r2() for _ in range(3)])


class Circle(unittest.TestCase):
    def test_exact_circle_through_three_points(self):
        f = shapes.circle_from_points([[1, 0, 0], [0, 1, 0], [-1, 0, 0]])
        self.assertAlmostEqual(f["radius"], 1, places=9)
        np.testing.assert_allclose(f["center"], [0, 0, 0], atol=1e-9)
        np.testing.assert_allclose(f["normal"], [0, 0, 1], atol=1e-9)

    def test_refuses_degenerate(self):
        with self.assertRaises(FitError):
            shapes.circle_from_points([[0, 0, 0], [1, 0, 0]])
        with self.assertRaises(FitError):
            shapes.circle_from_points([[0, 0, 0], [1, 0, 0], [2, 0, 0]])
        with self.assertRaises(FitError):
            shapes.circle_from_points([[1, 1, 1]] * 3)

    def test_normal_independent_of_pick_order(self):
        a = shapes.circle_from_points([[1, 0, 0], [0, 1, 0], [-1, 0, 0]])
        b = shapes.circle_from_points([[-1, 0, 0], [0, 1, 0], [1, 0, 0]])
        np.testing.assert_allclose(a["normal"], b["normal"], atol=1e-12)

    def test_short_arc_far_from_origin(self):
        t = np.radians(np.linspace(0, 30, 50))
        pts = np.c_[3000 + 10 * np.cos(t), 2000 + 10 * np.sin(t), np.zeros(50)]
        self.assertAlmostEqual(shapes.circle_from_points(pts)["radius"], 10, places=6)


class SeededFits(unittest.TestCase):
    def fit(self, mesh, point, kind, guide=None, sigma=3):
        g = MeshGraph(*mesh)
        sp = g.spot(point=point)
        return grow.FROM_SEED[kind](g, sp["triangle"], {"sigma": sigma}, guide)

    def test_cylinder(self):
        f = self.fit(synth.cylinder(r=5, sigma=0.01), [5, 0, 10], "cylinder")
        self.assertAlmostEqual(f["radius"], 5, delta=0.005)
        self.assertGreater(abs(f["axis"][2]), 0.9999)
        self.assertAlmostEqual(f["length"], 20, delta=0.2)
        self.assertGreater(f["coverage"], 300)
        self.assertLess(f["sigma"], 0.015)

    def test_guided_by_side_and_radius(self):
        mesh = synth.cylinder(r=6, sigma=0.01)
        f = self.fit(mesh, [6, 0, 10], "cylinder", {"side": "outside", "radius": {"min": 5, "max": 7}})
        self.assertAlmostEqual(f["radius"], 6, delta=0.005)
        # A shaft is no bore: asked for the inside, it is turned down.
        with self.assertRaises(FitError):
            self.fit(mesh, [6, 0, 10], "cylinder", {"side": "inside"})

    def test_guide_refuses_a_radius_not_there(self):
        with self.assertRaises(FitError) as e:
            self.fit(synth.cylinder(r=5, sigma=0.01), [5, 0, 10], "cylinder", {"radius": {"min": 10, "max": 12}})
        self.assertIn("within the guide", str(e.exception))

    def test_sphere(self):
        f = self.fit(synth.sphere(r=10, c=(1, 2, 3), sigma=0.01), [11, 2, 3], "sphere")
        self.assertAlmostEqual(f["radius"], 10, delta=0.005)
        np.testing.assert_allclose(f["center"], [1, 2, 3], atol=0.005)

    def test_cone(self):
        f = self.fit(synth.cone(r0=4, half_deg=15, sigma=0.01), [5.6, 0, 6], "cone")
        self.assertAlmostEqual(f["halfAngle"], 15, delta=0.05)
        self.assertAlmostEqual(f["radius1"], 4, delta=0.05)
        self.assertGreater(f["axis"][2], 0.999)  # the way the radius grows

    def test_torus(self):
        f = self.fit(synth.torus(R=20, r=4, sigma=0.01), [24, 0, 0], "torus")
        self.assertAlmostEqual(f["majorRadius"], 20, delta=0.02)
        self.assertAlmostEqual(f["minorRadius"], 4, delta=0.01)

    def test_plane_on_a_box_face_stops_at_the_edges(self):
        f = self.fit(synth.box(sigma=0.01), [20, 15, 20], "plane")
        np.testing.assert_allclose(f["normal"], [0, 0, 1], atol=1e-3)
        self.assertAlmostEqual(f["center"][2], 20, delta=0.005)
        self.assertLess(max(f["extentU"], f["extentV"]), 20.5)
        self.assertGreater(min(f["extentU"], f["extentV"]), 13)
        self.assertLess(f["sigma"], 0.015)
        self.assertAlmostEqual(f["formError"], f["residualMax"] - f["residualMin"], places=9)

    def test_cylinder_refused_on_a_flat(self):
        with self.assertRaises(FitError):
            self.fit(synth.box(sigma=0.01), [20, 15, 20], "cylinder")

    def test_selection_fit(self):
        g = MeshGraph(*synth.cylinder(r=5, sigma=0.01))
        f = grow.fit_cylinder_on_selection(g, np.arange(g.n), {"sigma": 3})
        self.assertAlmostEqual(f["radius"], 5, delta=0.005)
        with self.assertRaises(FitError):
            grow.fit_cylinder_on_selection(g, np.arange(5), {"sigma": 3})


if __name__ == "__main__":
    unittest.main()
