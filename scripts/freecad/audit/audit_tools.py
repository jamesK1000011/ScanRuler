# SPDX-License-Identifier: AGPL-3.0-only
# Agent Link's tools, every group listed, written out for the coverage audit:
# name, group, whether it changes the model, description; and the live
# echo's own map from tools to the FreeCAD commands that do the same job.
import json
import os
import sys

if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
from agentlink import echo  # noqa: E402
from agentlink.tools import Session, build_server  # noqa: E402
import tempfile  # noqa: E402  (after FreeCAD: its start clears names in __main__)

server = build_server(Session(out_dir=tempfile.mkdtemp()), lean=False)
tools = [{"name": t.name, "group": t.group, "changes": bool(t.changes), "description": t.description} for t in server.tools.values()]
links = {tool: cmd for tool, cmd in echo.COMMAND.items()}
kinds = {"CAM_OP": echo.CAM_OP, "CAM_DRESSUP": echo.CAM_DRESSUP}
with open(sys.argv[1], "w", encoding="utf-8") as f:
    json.dump({"tools": tools, "echo": links, "kinds": kinds}, f, indent=1)
print(f"audit: {len(tools)} tools -> {sys.argv[1]}")
