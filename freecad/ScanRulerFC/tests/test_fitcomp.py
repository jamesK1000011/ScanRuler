# SPDX-License-Identifier: AGPL-3.0-only
# Calibrate from a scan: a reference (a block, a hole and a boss standing
# on the bed) and a "print" of it sampled from a printer with known errors
# — scale, outer walls out, holes closed, noise — and the fit reading them
# back; the slicer's new values; the compensated reference.
import json
import math
import os
import sys
import tempfile
import unittest

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])

from meshkit import box_mesh, cylinder_mesh  # noqa: E402
from scanrulerfc import fitcomp_core as FC  # noqa: E402

try:
    import FreeCAD  # noqa: F401
    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False

TRUE = {"sx": 1.004, "sy": 1.004, "sz": 0.998, "contour": 0.10, "hole": 0.15}
HOLES = [((-30, 0), 4.0), ((30, 25), 6.0)]
BOSSES = [((30, -25), 3.0)]


def reference():
    parts = [box_mesh(40, 30, 10, n=10, center=(0, 0, 5))]
    for (x, y), r in HOLES:
        V, F = cylinder_mesh(r, 10, closed=False)
        parts.append((V + [x, y, 5], F[:, [0, 2, 1]]))  # facing in: a hole's wall
    for (x, y), r in BOSSES:
        V, F = cylinder_mesh(r, 10, closed=False)
        parts.append((V + [x, y, 5], F))
    Vs, Fs, base = [], [], 0
    for V, F in parts:
        Vs.append(V)
        Fs.append(F + base)
        base += len(V)
    return np.concatenate(Vs), np.concatenate(Fs)


def printed(t=TRUE, sigma=0.02, seed=5):
    """Points and normals the scanner would see on the print."""
    rng = np.random.default_rng(seed)
    P, N = [], []

    def add(p, n):
        P.append(p)
        N.append(n)

    g = np.linspace(-1, 1, 60)
    U, W = np.meshgrid(g, g)
    U, W = U.ravel(), W.ravel()
    z = (W + 1) * 5  # 0..10
    for sign in (-1, 1):
        x = sign * (20 * t["sx"] + t["contour"])
        add(np.column_stack([np.full_like(U, x), U * 15 * t["sy"], z * t["sz"]]), np.tile([sign, 0, 0], (len(U), 1)))
        y = sign * (15 * t["sy"] + t["contour"])
        add(np.column_stack([U * 20 * t["sx"], np.full_like(U, y), z * t["sz"]]), np.tile([0, sign, 0], (len(U), 1)))
    add(np.column_stack([U * 20 * t["sx"], W * 15 * t["sy"], np.full_like(U, 10 * t["sz"])]), np.tile([0, 0, 1], (len(U), 1)))
    a = np.linspace(0, 2 * math.pi, 240, endpoint=False)
    zz = np.linspace(0.5, 9.5, 40)
    A, Z = np.meshgrid(a, zz)
    A, Z = A.ravel(), Z.ravel()
    for (x, y), r in HOLES:
        rr = r * (t["sx"] + t["sy"]) / 2 - t["hole"]
        add(np.column_stack([x * t["sx"] + rr * np.cos(A), y * t["sy"] + rr * np.sin(A), Z * t["sz"]]), np.column_stack([-np.cos(A), -np.sin(A), 0 * A]))
    for (x, y), r in BOSSES:
        rr = r * (t["sx"] + t["sy"]) / 2 + t["contour"]
        add(np.column_stack([x * t["sx"] + rr * np.cos(A), y * t["sy"] + rr * np.sin(A), Z * t["sz"]]), np.column_stack([np.cos(A), np.sin(A), 0 * A]))
    P, N = np.concatenate(P), np.concatenate(N)
    return P + N * rng.normal(0, sigma, (len(P), 1)), N


