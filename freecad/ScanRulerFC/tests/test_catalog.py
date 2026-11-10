# SPDX-License-Identifier: AGPL-3.0-only
# The parts catalog: a part named from calipers' readings, by name, and the
# search pages; the provenance kept as the person's file.
import os
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from scanrulerfc import catalog_core as C  # noqa: E402

try:
    from agentlink.protocol import ToolError  # noqa: F401

    from scanrulerfc import fam_catalog

    HAVE = True
except ImportError:
    HAVE = False


class Core(unittest.TestCase):
    def test_match(self):
        m = C.match({"d": 8.02, "D": 21.97, "B": 6.98})
        self.assertEqual(m[0]["part"]["designation"], "608 bearing")
        m = C.match({"d": 5, "dk": 8.4, "k": 4.9}, "socket-head-screw")
        self.assertEqual(m[0]["part"]["designation"], "M5 socket head cap screw")
        self.assertEqual(C.match({"d1": 5.3, "d2": 10, "h": 1})[0]["part"]["designation"], "M5 washer")

    def test_lookup(self):
        self.assertEqual(len(C.lookup("M2")), 3)  # screw, nut, washer: not M20, M24
        self.assertEqual(C.lookup("608")[0]["dims"], {"d": 8, "D": 22, "B": 7})
        self.assertEqual({p["kind"] for p in C.lookup("ISO 4762")}, {"socket-head-screw"})
        self.assertEqual([p["designation"] for p in C.lookup("M5 socket")], ["M5 socket head cap screw"])

    def test_links(self):
        ln = C.links("608 bearing", ["mcmaster", "printables"])
        self.assertEqual([x["source"] for x in ln], ["mcmaster", "printables"])
        self.assertIn("608-bearing", ln[0]["url"])


@unittest.skipUnless(HAVE, "Agent Link is not importable here")
class Tools(unittest.TestCase):
    def test_tools(self):
        class Sess:
            out_dir = tempfile.mkdtemp()

        t = {x.name: x for x in fam_catalog.tools(Sess())}
        o = t["catalog_part"].fn({"dims": {"d": 8.02, "D": 21.97, "B": 6.98}})
        self.assertEqual(o["named"], "608 bearing")
        o = t["catalog_part"].fn({"dims": {"d": 9, "D": 30, "B": 2}})
        self.assertNotIn("named", o)
        t["catalog_provenance"].fn({"action": "record", "record": {"file": "608.step", "source": "mcmaster", "shareable": False}})
        self.assertEqual(t["catalog_provenance"].fn({})["files"][0]["file"], "608.step")


if __name__ == "__main__":
    unittest.main()
