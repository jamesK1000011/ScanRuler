# SPDX-License-Identifier: AGPL-3.0-only
# Thread match on synthetic threads with the standard forms cut true: the
# reading, the helix fold, and the verdict, against what each is.
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

from scanrulerfc import thread_core as T  # noqa: E402

try:
    import FreeCAD  # noqa: F401
    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False


def form(u, pitch, angle=60.0, depth_share=None):
    """A symmetric tooth over one pitch: root flat centred on u=0, crest flat
    on u=0.5, straight flanks at the included angle. Height over the root."""
    half = math.radians(angle / 2)
    h = depth_share * pitch if depth_share else (5 / 8) * (math.sqrt(3) / 2) * pitch
    flank = h * math.tan(half) / pitch  # each flank's run, share of the pitch
    rest = 1 - 2 * flank
    root, crest = rest * 2 / 3, rest / 3
    u = (u + 0.5) % 1 - 0.5  # -0.5..0.5, root at 0
    a = np.abs(u)
    return np.clip((a - root / 2) / flank, 0, 1) * h


def thread(major, pitch, length=12.0, internal=False, left=False, taper=0.0, sigma=0.0, angle=60.0, per_mm=24, around=180, seed=3):
    """Points and normals of a threaded wall about z, from z=0 to length."""
    nz = int(length * per_mm)
    th = np.linspace(-math.pi, math.pi, around, endpoint=False)
    z = np.linspace(0, length, nz)
    TH, Z = np.meshgrid(th, z)
    s = -1 if left else 1
    u = (Z - s * pitch * TH / (2 * math.pi)) / pitch
    h = form(u, pitch, angle)
    H = (5 / 8) * (math.sqrt(3) / 2) * pitch if angle == 60 else h.max()
    R0 = major / 2 + taper * Z / 2
    # A boss: crests at the major. A bore: the tooth points in, crests (the
    # nut's minor) at major/2 − H, roots at the major.
    R = R0 - H + h if not internal else R0 - h
    rng = np.random.default_rng(seed)
    R = R + rng.normal(0, sigma, R.shape)
    P = np.column_stack([(R * np.cos(TH)).ravel(), (R * np.sin(TH)).ravel(), Z.ravel()])
    radial = np.column_stack([np.cos(TH).ravel(), np.sin(TH).ravel(), np.zeros(TH.size)])
    return P, radial * (-1 if internal else 1)


def name(P, N, radius, length=12.0, families=("metric", "unc", "unf", "print45")):
    rd = T.read_thread(P, N, [0, 0, length / 2], [0, 0, 1], radius, 1.5, length / 2 + 1)
    span = rd["threaded"] or rd["span"]
    sh = T.read_shape(P, [0, 0, length / 2], [0, 0, 1], radius, 1.5, span[0], span[1], rd["pitch"])
    return rd, sh, T.decide(T.reading_of(rd, sh), list(families))


class Tables(unittest.TestCase):
    def test_rows(self):
        m6 = T.lookup("M6x1")
        self.assertEqual((m6["major"], m6["pitch"], m6["minorInternal"]), (6, 1, 4.9175))
        self.assertAlmostEqual(T.lookup("1/4-20 UNC")["pitch"], 1.27)
        self.assertEqual(T.lookup("R 1/2")["taper"], 1 / 16)
        self.assertIn("4 starts", T.lookup("Tr8x2")["note"])
        self.assertEqual(T.lookup("Ø6×1.75 print")["depthShare"], 0.3)


