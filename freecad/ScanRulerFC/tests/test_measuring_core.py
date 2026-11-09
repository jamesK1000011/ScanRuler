# SPDX-License-Identifier: AGPL-3.0-only
# Dimensions, tolerances, constructions, alignment and the session model,
# without FreeCAD: ScanRuler's tests/dimensions, tolerances, construct,
# datumAlign and scanScale expectations where they apply.
import math
import os
import sys
import tempfile
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import synth  # noqa: E402
from scanrulerfc import alignment as A  # noqa: E402
from scanrulerfc import construct as C  # noqa: E402
from scanrulerfc import dimensions as D  # noqa: E402
from scanrulerfc import model as M  # noqa: E402
from scanrulerfc.scanstate import Scan, fresh  # noqa: E402


def plane(c, n=(0, 0, 1), ext=10, rmin=None, rmax=None):
    from scanrulerfc.linalg import ortho_basis

    u, v = ortho_basis(n)
    f = {"kind": "plane", "center": list(c), "normal": list(n), "basisU": u, "basisV": v, "extentU": ext, "extentV": ext, "sigma": 0.01, "usedPoints": 100, "regionSize": 100}
    if rmin is not None:
        f.update(residualMin=rmin, residualMax=rmax, formError=rmax - rmin)
    return f


def cylinder(c, a, r=5, length=20, coverage=360):
    return {"kind": "cylinder", "center": list(c), "axis": list(a), "radius": r, "length": length, "coverage": coverage, "sigma": 0.01, "usedPoints": 100, "regionSize": 100}


def sphere(c, r=5):
    return {"kind": "sphere", "center": list(c), "radius": r, "sigma": 0.01, "usedPoints": 100, "regionSize": 100}


class Limits(unittest.TestCase):
    def test_ceiling(self):
        w = D.judge_limit(0.031, {"kind": "max", "max": 0.05}, "mm")
        self.assertTrue(w["pass"])
        self.assertEqual(w["over"], 0)
        self.assertAlmostEqual(w["deviation"], -0.019, places=9)
        self.assertEqual(w["allowance"], "limit 0.050 mm")
        self.assertEqual(w["delta"], "Δ -0.019 mm")
        o = D.judge_limit(0.062, {"kind": "max", "max": 0.05}, "mm")
        self.assertFalse(o["pass"])
        self.assertAlmostEqual(o["over"], 0.012, places=9)
        self.assertEqual(o["alarm"], "0.012 mm over the limit")

    def test_band(self):
        band = {"kind": "band", "nominal": 12, "plus": 0.02, "minus": 0.01}
        ok = D.judge_limit(12.015, band, "mm")
        self.assertTrue(ok["pass"])
        self.assertEqual(ok["delta"], "Δ +0.015 mm")
        self.assertEqual(ok["allowance"], "nominal 12.000 mm +0.020 mm / −0.010 mm")
        self.assertEqual(D.judge_limit(12.03, band, "mm")["alarm"], "0.010 mm over the upper limit")
        low = D.judge_limit(11.985, band, "mm")
        self.assertAlmostEqual(low["over"], -0.005, places=9)
        self.assertEqual(low["alarm"], "0.005 mm under the lower limit")

    def test_degrees_and_printed_edges(self):
        v = D.judge_limit(90.3, {"kind": "band", "nominal": 90, "plus": 0.5, "minus": 0.5}, "°")
        self.assertEqual(v["delta"], "Δ +0.30°")
        self.assertEqual(v["allowance"], "nominal 90.00° +0.50° / −0.50°")
        band = {"kind": "band", "nominal": 12, "plus": 0.05, "minus": 0.05}
        self.assertTrue(D.judge_limit(12.0504, band, "mm")["pass"])
        past = D.judge_limit(12.0506, band, "mm")
        self.assertFalse(past["pass"])
        self.assertEqual(past["alarm"], "0.001 mm over the upper limit")
        self.assertTrue(D.judge_limit(0.10004, {"kind": "max", "max": 0.1}, "mm")["pass"])

    def test_verdict_lines(self):
        self.assertEqual(D.verdict_lines(D.judge_limit(0.118, {"kind": "max", "max": 0.1}, "mm")), ["limit 0.100 mm · 0.018 mm over the limit"])
        self.assertEqual(D.verdict_lines(D.judge_limit(0.05, {"kind": "max", "max": 0.1}, "mm")), ["limit 0.100 mm · Δ -0.050 mm"])
        band = {"kind": "band", "nominal": 12, "plus": 0.01, "minus": 0.01}
        self.assertEqual(D.verdict_lines(D.judge_limit(12.03, band, "mm")), ["nominal 12.000 mm +0.010 mm / −0.010 mm · Δ +0.030 mm", "0.020 mm over the upper limit"])


