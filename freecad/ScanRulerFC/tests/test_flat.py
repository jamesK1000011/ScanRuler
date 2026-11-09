# SPDX-License-Identifier: AGPL-3.0-only
# 2D measure ported: ScanRuler's tests/flatEdges.test.ts, flatImage,
# flatCalibration, flatDimensions, flatDxf and flatSvg expectations, and the
# flat tools run through Agent Link on a synthetic PNG.
import json
import math
import os
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
try:
    import FreeCAD  # noqa: F401
    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False

from meshkit import write_png  # noqa: E402
from scanrulerfc import flat_core as FC  # noqa: E402
from scanrulerfc.geom2d import FitError, fit_circle, fit_line  # noqa: E402

W, H = 300, 200


def picture():
    """Rows top first: a dark 120 x 100 px rectangle (x 40..160, y 50..150 up)
    and a dark disc of radius 40 px round (230, 100)."""
    img = np.full((H, W), 230, np.uint8)
    img[50:150, 40:160] = 30
    yy, xx = np.mgrid[0:H, 0:W]
    img[(xx + 0.5 - 230) ** 2 + (yy + 0.5 - 100) ** 2 <= 40 ** 2] = 30
    return img


class Image(unittest.TestCase):
    def test_png_round_trip_and_scale(self):
        path = os.path.join(tempfile.mkdtemp(), "a.png")
        write_png(path, picture(), ppm=23622)  # 600 dpi
        with open(path, "rb") as fh:
            data = fh.read()
        g, w, h = FC.decode_png_gray(data)
        self.assertEqual((w, h), (W, H))
        self.assertTrue(np.array_equal(g, picture()))
        p = FC.image_pixels_per_mm(data)
        self.assertAlmostEqual(p["x"] * 25.4, 600, delta=0.1)

    def test_png_filters_and_colour(self):
        import zlib
        import struct

        rgb = np.random.default_rng(0).integers(0, 255, (5, 7, 3), dtype=np.uint8)
        rows = b""
        prev = np.zeros(21, dtype=np.int64)
        for k, row in enumerate(rgb.reshape(5, 21).astype(np.int64)):
            f = k % 5
            left = np.concatenate([[0, 0, 0], row[:-3]])
            ul = np.concatenate([[0, 0, 0], prev[:-3]])
            if f == 0:
                enc = row
            elif f == 1:
                enc = row - left
            elif f == 2:
                enc = row - prev
            elif f == 3:
                enc = row - (left + prev) // 2
            else:
                pa, pb, pc = abs(prev - ul), abs(left - ul), abs(left + prev - 2 * ul)
                pred = np.where((pa <= pb) & (pa <= pc), left, np.where(pb <= pc, prev, ul))
                enc = row - pred
            rows += bytes([f]) + bytes((enc & 0xFF).astype(np.uint8))
            prev = row

        def chunk(t, d):
            return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))

        data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 7, 5, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
        g, w, h = FC.decode_png_gray(data)
        want = np.clip(np.round(rgb.astype(float) @ [0.299, 0.587, 0.114]), 0, 255).astype(np.uint8)
        self.assertTrue(np.array_equal(g, want))


