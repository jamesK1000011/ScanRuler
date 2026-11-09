<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# ScanRuler for FreeCAD

ScanRuler's measuring of 3D scans, ported to FreeCAD from **ScanRuler by
CNC Kitchen** (https://github.com/CNCKitchen/ScanRuler; see NOTICE.md).
Licensed AGPL-3.0-only, the same as ScanRuler.

It adds its tools to **Agent Link**, the FreeCAD add-on that lets an agent
drive FreeCAD. Agent Link finds it at run time when `scanrulerfc` can be
imported: put this folder in FreeCAD's `Mod` folder next to Agent Link, or
on `PYTHONPATH`. Agent Link is a separate add-on under its own licence.

The tool names are ScanRuler's own (`scan_open`, `element_fit`,
`deviation_align` …), so ScanRuler's guides read the same here.
Everything is in millimetres.

## What is ported

- **scan** — `scan_open`, `scan_info`.
- **deviation** — `deviation_open_reference` (STEP, IGES, BREP tessellated
  finely; STL, PLY, OBJ, OFF, 3MF; or a solid in the document),
  `deviation_align` (auto, points, local: ScanRuler's prealign, Horn's
  absolute orientation and point-to-plane ICP; the scan's vertices are moved
  onto the reference), `deviation_measure`, `deviation_settings`,
  `deviation_set_target`, `deviation_hotspots`, `deviation_volume`,
  `deviation_export` (coloured PLY, CSV, NPY, the text report).
- **thickness** — `thickness_measure`, `thickness_settings`.

The maths is numpy only (`dev_*.py`, `wall_thickness.py`): nearest points
and rays go through a two-level tree of triangle leaves, every query of a
pass at once. Not ported yet: the deviation map read on the reference
(`on: "reference"`), and closing a scan's holes with the reference before
the volume error (an open scan reads `unsure` there instead).
