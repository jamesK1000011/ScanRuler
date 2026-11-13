# SPDX-License-Identifier: AGPL-3.0-only
# What Agent Link's tool list costs an agent before it does anything: the
# definitions each session loads, as listed by default (lean) and with every
# group, and per group — estimated at ~3.5 characters a token (agentlink.usage).
# With ANTHROPIC_API_KEY set, the exact count from Anthropic's token-counting
# endpoint as well.

# FreeCAD first: its start clears names already imported into __main__.
import os
import sys

if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
import FreeCAD  # noqa: E402,F401

import json  # noqa: E402
import os  # noqa: E402,F811
import tempfile  # noqa: E402
import urllib.request  # noqa: E402

os.environ["AGENTLINK_USAGE"] = "off"
from agentlink import usage  # noqa: E402
from agentlink.tools import Session, build_server  # noqa: E402


def listing(lean):
    srv = build_server(Session(out_dir=tempfile.mkdtemp()), lean=lean)
    tools = [t.listing() for t in srv.listed()]
    chars = len(json.dumps(tools, separators=(",", ":"), ensure_ascii=False)) + len(srv.instructions)
    return srv, tools, chars


def exact(tools):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    body = json.dumps({"model": os.environ.get("BUDGET_MODEL", "claude-sonnet-5-5"), "messages": [{"role": "user", "content": "hi"}],
                       "tools": [{"name": t["name"], "description": t["description"], "input_schema": t["inputSchema"]} for t in tools]}).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages/count_tokens", body, {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.load(r).get("input_tokens")
    except Exception as e:
        print(f"BUDGET exact count failed: {e}")
        return None


srv, lean_tools, lean_chars = listing(True)
_, full_tools, full_chars = listing(False)
print(f"BUDGET lean\t{len(lean_tools)} tools\t{lean_chars} chars\t~{usage.est_tokens(lean_chars)} tokens" + (f"\texact {exact(lean_tools)}" if os.environ.get("ANTHROPIC_API_KEY") else ""))
print(f"BUDGET full\t{len(full_tools)} tools\t{full_chars} chars\t~{usage.est_tokens(full_chars)} tokens" + (f"\texact {exact(full_tools)}" if os.environ.get("ANTHROPIC_API_KEY") else ""))
groups = {}
for t in full_tools:
    g = srv.tools[t["name"]].group or "?"
    x = groups.setdefault(g, [0, 0])
    x[0] += 1
    x[1] += len(json.dumps(t, separators=(",", ":"), ensure_ascii=False))
for g, (n, c) in sorted(groups.items(), key=lambda kv: -kv[1][1]):
    print(f"BUDGET group\t{g}\t{n} tools\t~{usage.est_tokens(c)} tokens")
