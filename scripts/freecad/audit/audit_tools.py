# SPDX-License-Identifier: AGPL-3.0-only
# Agent Link's tools, every group listed, written out for the coverage audit:
# name, group, whether it changes the model, description; and the live
# echo's own map from tools to the FreeCAD commands that do the same job.

# FreeCAD first: its start clears names already imported into __main__.
import os
import sys

if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
import FreeCAD  # noqa: E402,F401

import glob  # noqa: E402,F401
import json  # noqa: E402
import os  # noqa: E402,F811
import subprocess  # noqa: E402,F401
import sys  # noqa: E402,F811
import tempfile  # noqa: E402
import zipfile  # noqa: E402,F401
from agentlink import echo  # noqa: E402
from agentlink.tools import Session, build_server  # noqa: E402

server = build_server(Session(out_dir=tempfile.mkdtemp()), lean=False)
tools = [{"name": t.name, "group": t.group, "changes": bool(t.changes), "description": t.description} for t in server.tools.values()]
links = {tool: cmd for tool, cmd in echo.COMMAND.items()}
kinds = {"CAM_OP": echo.CAM_OP, "CAM_DRESSUP": echo.CAM_DRESSUP}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({"tools": tools, "echo": links, "kinds": kinds}, f, indent=1)
print(f"audit: {len(tools)} tools -> {sys.argv[1]}")