class Dimensions(unittest.TestCase):
    def test_point_point_and_spheres(self):
        a, b = sphere([0, 0, 0], 2), sphere([10, 0, 0], 3)
        self.assertAlmostEqual(D.evaluate("dist-point-point", [a, b])["raw"], 10)
        self.assertAlmostEqual(D.evaluate("dist-point-point", [a, b], anchor="gap")["raw"], 5)
        self.assertAlmostEqual(D.evaluate("dist-point-point", [a, b], anchor="span")["raw"], 15)
        self.assertIn("overlap", D.evaluate("dist-point-point", [a, sphere([4, 0, 0], 3)], anchor="gap")["warning"])

    def test_point_plane_signed(self):
        v = D.evaluate("dist-point-plane", [sphere([0, 0, -3]), plane([0, 0, 0])])
        self.assertAlmostEqual(v["raw"], -3)

    def test_plane_plane_opposing_and_refused(self):
        v = D.evaluate("dist-plane-plane", [plane([0, 0, 5], (0, 0, 1)), plane([0, 0, 0], (0, 0, -1))])
        self.assertAlmostEqual(v["raw"], 5)
        t = math.radians(10)
        self.assertIn("invalid", D.evaluate("dist-plane-plane", [plane([0, 0, 5]), plane([0, 0, 0], (0, math.sin(t), math.cos(t)))]))

    def test_angles_and_diameter(self):
        self.assertAlmostEqual(D.evaluate("angle-plane-plane", [plane([0, 0, 0], (0, 0, 1)), plane([0, 0, 0], (1, 0, 0))])["raw"], 90)
        self.assertAlmostEqual(D.evaluate("angle-axis-axis", [cylinder([0, 0, 0], (0, 0, 1)), cylinder([0, 0, 0], (0, 0, -1))])["raw"], 0, places=6)
        d = D.evaluate("size-diameter", [cylinder([1, 2, 3], (0, 0, 1))])
        self.assertAlmostEqual(d["raw"], 10)
        self.assertEqual(d["value"], "10.000 mm")
        self.assertIn("no diameter", D.evaluate("size-diameter", [plane([0, 0, 0])])["invalid"])

    def test_axis_distances(self):
        v = D.evaluate("dist-axis-axis", [cylinder([0, 0, 0], (0, 0, 1)), cylinder([10, 0, 0], (0, 0, 1))])
        self.assertAlmostEqual(v["raw"], 10)
        v = D.evaluate("dist-point-axis", [sphere([3, 4, 0]), cylinder([0, 0, 0], (0, 0, 1))])
        self.assertAlmostEqual(v["raw"], 5)

    def test_type_follows_the_selection(self):
        self.assertEqual(D.resolve_type("dist-point-point", ["plane"]), "dist-plane-plane")
        self.assertEqual(D.resolve_type("dist-plane-plane", ["plane", "cylinder"]), "dist-axis-plane")
        self.assertEqual(D.assign_refs("dist-point-axis", [(1, "cylinder"), (2, "sphere")]), [2, 1])
        self.assertEqual(D.assign_refs("dist-point-axis", [(1, "circle"), (2, "cylinder")]), [1, 2])


class Tolerances(unittest.TestCase):
    def test_form_reads_the_fit(self):
        p = plane([0, 0, 0], rmin=-0.02, rmax=0.03)
        self.assertAlmostEqual(D.evaluate("form-flatness", [p])["raw"], 0.05)
        self.assertIn("constructed", D.evaluate("form-flatness", [plane([0, 0, 0])])["invalid"])

    def test_parallelism_of_a_tilted_face_by_its_surface(self):
        t = math.radians(0.5)
        n = (0, math.sin(t), math.cos(t))
        pts = np.array([[x, y, y * math.tan(t)] for x in (-10, 10) for y in (-10, 10)])
        v = D.evaluate("orient-parallelism", [plane([0, 0, 0], n), plane([0, 0, -5])], surfaces=[pts, None])
        self.assertAlmostEqual(v["raw"], 20 * math.tan(t), places=6)

    def test_perpendicularity_of_an_axis(self):
        a = cylinder([0, 0, 0], (0, math.sin(math.radians(1)), math.cos(math.radians(1))), length=20)
        v = D.evaluate("orient-perpendicularity", [a, plane([0, 0, 0])])
        self.assertAlmostEqual(v["raw"], 20 * math.sin(math.radians(1)), places=6)

    def test_coaxiality(self):
        v = D.evaluate("loc-coaxiality", [cylinder([0.05, 0, 0], (0, 0, 1)), cylinder([0, 0, 0], (0, 0, 1), length=40)])
        self.assertAlmostEqual(v["raw"], 0.1, places=9)
        self.assertEqual(D.evaluate("loc-coaxiality", [sphere([0, 0.02, 3]), cylinder([0, 0, 0], (0, 0, 1))])["label"], "Concentricity")

    def test_angularity_needs_basic(self):
        self.assertIn("basic", D.evaluate("orient-angularity", [plane([0, 0, 0]), plane([0, 0, 0])])["invalid"])


