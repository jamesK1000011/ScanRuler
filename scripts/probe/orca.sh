#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
# What the Orca command line makes, printed into the log to read (the
# artifact store isn't reachable from every agent): an unsliced project from
# two STLs with Agent Link's minimal profiles, the same project sliced, and
# the CLI's help. Files print between ==== BEGIN <name> / ==== END markers.
out="$1"; orca="$AGENTLINK_ORCASLICER"
AL="$GITHUB_WORKSPACE/freecad-addon/src/Mod/AgentLink"
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
for k, v in SP.minimal({}).items():
    json.dump(v, open(f"{out}/{k}.json", "w"), indent=1)
PY
cd "$out"
xvfb-run -a "$orca" --help > help.txt 2>&1
xvfb-run -a "$orca" --help-fff > help-fff.txt 2>&1
xvfb-run -a "$orca" --load-settings "machine.json;process.json" --load-filaments "filament.json;filament.json" --arrange 1 --export-3mf project.3mf box.stl tall.stl > export.log 2>&1; echo "export exit $?" >> export.log
mkdir -p sliced
xvfb-run -a "$orca" --slice 0 --export-3mf sliced.3mf --outputdir "$out/sliced" "$out/project.3mf" > slice.log 2>&1; echo "slice exit $?" >> slice.log
show() { echo "==== BEGIN $1"; cat "$2"; echo; echo "==== END $1"; }
for f in export.log slice.log help.txt; do show "$f" "$f"; done
show help-fff.txt help-fff.txt | head -400
ls -la . sliced
for z in project.3mf sliced/sliced.3mf; do
  [ -f "$z" ] || continue
  unzip -l "$z"
  for n in $(unzip -Z1 "$z" | grep -v -E '\.png$|\.gcode$|\.md5$'); do
    echo "==== BEGIN $z::$n"; unzip -p "$z" "$n" | head -c 60000; echo; echo "==== END $z::$n"
  done
done
