# SPDX-License-Identifier: AGPL-3.0-only
# Put Agent Link and ScanRuler for FreeCAD into this FreeCAD's Mod folder,
# from the public branches on GitHub, file by file. Run it in FreeCAD's
# Python console:
#
#   import urllib.request as u; exec(u.urlopen("https://raw.githubusercontent.com/jamesK1000011/ScanRuler/freecad-spike/scripts/freecad/install_addons.py").read())
#
# Then restart FreeCAD. selftest() afterwards drives the add-ons in-process
# and prints what came back.

import json
import os
import urllib.request

import FreeCAD

OWNER = "jamesK1000011"
SOURCES = [
    # (repo, branch, folder in the repo, folder in Mod)
    ("FreeCAD-AgentLink", "main", "", "AgentLink"),
    ("ScanRuler-FreeCAD", "main", "", "ScanRulerFC"),
    ("OrcaSlicer-AgentLink", "main", "", "OrcaLink"),
    ("FreeCAD-Workshop", "main", "Common", "WorkshopCommon"),
    ("FreeCAD-Workshop", "main", "Parts", "WorkshopParts"),
]
MOD = os.path.join(FreeCAD.getUserAppDataDir(), "Mod")


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "agentlink-install"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def _tree(repo, branch, folder):
    # The folder's own tree, found from its parent: a recursive tree of the
    # whole FreeCAD repository is too big for the API to return whole.
    if not folder:
        t = json.loads(_get(f"https://api.github.com/repos/{OWNER}/{repo}/git/trees/{branch}?recursive=1"))
        return [x["path"] for x in t["tree"] if x["type"] == "blob" and "__pycache__" not in x["path"] and not x["path"].startswith(".")]
    parent, name = folder.rsplit("/", 1)
    listing = json.loads(_get(f"https://api.github.com/repos/{OWNER}/{repo}/contents/{parent}?ref={branch}"))
    sha = next(x["sha"] for x in listing if x["name"] == name and x["type"] == "dir")
    t = json.loads(_get(f"https://api.github.com/repos/{OWNER}/{repo}/git/trees/{sha}?recursive=1"))
    return [x["path"] for x in t["tree"] if x["type"] == "blob" and "__pycache__" not in x["path"]]


def install():
    os.makedirs(MOD, exist_ok=True)
    for repo, branch, folder, dest in SOURCES:
        files = _tree(repo, branch, folder)
        for rel in files:
            data = _get(f"https://raw.githubusercontent.com/{OWNER}/{repo}/{branch}/{folder + '/' if folder else ''}{rel}")
            p = os.path.join(MOD, dest, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "wb") as f:
                f.write(data)
        print(f"Agent Link install: {dest} — {len(files)} files into {os.path.join(MOD, dest)}")
    print("Agent Link install: done. Restart FreeCAD, then the Agent Link workbench has Start link.")


def selftest(out=None):
    """The add-ons driven in-process in this window: a part made, drawn
    headless, its wall mapped, and the window's own view saved."""
    import sys

    sys.path[:0] = [os.path.join(MOD, d) for _, _, _, d in SOURCES]
    from agentlink.tools import Session, build_server

    out = out or os.path.join(FreeCAD.getUserAppDataDir(), "AgentLink-selftest")
    os.makedirs(out, exist_ok=True)
    s = Session(out_dir=out)
    srv = build_server(s, lean=False)

    def call(name, args=None):
        r = srv.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args or {}}})["result"]
        body = json.loads(r["content"][0]["text"])
        kinds = [c["type"] for c in r["content"]]
        print(f"{name}: {'REFUSED ' if r.get('isError') else ''}{json.dumps(body)[:300]} {kinds}")
        return body

    print(f"selftest: {len(srv.tools)} tools; groups {sorted({t.group for t in srv.tools.values()})}")
    call("doc_new", {"name": "Selftest"})
    call("gen_make", {"params": {"x": 2, "y": 1, "units": 3, "magnets": True}, "name": "Bin"})
    call("view_render", {"views": "all", "inline": True})
    call("view_render", {"map": "wall", "views": ["iso", "top"]})
    call("view_snapshot", {"view": "iso"})
    print(f"selftest: pictures in {out}")
    return out


if __name__ == "__main__" or "__file__" not in globals():
    install()
