# SPDX-License-Identifier: AGPL-3.0-only
# The deviation map read on the reference (ScanRuler's
# core/deviation/onReference.ts): numpy only.
import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from scanrulerfc import on_reference as R  # noqa: E402


def square(x0, x1, y0, y1, z, up=True):
    V = np.array([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], dtype=float)
    F = np.array([(0, 1, 2), (0, 2, 3)] if up else [(0, 2, 1), (0, 3, 2)])
    return V, F


class OnReference(unittest.TestCase):
    def test_half_scanned_face(self):
        # The reference's top, 10 x 10 at z 0; the scan covers its left half,
        # 0.2 mm low: there the reference stands 0.2 outside it, and the
        # right half is unscanned.
        RV, RF = square(0, 10, 0, 10, 0)
        SV, SF = square(-1, 5, -1, 11, -0.2)
        c, n, P, a = R.cut(RV, RF, 0.5)
        self.assertAlmostEqual(float(a.sum()), 100.0, places=6)
        self.assertTrue(np.allclose(n, [0, 0, 1]))
        v = R.read(c, n, SV, SF, reach=3.0)
        left, right = c[:, 0] < 4.9, c[:, 0] > 5.1
        self.assertTrue(np.allclose(v[left], 0.2))
        self.assertTrue(np.isnan(v[right]).all())
        s = R.summary(v, a, c, 0.1)
        self.assertAlmostEqual(s["coveredPct"], 50, delta=3)
        self.assertEqual(s["withinTolerancePct"], 0.0)
        self.assertAlmostEqual(s["mostOutside"]["mm"], 0.2, places=6)
        self.assertGreater(s["unscanned"]["near"][0], 5)

    def test_the_far_skin_is_no_evidence(self):
        # Scan surface facing away (a thin wall's other side) under the
        # point: not the reference's surface, so unscanned.
        RV, RF = square(0, 10, 0, 10, 0)
        SV, SF = square(-1, 11, -1, 11, -0.5, up=False)
        c, n, _, _ = R.cut(RV, RF, 1.0)
        self.assertTrue(np.isnan(R.read(c, n, SV, SF, reach=3.0)).all())
        # Facing taken off: the nearest, whatever it faces.
        self.assertTrue(np.allclose(R.read(c, n, SV, SF, reach=3.0, facing_deg=None), 0.5))

    def test_scan_outside_reads_negative(self):
        RV, RF = square(0, 10, 0, 10, 0)
        SV, SF = square(-1, 11, -1, 11, 0.3)
        c, n, _, _ = R.cut(RV, RF, 1.0)
        self.assertTrue(np.allclose(R.read(c, n, SV, SF, reach=3.0), -0.3))
        self.assertTrue(np.isnan(R.read(c, n, SV, SF, reach=0.2)).all())

    def test_spacing(self):
        self.assertEqual(R.wanted_spacing(0.1, 100), 0.25)
        self.assertEqual(R.wanted_spacing(5, 100), 2.0)
        self.assertGreater(R.wanted_spacing(0.1, 1e7), 0.25)


if __name__ == "__main__":
    unittest.main()
