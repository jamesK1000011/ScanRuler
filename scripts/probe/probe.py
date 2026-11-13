# SPDX-License-Identifier: AGPL-3.0-only
# The benchmark's other servers, looked at: freecad-robust-mcp started
# embedded and its tool list read over stdio; neka-nat/freecad-mcp and
# theosib/FreeCAD-MCP-Server cloned and their tools named from the source.
import json, os, re, subprocess, sys, glob, time

def sh(cmd, **kw):
    print("$", cmd, flush=True)
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=kw.get("timeout", 600))
    print(r.stdout[-3000:], r.stderr[-3000:], flush=True)
    return r

sh(f"{sys.executable} -m pip install -q freecad-robust-mcp")
sh(f"{sys.executable} -m pip show freecad-robust-mcp")
sh("which freecad-mcp freecad-robust-mcp; ls $(dirname $(which python)) | grep -i -E 'mcp|freecad' ")
# its configuration names
r = sh(f"{sys.executable} -c \"import freecad_mcp, os; print(os.path.dirname(freecad_mcp.__file__))\"")
pkg = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
if pkg:
    sh(f"grep -rhoE 'FREECAD_[A-Z_]+' {pkg} | sort | uniq -c")
    sh(f"grep -rn 'embedded' {pkg} | head -20")

def mcp(cmd, env):
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env={**os.environ, **env}, text=True)
    def req(i, method, params=None):
        p.stdin.write(json.dumps({"jsonrpc": "2.0", "id": i, "method": method, "params": params or {}}) + "\n"); p.stdin.flush()
        while True:
            line = p.stdout.readline()
            if not line:
                raise RuntimeError("closed: " + p.stderr.read()[-2000:])
            try:
                m = json.loads(line)
            except Exception:
                continue
            if m.get("id") == i:
                return m
    init = req(1, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "probe", "version": "1"}})
    p.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"); p.stdin.flush()
    tl = req(2, "tools/list")
    return p, req, init, tl

for exe in ("freecad-mcp", "freecad-robust-mcp"):
    for mode in ("embedded",):
        try:
            p, req, init, tl = mcp([exe], {"FREECAD_MODE": mode, "FREECAD_PATH": os.environ.get("FREECAD_LIB", "")})
            tools = tl["result"]["tools"]
            print("ROBUST", exe, mode, len(tools), "tools", len(json.dumps(tools)), "bytes", "instructions", len((init["result"].get("instructions") or "")), flush=True)
            for t in tools:
                print("ROBUST tool", t["name"], json.dumps(t.get("inputSchema", {}).get("properties", {}))[:300], "|", (t.get("description") or "")[:160].replace("\n", " "), flush=True)
            r = req(3, "tools/call", {"name": "get_freecad_version", "arguments": {}}) if any(t["name"] == "get_freecad_version" for t in tools) else None
            print("ROBUST version", json.dumps(r)[:600], flush=True)
            p.kill()
            break
        except Exception as e:
            print("ROBUST", exe, mode, "failed", e, flush=True)

for repo in ("neka-nat/freecad-mcp", "theosib/FreeCAD-MCP-Server"):
    d = "/tmp/" + repo.split("/")[1]
    sh(f"git clone -q --depth 1 https://github.com/{repo} {d}")
    sh(f"ls {d}; grep -rn -E '@mcp.tool|@server.tool|def handle_|\"name\": \"' {d} --include=*.py | head -80")