class Constructions(unittest.TestCase):
    def test_midplane_three_planes_and_axes(self):
        m = C.evaluate_construction("plane-midplane", [plane([0, 0, 10]), plane([0, 0, 0], (0, 0, -1))], [], 50)
        self.assertAlmostEqual(m["center"][2], 5)
        p = C.evaluate_construction("point-three-planes", [plane([1, 0, 0], (1, 0, 0)), plane([0, 2, 0], (0, 1, 0)), plane([0, 0, 3])], [], 50)
        np.testing.assert_allclose(p["center"], [1, 2, 3], atol=1e-12)
        ln = C.evaluate_construction("line-plane-plane", [plane([0, 0, 0], (1, 0, 0)), plane([0, 0, 0], (0, 1, 0))], [], 50)
        self.assertAlmostEqual(abs(ln["dir"][2]), 1)
        pt = C.evaluate_construction("point-line-plane", [cylinder([0, 0, 0], (0, 0, 1)), plane([0, 0, 7])], [], 50)
        np.testing.assert_allclose(pt["center"], [0, 0, 7], atol=1e-12)

    def test_refusals(self):
        with self.assertRaises(C.ConstructionError):
            C.evaluate_construction("line-plane-plane", [plane([0, 0, 0]), plane([0, 0, 1])], [], 50)
        with self.assertRaises(C.ConstructionError):
            C.evaluate_construction("point-line-line", [cylinder([0, 0, 0], (0, 0, 1)), cylinder([5, 0, 0], (0, 1, 0))], [0.1], 50)

    def test_circles(self):
        c = C.evaluate_construction("circle-plane-sphere", [plane([0, 0, 3]), sphere([0, 0, 0], 5)], [], 50)
        self.assertAlmostEqual(c["radius"], 4)
        c = C.evaluate_construction("circle-plane-cylinder", [plane([0, 0, 3]), cylinder([0, 0, 0], (0, 0, 1))], [], 50)
        self.assertAlmostEqual(c["center"][2], 3)


class Alignment(unittest.TestCase):
    def test_plane_axis_point(self):
        t = math.radians(10)
        prim = plane([5, 5, 5], (0, math.sin(t), math.cos(t)))
        rig = A.datum_alignment({"fit": prim, "axis": "z+"}, {"fit": {"kind": "line", "center": [5, 5, 5], "dir": [1, 0, 0], "length": 10}, "axis": "x+"}, sphere([5, 5, 5]))
        np.testing.assert_allclose(rig[0] @ np.array([0, math.sin(t), math.cos(t)]), [0, 0, 1], atol=1e-12)
        np.testing.assert_allclose(A.apply(rig, [[5, 5, 5]])[0], [0, 0, 0], atol=1e-12)

    def test_refusals(self):
        with self.assertRaises(A.AlignmentError):
            A.datum_alignment({"fit": sphere([0, 0, 0]), "axis": "z+"})
        with self.assertRaises(A.AlignmentError):
            A.datum_alignment({"fit": plane([0, 0, 0]), "axis": "z+"}, {"fit": plane([0, 0, 1]), "axis": "x+"})

    def test_scale_references(self):
        c = A.combine_references([{"label": "a", "measured": 10, "true": 20}, {"label": "b", "measured": 20, "true": 40}])
        self.assertAlmostEqual(c["factor"], 2)
        self.assertAlmostEqual(c["spread"], 0)
        c = A.combine_references([{"label": "a", "measured": 1, "true": 2}, {"label": "b", "measured": 1, "true": 0.5}])
        # Weighted by length on the log scale: ×2 and ×½ do not average to ×1.25.
        self.assertAlmostEqual(c["factor"], math.exp((2 * math.log(2) + 0.5 * math.log(0.5)) / 2.5))


