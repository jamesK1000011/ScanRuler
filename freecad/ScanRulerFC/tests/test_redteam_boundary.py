# SPDX-License-Identifier: AGPL-3.0-only
# Red team: the licence boundary (Agent Link, LGPL, must not import
# ScanRulerFC, AGPL) and ScanRulerFC against an older Agent Link. Needs
# Agent Link importable (PYTHONPATH, as CI sets it); skipped otherwise.
import os
import re
import sys
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

try:
    import agentlink

    AGENTLINK = os.path.dirname(os.path.dirname(os.path.abspath(agentlink.__file__)))
except ImportError:
    agentlink = None
    AGENTLINK = None


@unittest.skipUnless(AGENTLINK, "Agent Link is not importable here")
class LicenceBoundary(unittest.TestCase):
    def test_agent_link_code_never_names_scanrulerfc_for_import(self):
        hits = []
        pat = re.compile(r"""(import\s+scanrulerfc|from\s+scanrulerfc|import_module\(\s*["']scanrulerfc|["']scanrulerfc\.)""")
        for root, _dirs, files in os.walk(os.path.join(AGENTLINK, "agentlink")):
            for f in files:
                if not f.endswith(".py"):
                    continue
                p = os.path.join(root, f)
                with open(p, encoding="utf-8") as fh:
                    for i, line in enumerate(fh, 1):
                        code = line.split("#", 1)[0]
                        if pat.search(code):
                            hits.append(f"{os.path.relpath(p, AGENTLINK)}:{i}: {line.strip()}")
        self.assertEqual(hits, [])


@unittest.skipUnless(AGENTLINK, "Agent Link is not importable here")
class OlderAgentLink(unittest.TestCase):
    def _with_old_render(self, body):
        saved = sys.modules.get("agentlink.render")
        saved_attr = getattr(agentlink, "render", None)
        for k in [m for m in sys.modules if m.startswith("scanrulerfc")]:
            del sys.modules[k]
        old = types.ModuleType("agentlink.render")  # a render with no register_layer
        sys.modules["agentlink.render"] = old
        agentlink.render = old
        try:
            body()
        finally:
            if saved is not None:
                sys.modules["agentlink.render"] = saved
            else:
                sys.modules.pop("agentlink.render", None)
            if saved_attr is not None:
                agentlink.render = saved_attr
            for k in [m for m in sys.modules if m.startswith("scanrulerfc")]:
                del sys.modules[k]

    def test_extension_failure_does_not_take_agent_link_down(self):
        try:
            from agentlink import families
        except ImportError:
            self.skipTest("agentlink.families not importable")
        self._with_old_render(families.load)  # was: AttributeError escaped build_server

    def test_import_survives_and_keeps_every_family(self):
        import importlib

        def body():
            m = importlib.import_module("scanrulerfc.agentlink_families")
            self.assertEqual(len(m.FAMILIES), len(m.NAMES))

        self._with_old_render(body)


if __name__ == "__main__":
    unittest.main()
