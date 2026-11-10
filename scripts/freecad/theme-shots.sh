#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Pictures of FreeCAD in the Studio themes (and its own light theme beside
# them), for looking at a theme without a Mac to hand: the add-on put in
# FreeCAD's user Mod folder so its packs are found, then one GUI run each.
set -u
here=$(cd "$(dirname "$0")" && pwd)
addon=${1:?the Agent Link folder}
out=${2:?where the pictures go}
user=$(python -c "import sys; sys.path.append('$CONDA_PREFIX/lib'); import FreeCAD; print(FreeCAD.getUserAppDataDir())")
mkdir -p "$user/Mod" "$out"
rm -rf "$user/Mod/AgentLink" && cp -r "$addon" "$user/Mod/AgentLink"
stock=$(python -c "import sys; sys.path.append('$CONDA_PREFIX/lib'); import FreeCAD; print(FreeCAD.getResourceDir())")/Gui/PreferencePacks
status=0
for pack in "$addon/Studio Light/Studio Light.cfg" "$addon/Studio Dark/Studio Dark.cfg" "$stock/FreeCAD Light/FreeCAD Light.cfg"; do
  name=$(basename "$pack" .cfg)
  THEME_CFG="$pack" THEME_SHOT="$out/${name// /-}.png" \
    timeout 180 xvfb-run -a -s "-screen 0 1600x1000x24" freecad "$here/theme-shot.py" > "$out/${name// /-}.log" 2>&1 || status=1; tail -n 25 "$out/${name// /-}.log"
done
ls -la "$out"
exit $status
