#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# What the Orca command line makes, kept to read: a box and a cylinder as
# STL, an unsliced project from them with a system printer, process and
# filament, the same project sliced, and its --help-fff.
set -x
out="$1"; orca="$AGENTLINK_ORCASLICER"; prof="$AGENTLINK_ORCA_PRESETS"
python3 - "$out" <<'PY'
import sys, math, struct
out = sys.argv[1]
def stl(path, tris):
    with open(path, "wb") as f:
        f.write(b"\0" * 80 + struct.pack("<I", len(tris)))
        for t in tris:
            f.write(struct.pack("<12fH", 0, 0, 0, *t[0], *t[1], *t[2], 0))
def box(x, y, z):
    v = [(0,0,0),(x,0,0),(x,y,0),(0,y,0),(0,0,z),(x,0,z),(x,y,z),(0,y,z)]
    f = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),(1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    return [[v[a], v[b], v[c]] for a, b, c in f]
stl(f"{out}/box.stl", box(20, 10, 5))
stl(f"{out}/tall.stl", box(8, 8, 20))
PY
ls "$prof" | head -50 > "$out/vendors.txt"
m="$prof/Custom/machine/MyKlipper 0.4 nozzle.json"; [ -f "$m" ] || m=$(ls "$prof"/Custom/machine/*0.4*.json | head -1)
ls "$prof/Custom/machine" "$prof/Custom/process" "$prof/Custom/filament" > "$out/custom.txt" 2>&1
p=$(ls "$prof"/Custom/process/*0.20mm*.json 2>/dev/null | head -1)
f=$(ls "$prof"/Custom/filament/*PLA*.json 2>/dev/null | head -1)
echo "$m | $p | $f" > "$out/picked.txt"
xvfb-run -a "$orca" --help > "$out/help.txt" 2>&1
xvfb-run -a "$orca" --help-fff > "$out/help-fff.txt" 2>&1
cd "$out"
xvfb-run -a "$orca" --load-settings "$m;$p" --load-filaments "$f;$f" --arrange 1 --export-3mf project.3mf box.stl tall.stl > export.log 2>&1; echo "export exit $?" >> export.log
xvfb-run -a "$orca" --slice 0 --export-3mf sliced.3mf --outputdir "$out/sliced" project.3mf > slice.log 2>&1; echo "slice exit $?" >> slice.log
ls -la "$out" "$out/sliced" > "$out/ls.txt" 2>&1
