#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# The automated GUI pass: every add-on in addons.json put in FreeCAD's user
# Mod folder as the launcher would, then one GUI run of gui-shots.py per
# theme (FreeCAD's own Light and Dark, and Agent Link's Studio Light and
# Dark). Pictures and gui-report.json per theme under the out folder; a
# summary of the findings at the end. A report, never a failure.
#   gui-shots.sh <workspace with the add-on checkouts> <out>
set -u
here=$(cd "$(dirname "$0")" && pwd)
ws=${1:?the folder holding the add-on checkouts}
out=${2:?where the pictures go}
user=$(python -c "import sys; sys.path.append('$CONDA_PREFIX/lib'); import FreeCAD; print(FreeCAD.getUserAppDataDir())")
res=$(python -c "import sys; sys.path.append('$CONDA_PREFIX/lib'); import FreeCAD; print(FreeCAD.getResourceDir())")
mkdir -p "$user/Mod" "$out"
# addons.json's dest -> the checkout the bake-off made for it.
declare -A src=([AgentLink]=freecad-addon [ScanRulerFC]=scanrulerfc-addon [OrcaLink]=orcalink-addon [Texturizer]=texturizer-addon [SafetyNet]=safetynet-addon
  [WorkshopParts]=workshop-addons/Parts [WorkshopMake]=workshop-addons/Make [WorkshopElectronics]=workshop-addons/Electronics [WorkshopDocuments]=workshop-addons/Documents)
for dest in $(python -c "import json; print(' '.join(s['dest'] for s in json.load(open('$here/addons.json'))['sources']))"); do
  from="$ws/${src[$dest]:-}"
  [ -d "$from" ] || { echo "gui-shots: no checkout for $dest"; continue; }
  rm -rf "$user/Mod/$dest" && cp -r "$from" "$user/Mod/$dest"
done
ls "$user/Mod"
stock="$res/Gui/PreferencePacks"
agent="$ws/freecad-addon"
for pack in "$stock/FreeCAD Light/FreeCAD Light.cfg" "$stock/FreeCAD Dark/FreeCAD Dark.cfg" "$agent/Studio Light/Studio Light.cfg" "$agent/Studio Dark/Studio Dark.cfg"; do
  [ -f "$pack" ] || { echo "gui-shots: no pack $pack"; continue; }
  name=$(basename "$pack" .cfg); name=${name// /-}
  env -u PYTHONPATH GUI_THEME_CFG="$pack" GUI_THEME="$name" GUI_SHOTS="$out" \
    timeout 900 xvfb-run -a -s "-screen 0 1600x1000x24" freecad "$here/gui-shots.py" > "$out/$name.log" 2>&1
  code=$?; echo "gui-shots: $name exit $code"; [ $code -ne 0 ] && tail -n 40 "$out/$name.log"; grep -E '^gui-shots|Traceback|Error' "$out/$name.log" | tail -n 30
done
python "$here/gui-summary.py" "$out" | tee "$out/summary.md"
exit 0
