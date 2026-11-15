#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Build Agent Link for FreeCAD as a Claude Desktop extension (.mcpb): the
# launcher, this manifest, and the add-ons it installs. The add-ons come
# from scripts/freecad/addons.json: each source's folder in its checkout
# is copied to addons/<dest> by its FILES list (what git tracks, nothing
# else lying in the folder). Usage:
#   build.sh CHECKOUTS OUT
# CHECKOUTS holds one checkout per repo, named as the repo (e.g.
# CHECKOUTS/AgentLink-FreeCAD). A repo missing there is left out and
# fetched at the first update; AgentLink-FreeCAD is required.
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
CHECKOUTS=${1:?a folder with one checkout per repo, named as the repo}
OUT=${2:-$HERE/freecad-agentlink.mcpb}
AGENTLINK="$CHECKOUTS/AgentLink-FreeCAD"
[ -f "$AGENTLINK/FILES" ] || { echo "no AgentLink-FreeCAD checkout in $CHECKOUTS" >&2; exit 1; }
STAGE=$(mktemp -d)
cp "$HERE/manifest.json" "$STAGE/"
mkdir -p "$STAGE/server" "$STAGE/addons"
cp "$HERE/server/index.js" "$STAGE/server/"
copy() { # copy SRC DEST: the files FILES lists, less tests
  [ -f "$1/FILES" ] || return 0
  grep -v -E '^(tests/|#)|^$' "$1/FILES" | while read -r f; do
    mkdir -p "$STAGE/addons/$2/$(dirname "$f")"
    cp "$1/$f" "$STAGE/addons/$2/$f"
  done
}
python3 -c "
import json, sys
for s in json.load(open(sys.argv[1]))['sources']:
    print(s['repo'], s.get('folder') or '.', s['dest'])
" "$HERE/../addons.json" | while read -r repo folder dest; do
  copy "$CHECKOUTS/$repo/$folder" "$dest"
done
VERSION=$(python3 -c "import json;print(json.load(open('$HERE/manifest.json'))['version'])")
echo "$VERSION+$(git -C "$AGENTLINK" rev-parse --short HEAD)+$(git -C "$HERE" rev-parse --short HEAD)" > "$STAGE/addons/VERSION"
rm -f "$OUT"
(cd "$STAGE" && zip -qr "$OUT" .)
rm -rf "$STAGE"
echo "$OUT"