class Fit(unittest.TestCase):
    def test_reads_the_printer_back(self):
        V, F = reference()
        f = FC.find_features(V, F)
        kinds = sorted(c["kind"] for c in f["circles"])
        self.assertEqual(kinds, ["boss", "hole", "hole"])
        self.assertEqual({p["id"][:2] for p in f["planes"]}, {"-X", "+X", "-Y", "+Y", "-Z", "+Z"})
        S, N = printed()
        rd = FC.measure(f, S, None, N)
        sol = FC.solve(rd)
        self.assertLess(sol["fit"], 4, sol)
        self.assertAlmostEqual(sol["scale"]["x"]["value"], TRUE["sx"], delta=0.0015)
        self.assertAlmostEqual(sol["contour"]["value"], TRUE["contour"], delta=0.02)
        self.assertAlmostEqual(sol["hole"]["value"], TRUE["hole"], delta=0.02)
        cs = {c["quantity"]: c for c in FC.corrections(sol)}
        self.assertTrue(cs["hole"]["change"] and cs["contour"]["change"])
        km = {"label": "Bambu Studio", "keys": {"contour": {"key": "xy_contour_compensation", "kind": "add", "sign": -1},
                                                "hole": {"key": "xy_hole_compensation", "kind": "add", "sign": 1}}}
        ch = {c["key"]: c["to"] for c in FC.slicer_changes(list(cs.values()), km)}
        self.assertAlmostEqual(ch["xy_contour_compensation"], -TRUE["contour"], delta=0.02)
        self.assertAlmostEqual(ch["xy_hole_compensation"], TRUE["hole"], delta=0.02)
        self.assertIn("xy_hole_compensation =", FC.ini_fragment(FC.slicer_changes(list(cs.values()), km), km, "test"))

    def test_noise_judgement(self):
        cs = [{"quantity": "hole", "read": 0.05, "change": True}]
        plan = {"sigmaMm": 0.03, "source": "profile", "profile": {"name": "Pocket", "sigmaMm": 0.03}}
        j = FC.judge_noise(cs, 0.02, plan)
        self.assertEqual(j["nearNoise"][0]["quantity"], "hole")
        self.assertIn("Confirm on a second print", FC.noise_notes(j, False)[0])

    def test_compensate_undoes_it(self):
        V, F = reference()
        f = FC.find_features(V, F)
        C = FC.compensate(V, F, f, {**TRUE, "foot": 0, "footFade": 0.2})
        # The block's +X wall: 20 / sx − contour.
        on = np.isclose(V[:, 0], 20) & (np.abs(V[:, 1]) < 14)
        self.assertAlmostEqual(float(C[on, 0].mean()), 20 / TRUE["sx"] - TRUE["contour"], places=4)
        # A hole's wall opened by the hole offset.
        (hx, hy), r = HOLES[0]
        on = np.isclose(np.hypot(V[:, 0] - hx, V[:, 1] - hy), r)
        rr = np.hypot(C[on, 0] - hx / TRUE["sx"], C[on, 1] - hy / TRUE["sy"]).mean()
        self.assertAlmostEqual(rr, r / TRUE["sx"] + TRUE["hole"], delta=0.01)


try:
    from agentlink.protocol import ToolError  # noqa: F401

    HAVE_AL = True
except ImportError:
    HAVE_AL = False


@unittest.skipUnless(HAVE_AL, "Agent Link is not importable here")
class Tools(unittest.TestCase):
    def test_measure_calibrate_export(self):
        from scanrulerfc import fam_deviation as D
        from scanrulerfc import fam_fitcomp
        from scanrulerfc import scanstate as S

        class Sess:
            family_state = {}
            out_dir = tempfile.mkdtemp()

            def fit(self, a):
                self.cal = a
                return {"calibration": {"hole": a["hole"], "shaft": a["shaft"]}}

        s = Sess()
        V, F = reference()
        d = D.dstate(s)
        d["reference"] = {"name": "coupon.step", "V": V, "F": F}
        d["align"] = {"aligned": True}
        P, N = printed()
        k = len(P)
        t = np.cross(N, [0.3, 0.5, 0.81])
        t /= np.linalg.norm(t, axis=1)[:, None]
        b = np.cross(N, t)
        S.state(s)["scan"] = S.Scan("print.stl", np.concatenate([P, P + 1e-3 * t, P + 1e-3 * b]), np.column_stack([np.arange(k), np.arange(k) + k, np.arange(k) + 2 * k]))
        T = {x.name: x for x in fam_fitcomp.tools(s)}
        o = T["fit_scan_measure"].fn({"calibrate": True})
        json.dumps(o)
        self.assertEqual(o["calibrated"], {"hole": 0.3, "shaft": 0.201})
        keys = {c["key"]: c["to"] for c in o["slicer"]["changes"] if c["key"]}
        self.assertEqual(keys, {"xy_contour_compensation": -0.1, "xy_hole_compensation": 0.15})
        self.assertIn("xy_hole_compensation = 0.15", open(T["fit_scan_export"].fn({"what": "ini"})["file"]["path"]).read())
        self.assertTrue(os.path.isfile(T["fit_scan_export"].fn({"what": "stl"})["file"]["path"]))


if __name__ == "__main__":
    unittest.main()
