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
