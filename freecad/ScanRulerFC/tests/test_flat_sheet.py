# SPDX-License-Identifier: AGPL-3.0-only
# The 2D sheet's housekeeping: a note in the report and the exports, an
# alignment that moves what the report and the exports read, an element
# hidden from the export, and removals that name what they leave invalid.
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

try:
    from agentlink.protocol import ToolError  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False


@unittest.skipUnless(HAVE, "Agent Link is not importable here")
class Sheet(unittest.TestCase):
    def setUp(self):
        from scanrulerfc import fam_flat
        from scanrulerfc import flat_core as FC
        from scanrulerfc import scanstate as St
        from test_flat_objects import S, sheet

        class Sess:
            family_state = {}
            out_dir = tempfile.mkdtemp()

        s = Sess()
        St.state(s)["flatSubject"] = {"kind": "image", "name": "x.png"}
        f = fam_flat.fl_state(s)
        g = sheet()
        f.update({"image": {"name": "x.png", "fileName": "x.png", "gray": g, "width": g.shape[1], "height": g.shape[0], "decoder": "test"},
                  "pxPerMm": {"x": 1 / S, "y": 1 / S}, "calSource": "measured", "chains": FC.detect_edges(g, 0.5, min_length=24)})
        f["elements"] += [{"id": 1, "name": "Mark", "kind": "point", "method": "x", "fit": {"kind": "point", "at": [25.0, 30.0]}},
                          {"id": 2, "name": "Edge", "kind": "line", "method": "x", "fit": {"kind": "line", "center": [50.0, 5.0], "dir": [1.0, 0.0], "length": 30.0}}]
        f["dimensions"].append({"id": 1, "type": "flat-dist-point-line", "name": "Gap", "refs": [1, 2]})
        self.T = {t.name: t for t in fam_flat.tools(s)}

    def test_note_alignment_edit_remove(self):
        T = self.T
        T["flat_note_add"].fn({"text": "Gear, 12 teeth", "at": [5, 45]})
        T["flat_set_alignment"].fn({"origin": [15, 30], "xAxis": [15, 40]})  # X up the sheet
        text = T["flat_report"].fn({})["text"]
        self.assertIn("Notes\n  Gear, 12 teeth", text)
        self.assertIn("X axis at 90.000°", text)
        self.assertIn("Mark: X 0.000 · Y -10.000 mm", text)  # 10 mm right of the origin is −Y once X points up
        for fmt in ("svg", "dxf"):
            with open(T["flat_export"].fn({"format": fmt})["file"]["path"], encoding="latin-1") as fh:
                self.assertIn("Gear, 12 teeth", fh.read())
        T["flat_edit"].fn({"element": "Edge", "visible": False})
        self.assertEqual(T["flat_export"].fn({"format": "svg"})["elements"], 1)
        out = T["flat_remove"].fn({"elements": ["Edge"], "notes": [1]})
        self.assertEqual(out["invalidDimensions"], ["Gap"])
        pic = T["flat_render"].fn({"size": 400})
        with open(pic["file"]["path"], "rb") as fh:
            self.assertEqual(fh.read(4), b"\x89PNG")
        self.assertEqual(pic["width"], 400)
        T["flat_set_alignment"].fn({"clear": True})
        self.assertIn("image frame", T["flat_report"].fn({})["text"])


if __name__ == "__main__":
    unittest.main()
