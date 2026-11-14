#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Build FreeCAD Agent Link as a Claude Desktop extension (.mcpb): the
# launcher, this manifest, and the add-ons it installs — each copied from
# its checkout by its FILES list (what git tracks, nothing else lying in
# the folder). Usage:
#   build.sh AGENTLINK_DIR OUT [SCANRULERFC_DIR] [ORCALINK_DIR]
# SCANRULERFC_DIR: a checkout of ScanRuler-FreeCAD; ORCALINK_DIR: of
# OrcaSlicer-AgentLink. Either left out is fetched at the first update.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
AGENTLINK=${1:?the AgentLink folder (a checkout of FreeCAD-AgentLink)}
OUT=${2:-$HERE/freecad-agentlink.mcpb}
STAGE=$(mktemp -d)
cp "$HERE/manifest.json" "$STAGE/"
mkdir -p "$STAGE/server" "$STAGE/addons"
cp "$HERE/server/index.js" "$STAGE/server/"
copy() { # copy SRC DEST: the files FILES lists, less tests
  [ -n "$1" ] || return 0
  grep -v -E '^(tests/|#)|^$' "$1/FILES" | while read -r f; do
    mkdir -p "$STAGE/addons/$2/$(dirname "$f")"
    cp "$1/$f" "$STAGE/addons/$2/$f"
  done
}
copy "$AGENTLINK" AgentLink
copy "${3:-}" ScanRulerFC
copy "${4:-}" OrcaLink
VERSION=$(python3 -c "import json;print(json.load(open('$HERE/manifest.json'))['version'])")
echo "$VERSION+$(git -C "$AGENTLINK" rev-parse --short HEAD)+$(git -C "$HERE" rev-parse --short HEAD)" > "$STAGE/addons/VERSION"
rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" .)
rm -rf "$STAGE"
echo "$OUT"