class Edges(unittest.TestCase):
    """tests/flatEdges.test.ts."""

    def setUp(self):
        self.gray = picture()[::-1].copy()

    def test_rectangle_where_it_is(self):
        chains = FC.detect_edges(self.gray)
        rect = [c for c in chains if c[:, 0].max() < 170]
        self.assertEqual(len(rect), 1)
        c = rect[0]
        self.assertAlmostEqual(c[:, 0].min(), 40, delta=0.3)
        self.assertAlmostEqual(c[:, 0].max(), 160, delta=0.3)
        self.assertAlmostEqual(c[:, 1].min(), 50, delta=0.3)
        self.assertAlmostEqual(c[:, 1].max(), 150, delta=0.3)
        left = c[np.abs(c[:, 0] - 40) < 1]
        left = left[(left[:, 1] > 60) & (left[:, 1] < 140)]
        self.assertLess(np.abs(left[:, 0] - 40).max(), 0.05)

    def test_circle_at_its_radius(self):
        chains = FC.detect_edges(self.gray)
        disc = [c for c in chains if c[:, 0].min() > 170]
        self.assertEqual(len(disc), 1)
        f = fit_circle(disc[0])
        self.assertAlmostEqual(f["radius"], 40, delta=0.3)
        self.assertAlmostEqual(f["center"][0], 230, delta=0.1)
        self.assertAlmostEqual(f["center"][1], 100, delta=0.1)

    def test_blank_and_short(self):
        self.assertEqual(FC.detect_edges(np.full((H, W), 128, np.uint8)), [])
        sq = np.full((H, W), 230, np.uint8)
        sq[90:100, 90:100] = 30
        self.assertEqual(len(FC.detect_edges(sq)), 1)
        self.assertEqual(len(FC.detect_edges(sq, min_length=60)), 0)

    def test_texture_dropped(self):
        img = np.full((H, W), 230, np.uint8)
        img[:, 150:] = 30
        rng = np.random.default_rng(4)
        noise = (rng.random((H, 100)) > 0.5) * 40
        img[:, :100] = (190 + noise).astype(np.uint8)
        chains = FC.detect_edges(img)
        good = [c for c in chains if np.all(np.abs(c[:, 0] - 150) < 1)]
        self.assertEqual(len(good), 1)


