#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Build FreeCAD Agent Link as a Claude Desktop extension (.mcpb): the
# launcher, this manifest, and the add-ons. Usage: build.sh AGENTLINK_DIR OUT [ORCALINK_DIR]
# (ORCALINK_DIR: a checkout of OrcaSlicer-AgentLink; else the first update
# fetches it)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
AGENTLINK=${1:?the AgentLink folder (a checkout of FreeCAD-AgentLink)}
OUT=${2:-$HERE/freecad-agentlink.mcpb}
SRFC=$HERE/../../../freecad/ScanRulerFC
STAGE=$(mktemp -d)
cp "$HERE/manifest.json" "$STAGE/"
mkdir -p "$STAGE/server" "$STAGE/addons"
cp "$HERE/server/index.js" "$STAGE/server/"
cp -R "$AGENTLINK" "$STAGE/addons/AgentLink"
cp -R "$SRFC" "$STAGE/addons/ScanRulerFC"
if [ -n "$3" ]; then cp -R "$3" "$STAGE/addons/OrcaLink"; fi
find "$STAGE/addons" \( -name __pycache__ -o -name tests -o -name .gitignore -o -name .git -o -name .github \) -prune -exec rm -rf {} +
VERSION=$(python3 -c "import json;print(json.load(open('$HERE/manifest.json'))['version'])")
echo "$VERSION+$(git -C "$AGENTLINK" rev-parse --short HEAD)+$(git -C "$HERE" rev-parse --short HEAD)" > "$STAGE/addons/VERSION"
rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" .)
rm -rf "$STAGE"
echo "$OUT"
