# SPDX-License-Identifier: AGPL-3.0-only
# Red team: deviation and alignment state, units, NaN, sign conventions.
# Needs numpy and Agent Link's agentlink.protocol (pure Python) importable;
# no FreeCAD: the reference is set the way read_reference leaves it.
import importlib
import os
import sys
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

from meshkit import box_mesh  # noqa: E402

try:
    from agentlink.protocol import ToolError

    HAVE = True
except ImportError:
    HAVE = False


class Sess:
    def __init__(self):
        self.family_state = {}
        self.doc = None


def _tools(sess):
    out = {}
    for f in ("fam_deviation", "fam_align", "fam_scan", "fam_elements"):
        for t in importlib.import_module("scanrulerfc." + f).tools(sess):
            out[t.name] = t.fn
    return out


def _setup(scan_V, scan_F, ref_V, ref_F):
    from scanrulerfc import fam_deviation as FD
    from scanrulerfc import scanstate as S
    from scanrulerfc.dev_surface import NominalSurface, signed_volume, weld

    s = Sess()
    T = _tools(s)
    st = S.state(s)
    st["scan"] = S.Scan("scan", scan_V, scan_F)
    V, F = weld(np.asarray(ref_V, float), np.asarray(ref_F), 1e-6)
    if signed_volume(V, F) < 0:
        F = F[:, ::-1].copy()
    FD.dstate(s).update(reference={"name": "ref", "kind": "mesh", "V": V, "F": F, "surface": NominalSurface(V, F), "volume": abs(signed_volume(V, F)), "openEdges": 0, "note": None})
    return s, T


def _turned(V):
    th = np.radians(3)
    Rz = np.array([[np.cos(th), -np.sin(th), 0], [np.sin(th), np.cos(th), 0], [0, 0, 1]])
    return V @ Rz.T + [1, 0.5, 0.2]