class Measuring(unittest.TestCase):
    def test_calibration(self):
        self.assertEqual(FC.distance_calibration([0, 0], [300, 400], 50), {"x": 10, "y": 10})
        p = FC.distance_calibration([0, 0], [100, 1], 10, {"x": 5, "y": 7}, True)
        self.assertAlmostEqual(p["x"], math.hypot(100, 1) / 10)
        self.assertEqual(p["y"], 7)
        with self.assertRaises(FitError):
            FC.distance_calibration([0, 0], [100, 100], 10, None, True)
        t = np.linspace(0, 6, 7)
        d = FC.diameter_calibration(np.stack([5 + 40 * np.cos(t), 5 + 40 * np.sin(t)], 1), 10)
        self.assertAlmostEqual(d["x"], 8, places=6)

    def test_dimensions(self):
        a = fit_line([[0, 0], [10, 0]])
        b = fit_line([[0, 5], [10, 5.0]])
        c = fit_circle([[13, 0], [11, 2], [9, 0]])
        v = FC.evaluate_dimension("flat-dist-line-line", [a, b])
        self.assertAlmostEqual(v["raw"], 5)
        self.assertAlmostEqual(FC.evaluate_dimension("flat-dist-point-line", [c, b])["raw"], 5)
        self.assertAlmostEqual(FC.evaluate_dimension("flat-dist-point-point", [c, {"kind": "point", "at": [11, 3]}])["raw"], 3)
        tilt = fit_line([[0, 0], [10, 10]])
        self.assertIn("invalid", FC.evaluate_dimension("flat-dist-line-line", [a, tilt]))
        self.assertAlmostEqual(FC.evaluate_dimension("flat-angle-line-line", [a, tilt])["raw"], 45)

    def test_drawings(self):
        els = [{"fit": fit_line([[0, 0], [10, 0]]), "color": "#e4572e", "name": "Line 1", "value": "L 10.000 mm"},
               {"fit": fit_circle([[13, 0], [11, 2], [9, 0]]), "color": "#2e86ab", "name": "Circle 1", "value": "Ø 4.000 mm"},
               {"fit": {"kind": "arc", "center": [0, 0], "radius": 3, "start": 0, "sweep": math.pi / 2, "sigma": 0, "usedPoints": 3}, "color": "#a23b72", "name": "Arc 1", "value": "R 3"}]
        d = {"bounds": {"min": [-5, -5], "max": [20, 10]}, "chains": [np.array([[0, 0], [10, 0], [10, 5], [0, 0]], dtype=float)], "chainUnit": {"x": 1, "y": 1},
             "unit": "mm", "title": "t", "scaleNote": "s", "elements": els, "edgeTolerance": 0.01, "origin": None}
        dxf = FC.build_dxf(d)
        lines = dxf.split("\n")
        self.assertEqual(lines[-2], "EOF")
        for ent in ("LWPOLYLINE", "LINE", "CIRCLE", "ARC", "TEXT"):
            self.assertIn(ent, lines)
        self.assertIn("%%c 4.000 mm", dxf)
        i = lines.index("$INSUNITS")
        self.assertEqual(lines[i + 2].strip(), "4")
        svg = ET.fromstring(FC.build_svg(d).split("\n", 1)[1])
        ns = "{http://www.w3.org/2000/svg}"
        self.assertEqual(svg.get("width"), "25mm")
        self.assertEqual(len(svg.findall(f".//{ns}polyline")), 1)
        self.assertEqual(svg.find(f".//{ns}circle").get("r"), "2")


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Tools(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from agentlink.tools import Session, build_server

        cls.dir = tempfile.mkdtemp()
        cls.server = build_server(Session(out_dir=cls.dir), lean=False)
        cls.png = os.path.join(cls.dir, "part.png")
        write_png(cls.png, picture(), ppm=10000)  # 10 px/mm

    def call(self, name, args=None):
        r = self.server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        return r.get("isError", False), json.loads(r["content"][0]["text"])

    def ok(self, name, args=None):
        err, o = self.call(name, args)
        self.assertFalse(err, f"{name}: {o}")
        return o

    def test_measure_an_image(self):
        o = self.ok("flat_open_image", {"path": self.png})["flat"]
        self.assertEqual(o["units"], "mm")
        self.assertEqual(o["calibration"]["source"], "metadata")
        self.assertIn(o["image"]["decoder"], ("QImage", "png (zlib)"))
        self.assertEqual(o["edges"]["chains"], 2)
        edges = self.ok("flat_edges")["chains"]
        disc = next(c["chain"] for c in edges if c["bounds"]["min"][0] > 17)
        circle = self.ok("flat_fit", {"kind": "circle", "chains": [disc]})["element"]
        self.assertAlmostEqual(circle["fit"]["radius"], 4, delta=0.03)
        l1 = self.ok("flat_fit", {"kind": "line", "box": {"min": [3.5, 6], "max": [4.5, 14]}})["element"]
        l2 = self.ok("flat_fit", {"kind": "line", "points": [[15.9, 7], [16.1, 13]]})
        self.assertEqual(l2["picks"][0]["chain"], next(c["chain"] for c in edges if c["bounds"]["max"][0] < 17))
        dims = self.ok("flat_dimension_add", {"refs": [l1["id"], l2["element"]["id"]]})
        self.assertAlmostEqual(dims["flat"]["dimensions"][0]["value"], 12, delta=0.02)
        self.assertIn("Line distance: 12.0", dims["report"])
        # Calibrate against the disc as a 10 mm gauge: everything scales.
        c = self.ok("flat_calibrate", {"mode": "diameter", "points": [[27, 10], [19, 10], [23, 14], [23, 6]], "mm": 10})
        self.assertAlmostEqual(c["calibration"]["pxPerMm"]["x"], 8, delta=0.01)
        rep = self.ok("flat_report")
        self.assertIn("CALIBRATED", rep["text"])
        self.assertAlmostEqual(rep["flat"]["dimensions"][0]["value"], 15, delta=0.03)
        for fmt in ("dxf", "svg"):
            out = self.ok("flat_export", {"format": fmt})
            self.assertGreater(out["file"]["bytes"], 500)

    def test_section_on_the_sheet(self):
        from meshkit import box_mesh, write_stl

        V, F = box_mesh(40, 20, 10, 16)
        stl = os.path.join(self.dir, "b.stl")
        write_stl(stl, V, F)
        self.ok("scan_open", {"path": stl, "discard": True})
        self.ok("section_cut", {"across": "XY"})
        a = self.ok("flat_fit", {"kind": "line", "points": [[-10, 10.3], [10, 9.8]]})["element"]
        b = self.ok("flat_fit", {"kind": "line", "chains": [0], "box": {"min": [-15, -11], "max": [15, -9]}})["element"]
        d = self.ok("flat_dimension_add", {"refs": [a["name"], b["name"]]})
        self.assertAlmostEqual(d["flat"]["dimensions"][0]["value"], 20, places=4)
        self.assertIn("a section, not an image", d["report"])


if __name__ == "__main__":
    unittest.main()