class Session(unittest.TestCase):
    """The model the tools drive, on a numpy scan."""

    def setUp(self):
        P, F = synth.box(sigma=0.005)
        self.st = fresh()
        self.st["scan"] = Scan("box", P, F)

    def test_box_flow(self):
        st = self.st
        top = M.element_fit(st, {"kind": "plane", "at": {"point": [20, 15, 20]}})["element"]
        bot = M.element_fit(st, {"kind": "plane", "at": {"point": [20, 15, 0]}})["element"]
        self.assertEqual(top["name"], "Plane 1")
        d = M.dimension_add(st, {"refs": [top["id"], bot["id"]], "limit": {"kind": "band", "nominal": 20, "plus": 0.05, "minus": 0.05}})["dimension"]
        self.assertEqual(d["type"], "dist-plane-plane")
        self.assertAlmostEqual(d["value"], 20, delta=0.01)
        self.assertTrue(d["verdict"]["pass"])
        f = M.dimension_add(st, {"refs": ["Plane 1"], "type": "form-flatness"})["dimension"]
        self.assertLess(f["value"], 0.05)
        side = M.element_fit(st, {"kind": "plane", "at": {"point": [0, 15, 10]}})["element"]
        par = M.dimension_add(st, {"refs": [side["id"], bot["id"]], "type": "orient-perpendicularity"})["dimension"]
        self.assertLess(par["value"], 0.05)
        # Align on the datums: bottom face down, side along x, corner at zero.
        corner = M.element_construct(st, {"kind": "point", "method": "point-three-planes", "refs": [bot["id"], side["id"], "XZ"]})
        self.assertEqual(corner["made"][0]["name"], "XZ plane")
        out = M.align_datum(st, {"primary": {"element": bot["id"]}, "primaryAxis": "z-", "origin": {"element": corner["element"]["id"]}})
        self.assertEqual(out["origin"]["set"], ["x", "y"])
        top_now = M.find_element(st, top["id"])["fit"]
        self.assertAlmostEqual(top_now["center"][2], 20, delta=0.01)
        self.assertAlmostEqual(M.describe_dimension(st, st["dimensions"][0])["value"], 20, delta=0.01)
        M.align_clear(st)
        self.assertAlmostEqual(M.find_element(st, top["id"])["fit"]["center"][2], 20, delta=0.01)
        txt = M.report_text(st)
        self.assertIn("Checked against limits: 1 — 1 pass, 0 fail", txt)
        rep = M.report_json(st)
        self.assertEqual(rep["checks"]["pass"], 1)
        path = os.path.join(tempfile.mkdtemp(), "m.csv")
        self.assertGreater(M.export_csv(st, path)["rows"], 3)
        gone = M.element_remove(st, bot["id"])
        self.assertTrue(any(x["id"] == corner["element"]["id"] for x in gone["removed"]))
        self.assertEqual(len(gone["dimensionsRemoved"]), 2)

    def test_scale_from_a_dimension(self):
        st = self.st
        a = M.element_fit(st, {"kind": "plane", "at": {"point": [20, 15, 20]}})["element"]
        b = M.element_fit(st, {"kind": "plane", "at": {"point": [20, 15, 0]}})["element"]
        M.dimension_add(st, {"refs": [a["id"], b["id"]]})
        dry = M.scan_scale(st, {"references": [{"dimension": 1, "true": 40}], "dryRun": True})
        self.assertAlmostEqual(dry["factor"], 2, delta=0.002)
        M.scan_scale(st, {"factor": 2})
        self.assertAlmostEqual(M.describe_dimension(st, st["dimensions"][0])["value"], 40, delta=0.02)

    def test_segment_and_marked_fit(self):
        st = self.st
        seg = M.scan_segment(st, {"maxRms": 0.05})
        self.assertEqual(seg["found"], 6)
        self.assertAlmostEqual(seg["regions"][0]["area"], 40 * 30, delta=150)
        M.scan_segment(st, {"maxRms": 0.05, "mark": 1})
        el = M.element_fit_marked(st, {"kind": "plane", "marked": True})["element"]
        self.assertAlmostEqual(abs(el["fit"]["normal"][2]), 1, delta=1e-3)

    def test_symmetry_plane_and_pose(self):
        st = self.st
        r = M.element_construct(st, {"kind": "plane", "method": "plane-symmetry", "seed": "YZ"})
        f = r["element"]["fit"]
        self.assertAlmostEqual(abs(f["normal"][0]), 1, delta=1e-4)
        self.assertAlmostEqual(f["center"][0], 20, delta=0.02)
        self.assertLess(r["symmetry"]["rms"], 0.05)
        self.assertGreater(r["symmetry"]["matched"], 0.8 * r["symmetry"]["sampled"])
        out = M.align_symmetry(st)
        self.assertIn("Settled on the symmetry plane", out["note"])
        V = st["scan"].V
        self.assertAlmostEqual(V[:, 0].min() + V[:, 0].max(), 0, delta=0.05)

    def test_query_and_refusals(self):
        st = self.st
        every, kept, step = M.query(st["scan"], box={"min": [-1, -1, 19.9], "max": [41, 31, 20.1]}, normal={"dir": [0, 0, 1]}, limit=100)
        self.assertGreater(len(every), 1000)
        self.assertLessEqual(len(kept), 100)
        with self.assertRaises(M.Refusal):
            M.element_fit(st, {"kind": "point", "at": [{"vertex": 0}, {"vertex": 1}]})
        with self.assertRaises(M.Refusal):
            M.dimension_add(st, {"refs": ["nope"]})


if __name__ == "__main__":
    unittest.main()
