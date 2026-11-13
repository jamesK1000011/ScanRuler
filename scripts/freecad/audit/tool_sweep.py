# SPDX-License-Identifier: AGPL-3.0-only
# What each Agent Link tool's answer costs an agent: every tool that only
# reads (and asks for nothing it cannot be given here) called once on a
# small fixture — a padded plate with a hole, a TechDraw view of it — with
# its answer's size, any picture's tokens and the time it took; then two
# short jobs (a drawing, a check-and-print) with their calls and totals.
# Prints SWEEP lines; HEAVY marks an answer over the budget (default 1,500
# tokens) so a regression shows in the log.

# FreeCAD first: its start clears names already imported into __main__.
import os
import sys

if os.environ.get("FREECAD_LIB"):
    sys.path.append(os.environ["FREECAD_LIB"])
import FreeCAD  # noqa: E402,F401

import json  # noqa: E402
import os  # noqa: E402,F811
import tempfile  # noqa: E402
import time  # noqa: E402

os.environ["AGENTLINK_USAGE"] = "off"
from agentlink import usage  # noqa: E402
from agentlink.tools import Session, build_server  # noqa: E402

BUDGET = int(os.environ.get("SWEEP_BUDGET", "1500"))
SKIP = {
    # restarts, installs, updates, long solves, the network or the person's own files
    "app_restart", "app_install", "agentlink_update", "app_extensions", "pref_import", "pref_export",
    "doc_open", "doc_close", "import_file", "slice", "fem_solve", "cam_simulate", "usage_report",
}
session = Session(out_dir=tempfile.mkdtemp())
srv = build_server(session, lean=False)
meter = usage.Meter(os.path.join(session.out_dir, "usage"), write=False)
srv.meter = meter


def call(name, args=None):
    r = srv.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
    return r.get("isError", False), json.loads(r["content"][0]["text"])


def need(name, args=None):
    err, o = call(name, args)
    if err:
        raise RuntimeError(f"{name}: {o}")
    return o


# the fixture
need("pd_body_new", {"name": "Plate"})
need("sketch_new", {"body": "Plate", "plane": "XY", "name": "Outline"})
need("sketch_add", {"sketch": "Outline", "items": [{"kind": "rectangle", "corner": [0, 0], "size": [60, 40]}, {"kind": "circle", "center": [30, 20], "diameter": 10}]})
need("pd_pad", {"body": "Plate", "sketch": "Outline", "length": 8})
page = need("td_page", {"action": "new", "paper": "A4", "name": "Sheet"})["page"]
view = need("td_view", {"page": page, "bodies": ["Plate"], "direction": "top", "scale": 1, "at": [100, 100], "name": "Top"})["view"]

FILL = {"body": "Plate", "bodies": ["Plate"], "object": "Plate", "objects": ["Plate"], "part": "Plate", "parts": ["Plate"],
        "sketch": "Outline", "page": page, "view": view, "views": [view], "target": "Plate"}

rows = []
for name, t in sorted(srv.tools.items()):
    # doc_* tools switch or save the document: the rest would run on another
    if t.changes or name in SKIP or (name.startswith("doc_") and name != "doc_info"):
        continue
    req = (t.schema or {}).get("required", []) or []
    if any(r not in FILL for r in req):
        continue
    args = {r: FILL[r] for r in req}
    n0 = len(meter.calls)
    t0 = time.time()
    err, o = call(name, args)
    ms = int((time.time() - t0) * 1000)
    row = meter.calls[n0] if len(meter.calls) > n0 else {"out": len(json.dumps(o)), "img": 0}
    tok = usage.tokens_of(row)
    rows.append((tok, name, row.get("out", 0), row.get("img", 0), ms, err))
rows.sort(reverse=True)
heavy = [r for r in rows if r[0] > BUDGET]
print(f"SWEEP called\t{len(rows)} read tools\t{sum(r[0] for r in rows)} tokens in all\t{len(heavy)} over {BUDGET}\t{sum(1 for r in rows if r[5])} refused", flush=True)
print("SWEEP tool\ttokens\tanswer chars\tpicture tokens\tms\trefused", flush=True)
for tok, name, out, img, ms, err in rows[:40]:
    print(f"SWEEP{' HEAVY' if tok > BUDGET else ''}\t{name}\t{tok}\t{out}\t{img}\t{ms}\t{'yes' if err else ''}", flush=True)


def job(title, calls):
    n0 = len(meter.calls)
    t0 = time.time()
    failed = None
    for name, args in calls:
        err, o = call(name, args)
        if err:
            failed = f"{name}: {str(o)[:160]}"
            break
    rs = meter.calls[n0:]
    tok = sum(usage.tokens_of(r) for r in rs)
    print(f"SWEEP job\t{title}\t{len(rs)} calls\t~{tok} tokens\t{sum(r.get('img', 0) for r in rs)} picture tokens\t{round(time.time() - t0, 1)}s" + (f"\tFAILED {failed}" if failed else ""), flush=True)


job("drawing: page, view, two dimensions, export", [
    ("td_page", {"action": "new", "paper": "A4", "name": "Job sheet"}),
    ("td_view", {"page": "Job sheet", "bodies": ["Plate"], "direction": "top", "scale": 1, "at": [100, 100], "name": "Job top"}),
    ("td_dim", {"view": "Job top", "type": "horizontal", "refs": [{"point": [0, 0, 8]}, {"point": [60, 0, 8]}]}),
    ("td_dim", {"view": "Job top", "type": "vertical", "refs": [{"point": [60, 0, 8]}, {"point": [60, 40, 8]}]}),
    ("td_export", {"page": "Job sheet", "formats": ["pdf"], "name": "job-sheet"}),
])
job("check and print: state, review, render", [
    ("session_state", {}),
    ("part_review", {"body": "Plate"}),
    ("view_render", {}),
])
