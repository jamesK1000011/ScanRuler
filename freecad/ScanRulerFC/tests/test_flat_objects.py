# SPDX-License-Identifier: AGPL-3.0-only
# Parts on a flatbed image: a 12-tooth gear with a bore and a plate are
# found in reading order (a speck dropped), the gear's bore counted as a
# hole and its teeth counted on its radial profile; a plate's caliper widths
# read true; a knurled pin on its side shows its bumps along each flank.
import math
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from scanrulerfc import flat_objects as FO  # noqa: E402

S = 0.05  # mm a pixel


def sheet():
    h, w = 900, 1400
    gray = np.full((h, w), 230, np.uint8)
    rr, cc = np.indices((h, w))
    x, y = (cc + 0.5) * S, (rr + 0.5) * S
    # The gear, top left (row 0 is the bottom: y high is the top).
    gx, gy = 15.0, 30.0
    d = np.hypot(x - gx, y - gy)
    a = np.arctan2(y - gy, x - gx)
    r_edge = 9 + 1.2 * (np.cos(12 * a) > 0)
    gray[(d <= r_edge) & (d >= 3)] = 30
    # The plate, bottom right: 30 by 12 mm.
    gray[(x >= 35) & (x <= 65) & (y >= 5) & (y <= 17)] = 40
    # A speck.
    gray[(np.hypot(x - 60, y - 38) < 0.1)] = 20
    return gray


class Objects(unittest.TestCase):
    def test_sheet(self):
        r = FO.find_objects(sheet(), S, S, min_area=1.0)
        self.assertTrue(r["dark"])
        objs = r["objects"]
        self.assertEqual(len(objs), 2)
        gear, plate = objs  # reading order: the gear is higher up
        self.assertEqual(gear["holes"], 1)
        self.assertEqual(plate["holes"], 0)
        self.assertAlmostEqual(plate["feret"]["min"], 12, delta=0.1)
        self.assertAlmostEqual(plate["feret"]["max"], math.hypot(30, 12), delta=0.15)
        self.assertAlmostEqual(plate["area"], 360, delta=4)
        p = FO.outline_profile(gear["outline"], {"kind": "radial", "center": gear["centroid"]}, 1.5 * S)
        side = p["sides"][0]
        self.assertEqual(len(side["peaks"]), 12)
        self.assertAlmostEqual(side["peakMean"] - side["valleyMean"], 1.2, delta=0.15)

    def test_knurled_pin_on_its_side(self):
        h, w = 300, 1000
        gray = np.full((h, w), 230, np.uint8)
        rr, cc = np.indices((h, w))
        x, y = (cc + 0.5) * S, (rr + 0.5) * S
        half = 3 + 0.3 * (np.sin(2 * math.pi * x / 1.5) > 0)
        gray[(x > 5) & (x < 45) & (np.abs(y - 7.5) <= half)] = 30
        o = FO.find_objects(gray, S, S, 1.0)["objects"][0]
        p = FO.outline_profile(o["outline"], {"kind": "axial", "origin": o["centroid"], "dir": [1, 0]}, 1.5 * S)
        for sd in p["sides"]:
            self.assertGreaterEqual(len(sd["peaks"]), 24)
            self.assertAlmostEqual(sd["pitch"], 1.5, delta=0.03)

    def test_run_fallback_matches(self):
        g = sheet()[::3, ::3]
        m = g < 128
        a, na = FO._label_runs(m, True)
        try:
            from scipy import ndimage
        except ImportError:
            self.skipTest("no scipy to compare with")
        b, nb = ndimage.label(m, structure=np.ones((3, 3), int))
        self.assertEqual(na, nb)
        self.assertEqual(sorted(np.bincount(a.ravel())[1:].tolist()), sorted(np.bincount(b.ravel())[1:].tolist()))


if __name__ == "__main__":
    unittest.main()