class Reading(unittest.TestCase):
    def test_m6_boss(self):
        P, N = thread(6, 1.0, sigma=0.01)
        rd, sh, v = name(P, N, 2.75)
        self.assertAlmostEqual(rd["pitch"], 1.0, delta=0.02)
        self.assertFalse(rd["internal"])
        self.assertFalse(rd["leftHanded"])
        self.assertAlmostEqual(sh["pitch"], 1.0, delta=0.003)
        self.assertEqual(sh["starts"], 1)
        self.assertAlmostEqual(sh["flankAngle"], 60, delta=4)
        self.assertEqual(sh["flankConfidence"], "high")
        self.assertEqual((v["verdict"], v["best"]["designation"]), ("match", "M6×1"), v["candidates"][:3])

    def test_m8_bore(self):
        P, N = thread(8, 1.25, internal=True, sigma=0.01)
        rd, sh, v = name(P, N, 3.6)
        self.assertTrue(rd["internal"])
        self.assertAlmostEqual(rd["minor"], 8 - 1.0825 * 1.25, delta=0.1)
        self.assertEqual(v["best"]["designation"], "M8×1.25", v["candidates"][:3])

    def test_left_hand(self):
        P, N = thread(10, 1.5, left=True, sigma=0.01)
        rd, sh, v = name(P, N, 4.5)
        self.assertTrue(rd["leftHanded"])
        self.assertTrue(sh["leftHanded"])
        self.assertEqual(v["best"]["designation"], "M10×1.5")

    def test_pipe_taper(self):
        # 1/4 NPT: 18 tpi, 13.716 mm at the gauge plane, tapering 1:16.
        P, N = thread(13.716, 25.4 / 18, length=14, taper=1 / 16, sigma=0.01)
        rd, sh, v = name(P, N, 6.6, length=14, families=T.FAMILY_IDS)
        self.assertGreater(sh["taper"], 0.04)
        self.assertEqual(v["taperRead"], "tapered")
        self.assertEqual(v["best"]["family"], "npt", v["candidates"][:3])

    def test_noise_floor_ties_neighbours(self):
        # A coarse scanner can't tell 1/4-28 UNF from M6×... at a loose floor:
        # the noise to plan with widens the diameter tolerance.
        P, N = thread(6.35, 25.4 / 28, sigma=0.01)
        rd = T.read_thread(P, N, [0, 0, 6], [0, 0, 1], 3.0, 1.5, 7)
        tight = T.decide(T.reading_of(rd, None), ["metric", "unf"])
        loose = T.decide(T.reading_of(rd, None, floor_mm=0.5), ["metric", "unf"])
        self.assertGreater(loose["tolerance"]["diameter"], tight["tolerance"]["diameter"])

    def test_plain_wall_is_no_thread(self):
        th = np.linspace(-math.pi, math.pi, 180, endpoint=False)
        z = np.linspace(0, 12, 300)
        TH, Z = np.meshgrid(th, z)
        R = 3 + np.random.default_rng(1).normal(0, 0.01, TH.shape)
        P = np.column_stack([(R * np.cos(TH)).ravel(), (R * np.sin(TH)).ravel(), Z.ravel()])
        N = np.column_stack([np.cos(TH).ravel(), np.sin(TH).ravel(), np.zeros(TH.size)])
        rd = T.read_thread(P, N, [0, 0, 6], [0, 0, 1], 3, 1, 7)
        self.assertFalse(T.is_thread(rd))


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Tools(unittest.TestCase):
    def test_identify_through_agent_link(self):
        from agentlink.tools import Session, build_server

        d = tempfile.mkdtemp()
        server = build_server(Session(out_dir=d), lean=False)

        def call(n, a=None):
            r = server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": n, "arguments": a or {}}})["result"]
            return r.get("isError", False), json.loads(r["content"][0]["text"])

        # A boss as a closed-ish mesh: the threaded wall gridded, written as STL.
        nz, around = 288, 180
        P, _N = thread(6, 1.0, per_mm=24, around=around, sigma=0.01)
        F = []
        for i in range(nz - 1):
            for j in range(around):
                a, b, c, e = i * around + j, i * around + (j + 1) % around, (i + 1) * around + (j + 1) % around, (i + 1) * around + j
                F += [[a, b, c], [a, c, e]]
        import synth

        path = os.path.join(d, "boss.stl")
        synth.stl(path, P, np.array(F))
        self.assertFalse(call("scan_open", {"path": path})[0])
        err, o = call("scan_thread", {"axis": {"origin": [0, 0, 6], "direction": [0, 0, 1], "radius": 2.75}})
        self.assertNotIn("scanNoise", o, "nothing to plan with until a noise is read")
        self.assertFalse(call("scan_noise")[0])
        err, o = call("scan_thread", {"axis": {"origin": [0, 0, 6], "direction": [0, 0, 1], "radius": 2.75}})
        self.assertFalse(err, o)
        self.assertEqual(o["verdict"], "match", o)
        self.assertEqual(o["best"]["designation"], "M6×1")
        self.assertIn("scanNoise", o)
        # The same reading through Agent Link's one identify path.
        err, o2 = call("thread_identify", {"scan": {"axis": {"origin": [0, 0, 6], "direction": [0, 0, 1], "radius": 2.75}}})
        self.assertFalse(err, o2)
        self.assertEqual((o2["from"], o2["best"]["designation"]), ("scan", "M6×1"))
        self.assertIn("M6x1", o2["next"])


if __name__ == "__main__":
    unittest.main()
