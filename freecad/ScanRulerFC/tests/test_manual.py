# SPDX-License-Identifier: AGPL-3.0-only
# Assembly instructions: the linter on known sentences, the plan's own
# checks and the bill of materials; through Agent Link, a peg dropped into
# a plate checked clear, a lid swept in sideways into a post caught, and the
# HTML written with a picture per step.
import json
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)
if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])

from scanrulerfc import manual_core as MC  # noqa: E402

try:
    import FreeCAD  # noqa: F401
    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False

STE = {"name": "ste100", "words": dict(MC.DEFAULT_WORDS)}


class Lint(unittest.TestCase):
    def rules(self, text, style=STE):
        return [f["rule"] for f in MC.lint(text, style)]

    def test_rules(self):
        self.assertEqual(self.rules("Push the peg into the plate."), [])
        self.assertIn("passive", self.rules("The peg is pushed into the plate."))
        self.assertIn("imperative", self.rules("The peg goes into the plate."))
        self.assertIn("one-instruction", self.rules("Push the peg and turn it."))
        self.assertIn("word", self.rules("Push the peg in order to seat it."))
        self.assertIn("length", self.rules("Push " + "the " * 25 + "peg."))
        self.assertEqual(self.rules("If it sticks, tap the peg."), [])

    def test_custom(self):
        st = {"name": "custom", "words": {}, "custom": "maxWords: 5\npassive: off\n- grub screw -> set screw"}
        self.assertIn("length", self.rules("Push the peg into the plate now.", st))
        self.assertNotIn("passive", self.rules("The peg is pushed.", st))
        self.assertIn("word", self.rules("Tighten the grub screw.", st))


class Plan(unittest.TestCase):
    def test_checks_and_bom(self):
        plan = {"settings": {}, "parts": [{"name": "Plate", "body": "Plate"}, {"name": "Peg", "body": "Peg"}, {"name": "Screw A", "designation": "M3x10 ISO 4762", "kind": "hardware"},
                                          {"name": "Screw B", "designation": "M3x10 ISO 4762", "kind": "hardware"}, {"name": "Lid", "body": "Lid"}],
                "steps": [{"place": [{"part": "Plate"}, {"part": "Peg"}]}, {"place": [{"part": "Screw A"}, {"part": "Screw B"}, {"part": "Peg"}, {"part": "Ghost"}]}]}
        problems, unplaced = MC.check_plan(plan)
        self.assertEqual(len(problems), 2)
        self.assertEqual(unplaced, ["Lid"])
        rows = MC.bom(plan)
        screw = next(r for r in rows if r["name"] == "M3x10 ISO 4762")
        self.assertEqual(screw["qty"], 2)
        page = MC.html_manual(plan, {}, {"Peg": (1, 0, 0)})
        self.assertIn("#ff0000", page)


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Tools(unittest.TestCase):
    def test_peg_lid_post(self):
        import FreeCAD
        import Part
        from agentlink.tools import Session, build_server


        def add_body(session, label, shape):
            o = session.doc.addObject("Part::Feature", "Body")
            o.Label = label
            o.Shape = shape
            session.doc.recompute()
            return o
        session = Session(out_dir=tempfile.mkdtemp())
        server = build_server(session, lean=False)

        def call(n, a=None):
            r = server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": n, "arguments": a or {}}})["result"]
            return r.get("isError", False), json.loads(r["content"][0]["text"])

        V = FreeCAD.Vector
        add_body(session, "Plate", Part.makeBox(40, 40, 5).cut(Part.makeCylinder(3.2, 5, V(10, 10, 0))))
        add_body(session, "Peg", Part.makeCylinder(3, 15, V(10, 10, 0)))
        add_body(session, "Post", Part.makeBox(4, 4, 20, V(30, 18, 5)))
        add_body(session, "Lid", Part.makeBox(10, 10, 3, V(30, 30, 10)))
        err, o = call("manual_plan", {"settings": {"title": "Peg board"}, "fromBodies": True, "steps": [
            {"place": [{"part": "Plate"}], "text": "Lay the plate flat."},
            {"place": [{"part": "Peg", "move": [0, 0, -1]}], "text": "Push the peg into the hole."},
            {"place": [{"part": "Post", "move": [0, 0, -1]}], "text": "Set the post on the plate."},
            {"place": [{"part": "Lid", "move": [0, 1, 0]}], "text": "The lid is pushed in from the front."}]})
        self.assertFalse(err, o)
        err, o = call("manual_check")
        self.assertFalse(err, o)
        by = {p["part"]: p for s in o["steps"] for p in s["parts"]}
        self.assertTrue(by["Peg"]["clear"], by["Peg"])
        self.assertIn("blockedShortBy", by["Lid"], by["Lid"])
        self.assertTrue(any(f["rule"] == "passive" for f in o["steps"][3]["lint"]))
        err, o = call("manual_plan", {"export": "plan.json"})
        self.assertTrue(os.path.isfile(o["exported"]))
        err, o = call("manual_render")
        self.assertFalse(err, o)
        self.assertEqual(o["pictures"], 4)
        with open(o["file"]["path"], encoding="utf-8") as f:
            self.assertEqual(f.read().count("data:image/png;base64"), 4)


if __name__ == "__main__":
    unittest.main()
