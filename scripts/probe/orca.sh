#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# What the Orca command line makes, printed into the log to read (the
# artifact store isn't reachable from every agent): an unsliced project from
# two STLs with Agent Link's minimal profiles, the same project sliced, and
# the CLI's help. Files print between ==== BEGIN <name> / ==== END markers.
[ -n "$AGENTLINK_PROBE_ORCA_SAMPLES" ] || exit 0
out="$1"; orca="$AGENTLINK_ORCASLICER"
AL="$GITHUB_WORKSPACE/freecad-addon"
python3 - "$out" "$AL" <<'PY'
import sys, struct, json
out, al = sys.argv[1], sys.argv[2]
sys.path.insert(0, al)
from agentlink import slicer_presets as SP
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
from agentlink import slicers
print(slicers.minimal_profiles({}, out))
# The path the bake-off proves: slice_with, two bodies, kept as a project.
import os
os.makedirs(f"{out}/sw", exist_ok=True)
try:
    print("slice_with:", slicers.slice_with("orcaslicer", [f"{out}/box.stl", f"{out}/tall.stl"], f"{out}/sw/two.gcode", {}, options={"project": f"{out}/sw/sw.3mf"}))
except Exception as e:
    print("slice_with failed:", e)
PY
cp "$out/sw/sw.3mf" "$out/sliced-sw.3mf" 2>/dev/null
for k in machine process filament; do cp "$out/agentlink-$k.json" "$out/$k.json"; done
# Orca 2.5 checks each per-filament list against the filament count.
python3 - "$out/filament.json" <<'PY3'
import json, sys
p = sys.argv[1]; d = json.load(open(p)); d.update({"filament_colour": ["#F2754E"], "filament_is_support": ["0"]}); json.dump(d, open(p, "w"), indent=1)
PY3
cd "$out"
xvfb-run -a "$orca" --help > help.txt 2>&1
xvfb-run -a "$orca" --help-fff > help-fff.txt 2>&1
mkdir -p made sliced
xvfb-run -a "$orca" --slice 0 --load-settings "$out/machine.json;$out/process.json" --load-filaments "$out/filament.json;$out/filament.json" --arrange 1 --debug 4 --logfile "$out/export-debug.log" --outputdir "$out/made" --export-3mf project.3mf "$out/box.stl" "$out/tall.stl" > export.log 2>&1; echo "export exit $?" >> export.log
cp made/result.json export-result.json 2>/dev/null; cp made/project.3mf project.3mf 2>/dev/null
xvfb-run -a "$orca" --slice 0 --outputdir "$out/sliced" --export-3mf sliced.3mf "$out/project.3mf" > slice.log 2>&1; echo "slice exit $?" >> slice.log
cp sliced/result.json slice-result.json 2>/dev/null
show() { echo "==== BEGIN $1"; cat "$2"; echo; echo "==== END $1"; }
tail -60 export-debug.log > export-debug-tail.log
grep -i -E "error|invalid|fail|preset|load" export-debug.log | head -80 > export-debug-short.log
for f in export.log slice.log export-result.json slice-result.json export-debug-short.log export-debug-tail.log machine.json process.json filament.json; do show "$f" "$f"; done
show help-fff.txt help-fff.txt | head -2000
ls -la . made sliced
for z in project.3mf sliced/sliced.3mf sliced-sw.3mf; do
  [ -f "$z" ] || continue
  unzip -l "$z"
  for n in $(unzip -Z1 "$z" | grep -v -E '\.png$|\.md5$'); do
    echo "==== BEGIN $z::$n"; unzip -p "$z" "$n" | head -c 60000; echo; echo "==== END $z::$n"
  done
done
