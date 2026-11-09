# SPDX-License-Identifier: AGPL-3.0-only
# The volume error alone, numpy only. After ScanRuler's
# tests/volumeDeviation.test.ts.
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
from scanrulerfc.dev_volume import WindingTree, volume_deviation, volume_out  # noqa: E402


def part():
    V, F = box_mesh(1, 4, dims=(40, 25, 12))
    return subdivide(V, F, 1.0)


def frustum(top_x, top_y, h):
    """The volume a raised (or sunk) patch of the gridded top encloses: the
    patch's own vertices move by h, its border slopes one grid step out."""
    bx, by = top_x + 2, top_y + 2
    return h / 3 * (top_x * top_y + bx * by + math.sqrt(top_x * top_y * bx * by))


class VolumeError(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.V, cls.F = part()
        S = cls.V.copy()
        top = np.isclose(S[:, 2], 6)
        cls.bump = top & (S[:, 0] >= 4.9) & (S[:, 0] <= 15.1) & (S[:, 1] >= -0.1) & (S[:, 1] <= 8.1)
        cls.dent = top & (S[:, 0] >= -15.1) & (S[:, 0] <= -4.9) & (S[:, 1] >= -8.1) & (S[:, 1] <= 0.1)
        S[cls.bump, 2] += 1
        S[cls.dent, 2] -= 1
        cls.S = S

    def test_missing_and_excess_in_a_frame_of_its_own(self):
        pose = R.from_axis_angle([1, 2, 3], 0.3)
        pose.t = np.array([5.0, -3, 2])
        v = volume_deviation(self.V, self.F, pose.apply(self.S), self.F, R.invert(pose), 0.1)
        out = volume_out(v, 0.1)
        kinds = {r["kind"]: r for r in out["regions"]}
        self.assertEqual(set(kinds), {"missing", "excess"})
        bump = frustum(10, 8, 1)
        self.assertGreater(kinds["missing"]["volume"], 0.7 * bump)
        self.assertLess(kinds["missing"]["volume"], 1.05 * bump)
        self.assertTrue(4 < kinds["missing"]["centroid"][0] < 16)
        self.assertGreater(kinds["missing"]["centroid"][2], 6)
        self.assertLess(kinds["excess"]["centroid"][2], 6)
        self.assertAlmostEqual(kinds["missing"]["maxDepth"], 1, delta=0.1)
        self.assertEqual(out["totals"]["unsure"]["volume"], 0)
        self.assertAlmostEqual(out["modelVolume"], 12000, delta=12000 * 0.01)

    def test_inside_out_scan_reads_the_same(self):
        a = volume_deviation(self.V, self.F, self.S, self.F, R.identity(), 0.1)
        b = volume_deviation(self.V, self.F, self.S, self.F[:, ::-1], R.identity(), 0.1)
        self.assertEqual(b["scanSign"], -1)
        self.assertEqual([r["volume"] for r in a["regions"]], [r["volume"] for r in b["regions"]])

    def test_open_bottom_reads_unsure_not_an_error(self):
        # The scan never saw the underside: no triangle facing down.
        keep = ~np.all(np.isclose(self.V[self.F][:, :, 2], -6), axis=1)
        v = volume_deviation(self.V, self.F, self.V, self.F[keep], R.identity(), 0.1, cell=0.6)
        self.assertGreater(v["scanOpenColumns"], 0)
        self.assertEqual(v["totals"]["excess"]["volume"], 0)
        self.assertEqual(v["totals"]["missing"]["volume"], 0)
        self.assertGreater(v["totals"]["unsure"]["volume"], 0)

    def test_winding_number_of_a_closed_box(self):
        t = WindingTree(self.V, self.F)
        w = t.at([[0, 0, 0], [19, 12, 5], [30, 0, 0], [0, 0, 6.5], [0, 0, 5.5]])
        np.testing.assert_allclose(w, [1, 1, 0, 0, 1], atol=0.02)


if __name__ == "__main__":
    unittest.main()
