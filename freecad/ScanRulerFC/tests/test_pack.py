# SPDX-License-Identifier: AGPL-3.0-only
# Library pack: the licence rules on known pairs, the plan with a part
# from a restricted catalogue, and the scrub on a slicer config, a STEP
# header, an STL header, a PNG and a 3MF; through Agent Link, a pack written.
import io
import json
import os
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])

from scanrulerfc import pack_core as P  # noqa: E402

try:
    import FreeCAD  # noqa: F401
    import agentlink  # noqa: F401

    HAVE = True
except ImportError:
    HAVE = False


class Licences(unittest.TestCase):
    def test_read(self):
        self.assertEqual(P.read_licence("Creative Commons - Attribution - Non-Commercial - Share Alike"), "CC-BY-NC-SA-4.0")
        self.assertEqual(P.read_licence("CC BY 4.0"), "CC-BY-4.0")
        self.assertEqual(P.read_licence("Standard Digital File License"), "ARR")
        self.assertIsNone(P.read_licence("whatever"))

    def test_compatible(self):
        self.assertTrue(P.compatible("CC-BY-4.0", "CC-BY-SA-4.0")["ok"])
        self.assertFalse(P.compatible("CC-BY-SA-4.0", "CC-BY-4.0")["ok"])
        self.assertTrue(P.compatible("CC-BY-SA-4.0", "GPL-3.0-only")["ok"])
        self.assertFalse(P.compatible("CC-BY-NC-4.0", "CC-BY-4.0")["ok"])
        self.assertFalse(P.compatible("CC-BY-ND-4.0", "CC-BY-ND-4.0")["ok"])
        self.assertTrue(P.compatible("CC-BY-ND-4.0", "CC-BY-4.0", modified=False)["ok"])
        self.assertFalse(P.compatible("ARR", "CC0-1.0")["ok"])
        self.assertTrue(P.compatible(None, "CC-BY-4.0", permission=True)["ok"])

    def test_plan(self):
        s = {**P.DEFAULT_PACK, "licence": "CC-BY-4.0", "author": "J"}
        pl = P.plan(s, [{"part": "608.step", "source": "mcmaster"}, {"part": "knob", "licence": "CC BY", "author": "A", "url": "https://x.y/knob"}])
        self.assertTrue(pl["ok"])
        self.assertEqual(pl["leftOut"][0]["part"], "608.step")
        self.assertIn("Remixed from **knob** by A", P.readme(s, pl, ["models/a.stl"], {}))
        pl = P.plan({**s, "licence": "CC-BY-4.0"}, [{"part": "nc", "licence": "CC-BY-NC-4.0", "author": "A", "url": "https://a"}])
        self.assertFalse(pl["ok"])


def png_with_text():
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    raw = b"\x00\x00\x00\x00"
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"tEXt", b"Author\x00Jane") + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


class Scrub(unittest.TestCase):
    def test_config(self):
        cfg = "print_host = 192.168.1.40\naccess_code = 12345678\nprinter_sn = 01P00A1234\nfilament = /Users/jane/Library/x.json\nnote = mail jane@example.com\nlayer_height = 0.2\n"
        out, ch = P.scrub_file("Metadata/project_settings.config", cfg.encode())
        text = out.decode()
        for bad in ("12345678", "01P00A1234", "192.168", "jane", "/Users/"):
            self.assertNotIn(bad, text)
        self.assertIn("layer_height = 0.2", text)
        self.assertGreaterEqual(len(ch), 4)

    def test_step_stl_png_3mf(self):
        step = "FILE_NAME('/home/jane/part.step','2026-11-10',('Jane Doe'),('Acme'),'p','FreeCAD','');"
        out, ch = P.scrub_file("a.step", step.encode())
        self.assertIn("FILE_NAME('part.step','2026-11-10',(''),(''),'p','FreeCAD','')", out.decode())
        stl = b"C:\\Users\\jane\\part".ljust(80, b" ") + struct.pack("<I", 0)
        out, ch = P.scrub_file("a.stl", stl)
        self.assertTrue(out.startswith(b"library-pack"))
        out, ch = P.scrub_file("a.png", png_with_text())
        self.assertNotIn(b"Jane", out)
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("Metadata/project_settings.config", "access_code = 99\n")
        out, ch = P.scrub_file("a.3mf", buf.getvalue())
        self.assertNotIn(b"99", zipfile.ZipFile(io.BytesIO(out)).read("Metadata/project_settings.config"))


@unittest.skipUnless(HAVE, "FreeCAD and Agent Link are not importable here")
class Tools(unittest.TestCase):
    def test_write(self):
        import Part
        from agentlink.tools import Session, build_server

        session = Session(out_dir=tempfile.mkdtemp())
        server = build_server(session, lean=False)

        def call(n, a=None):
            r = server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": n, "arguments": a or {}}})["result"]
            return r.get("isError", False), json.loads(r["content"][0]["text"])

        o = session.doc.addObject("Part::Feature", "Body")
        o.Label = "Bracket"
        o.Shape = Part.makeBox(30, 20, 5)
        session.doc.recompute()
        self.assertTrue(call("pack_write")[0], "no licence, no author: refused")
        err, r = call("pack_setup", {"title": "Bracket", "author": "J. King", "licence": "CC BY-SA 4.0", "renders": 2})
        self.assertFalse(err, r)
        err, r = call("pack_write")
        self.assertFalse(err, r)
        names = zipfile.ZipFile(r["file"]["path"]).namelist()
        for want in ("LICENSE", "README.md", "models/Bracket.stl", "models/Bracket.3mf", "models/Bracket.step", "images/iso.png"):
            self.assertIn(want, names)


if __name__ == "__main__":
    unittest.main()
