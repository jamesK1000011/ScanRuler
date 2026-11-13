# SPDX-License-Identifier: AGPL-3.0-only
# ScanRuler's wall thickness read for Agent Link's printability check.
import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
try:
    import FreeCAD  # noqa: F401
    import MeshPart  # noqa: F401
    import Part

    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class DfmWall(unittest.TestCase):
    def test_plate_reads_its_thickness(self):
        from scanrulerfc import dfm_wall

        w = dfm_wall.read(Part.makeBox(30, 30, 2))
        self.assertEqual(w["by"], dfm_wall.BY)
        self.assertAlmostEqual(w["least"], 2.0, delta=0.05)
        self.assertGreater(w["read"], 50)

    def test_thin_rib_found(self):
        from scanrulerfc import dfm_wall

        part = Part.makeBox(30, 30, 3).fuse(Part.makeBox(0.6, 20, 10, FreeCAD.Vector(15, 5, 3))).removeSplitter()
        w = dfm_wall.read(part)
        self.assertLess(w["least"], 0.7)

    def test_boss_with_pilot_reads_no_false_wall(self):
        # A screw boss whose top face has a small pilot hole: Mefisto meshed
        # that face open, and the rays read 0.05 mm walls that aren't there.
        from scanrulerfc import dfm_wall

        part = Part.makeBox(40, 40, 30).cut(Part.makeBox(36, 36, 29, FreeCAD.Vector(2, 2, 2)))
        part = part.fuse(Part.makeCylinder(3.5, 28, FreeCAD.Vector(4.5, 4.5, 2))).removeSplitter()
        part = part.cut(Part.makeCylinder(1.35, 11, FreeCAD.Vector(4.5, 4.5, 19.5)))
        w = dfm_wall.read(part)
        self.assertGreater(w["least"], 1.5, w["at"])

    def test_registered_in_the_check(self):
        import scanrulerfc.agentlink_families  # noqa: F401
        from agentlink import printability

        if not hasattr(printability, "WALL_READERS"):
            self.skipTest("this Agent Link takes no wall readers")
        w = printability.wall(Part.makeBox(30, 30, 2))
        self.assertIn("ScanRuler", w.get("by", ""))


if __name__ == "__main__":
    unittest.main()