@unittest.skipUnless(HAVE, "Agent Link is not importable here")
class DeviationState(unittest.TestCase):
    def setUp(self):
        self.V, self.F = box_mesh(40, 30, 20, n=12)

    def test_map_is_invalidated_when_the_part_moves_after_the_best_fit(self):
        s, T = _setup(_turned(self.V), self.F, self.V, self.F)
        a = T["deviation_align"]({"mode": "auto"})
        self.assertLess(a["deviation"]["stats"]["rms"], 1e-3)
        T["align_clear"]({})  # puts the scan back where the scanner left it
        try:
            m = T["deviation_measure"]({})
        except ToolError as e:
            self.assertEqual(e.code, "invalid_state")
            return
        self.assertLess(m["deviation"]["stats"]["rms"], 1e-3, "deviation_measure reported an unaligned map under a stale alignment")

    def test_scaling_the_scan_drops_the_alignment(self):
        s, T = _setup(_turned(self.V), self.F, self.V, self.F)
        T["deviation_align"]({"mode": "auto"})
        from scanrulerfc import fam_deviation as FD
        from scanrulerfc import model as M
        from scanrulerfc import scanstate as S

        M.scale_all(S.state(s), 1.01)
        d = FD.dstate(s)
        self.assertIsNone(d["align"])
        self.assertIsNone(d["values"])
        with self.assertRaises(ToolError) as e:
            T["deviation_volume"]({})
        self.assertEqual(e.exception.code, "invalid_state")

    def test_scan_in_metres_against_mm_reference_is_not_a_perfect_match(self):
        s, T = _setup(self.V / 1000.0, self.F, self.V, self.F)
        try:
            r = T["deviation_align"]({"mode": "auto"})
        except ToolError as e:
            self.assertEqual(e.code, "invalid_input")
            self.assertIn("1000", str(e))  # names the likely factor
            return
        d = r["deviation"]
        self.assertTrue(r.get("warnings") or d.get("warnings"), "a 1000x size mismatch passed as an excellent fit: %r" % d["stats"])

    def test_scan_in_inches_names_the_factor(self):
        s, T = _setup(self.V / 25.4, self.F, self.V, self.F)
        with self.assertRaises(ToolError) as e:
            T["deviation_align"]({"mode": "auto"})
        self.assertIn("25.4", str(e.exception))

    def test_within_tolerance_share_is_not_over_measured_points_only(self):
        # The red team ran a scan in inches through deviation_align: that is
        # now refused as a unit mix-up (above), so the share is checked on
        # the figures directly — 10 % of the points read, all in tolerance.
        from scanrulerfc import fam_deviation as FD

        s, T = _setup(self.V, self.F, self.V, self.F)
        d = FD.dstate(s)
        v = np.full(1000, np.nan)
        v[:100] = 0.01
        d.update(values=v, maxDistance=1.0, tolerance=0.1, source="reference")
        st = FD.figures(d)
        self.assertEqual(st["measured"], 100)
        self.assertLess(st["withinTolerancePct"], 50, "share within tolerance counts only the measured minority")
        self.assertEqual(st["withinTolerancePct"], 10.0)
        self.assertEqual(st["withinToleranceOfMeasuredPct"], 100.0)
        self.assertEqual(st["measuredPct"], 10.0)
        self.assertTrue(FD.map_warnings(d), "under 80 % measured and no warning")

    def test_auto_search_distance_follows_the_reference(self):
        s, T = _setup(_turned(self.V), self.F, self.V, self.F)
        r = T["deviation_align"]({"mode": "auto"})
        from scanrulerfc.dev_map import default_max_distance

        self.assertEqual(r["deviation"]["settings"]["maxDistance"], default_max_distance(float(np.linalg.norm([40, 30, 20]))))
        st = r["deviation"]["stats"]
        self.assertEqual(st["measuredPct"], 100.0)
        self.assertIn("withinToleranceOfMeasuredPct", st)

    def test_nan_vertex_is_dropped_on_opening(self):
        # The red team asked for invalid_input from deviation_align on a scan
        # built with a NaN vertex. Scan.__init__ now drops non-finite
        # vertices and their faces (finding 7 allows drop or refuse), so the
        # scan that reaches the best fit is clean and it succeeds; the
        # guard in deviation_align is tested on its own below.
        from scanrulerfc import scanstate as S

        V = self.V.copy()
        V[5] = np.nan
        s, T = _setup(V, self.F, self.V, self.F)
        sc = S.state(s)["scan"]
        self.assertTrue(np.isfinite(sc.V).all())
        self.assertEqual(len(sc.V), len(self.V) - 1)
        self.assertTrue(any("NaN" in w for w in sc.warnings()))
        r = T["deviation_align"]({"mode": "auto"})
        self.assertTrue(np.isfinite(r["deviation"]["stats"]["rms"]))

    def test_nan_reaching_the_best_fit_is_an_input_error(self):
        from scanrulerfc import scanstate as S

        s, T = _setup(self.V, self.F, self.V, self.F)
        S.state(s)["scan"].V[5] = np.nan  # past Scan.__init__'s check
        with self.assertRaises(ToolError) as e:  # was: numpy LinAlgError escaped
            T["deviation_align"]({"mode": "auto"})
        self.assertEqual(e.exception.code, "invalid_input")

    def test_sign_excess_material_reads_positive_on_the_scan(self):
        Vb, Fb = box_mesh(41, 31, 21, n=12)  # 0.5 mm proud on every face
        s, T = _setup(Vb, Fb, self.V, self.F)
        pairs = [{"scan": [20.5 * sx, 15.5 * sy, 10.5 * sz], "reference": [20 * sx, 15 * sy, 10 * sz]} for sx, sy, sz in ((1, 1, 1), (-1, 1, 1), (1, -1, 1), (1, 1, -1))]
        r = T["deviation_align"]({"mode": "points", "pairs": pairs})
        st = r["deviation"]["stats"]
        self.assertGreater(st["mean"], 0.45)
        self.assertGreaterEqual(st["min"], 0.45)
        self.assertIn("excess", r["deviation"]["sign"])

    def test_sign_excess_material_reads_positive_on_the_reference(self):
        from scanrulerfc import on_reference as R

        Vb, Fb = box_mesh(41, 31, 21, n=12)
        c, n, _, _ = R.cut(self.V, self.F, 2.0)
        v = R.read(c, n, Vb, Fb, reach=2.0)
        self.assertGreater(float(np.nanmedian(v)), 0.45)

    def test_map_against_a_removed_element_is_dropped(self):
        s, T = _setup(self.V, self.F, self.V, self.F)
        T["element_fit_marked"]({"kind": "plane", "name": "Top", "box": {"min": [-19, -14, 9.5], "max": [19, 14, 10.5]}})
        T["deviation_set_target"]({"element": "Top"})
        gone = T["element_remove"]({"element": "Top"})
        self.assertEqual(gone.get("deviationTargetCleared"), "Top")
        try:
            h = T["deviation_hotspots"]({})
        except ToolError:
            return
        self.assertNotEqual(h.get("source"), "element", "hotspots still read a map against a deleted element")

    def test_alignment_reports_convergence(self):
        s, T = _setup(self.V + [0.3, 0, 0], self.F, self.V, self.F)
        r = T["deviation_align"]({"mode": "auto"})
        a = r["deviation"]["align"]
        self.assertIn("converged", a, "icp's converged flag was dropped by dev_align._fine")
        self.assertIsInstance(a["converged"], bool)
        self.assertGreater(a["matchedShare"], 0.5)


@unittest.skipUnless(HAVE, "Agent Link is not importable here")
class AlignQuality(unittest.TestCase):
    def test_low_share_and_no_convergence_warn(self):
        from scanrulerfc.dev_align import quality_warnings

        w = quality_warnings({"matchedShare": 0.3, "converged": False, "iterations": 70})
        self.assertEqual(len(w), 2)
        self.assertEqual(quality_warnings({"matchedShare": 0.9, "converged": True}), [])


class ScanOpening(unittest.TestCase):
    def test_implausible_sizes_warn(self):
        from scanrulerfc import scanstate as S

        V, F = box_mesh(40, 30, 20, n=4)
        self.assertEqual(S.Scan("ok", V, F).warnings(), [])
        self.assertTrue(any("units" in w for w in S.Scan("m", V / 1000, F).warnings()))
        self.assertTrue(any("units" in w for w in S.Scan("big", V * 1000, F).warnings()))

    def test_all_nan_is_refused(self):
        from scanrulerfc import scanstate as S

        V, F = box_mesh(10, 10, 10, n=2)
        with self.assertRaises(ValueError):
            S.Scan("bad", np.full_like(V, np.nan), F)

    def test_points_array_reads_sequences(self):
        from scanrulerfc import scanstate as S

        class Vec:
            def __init__(self, x, y, z):
                self.x, self.y, self.z = x, y, z

        np.testing.assert_allclose(S.points_array([(1, 2, 3), (4, 5, 6)]), [[1, 2, 3], [4, 5, 6]])
        np.testing.assert_allclose(S.points_array([Vec(1, 2, 3)]), [[1, 2, 3]])
        self.assertEqual(S.points_array([]).shape, (0, 3))


if __name__ == "__main__":
    unittest.main()
