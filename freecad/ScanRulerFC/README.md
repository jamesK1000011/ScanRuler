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

- **scan, elements, align, dimensions** (3D Measure): `scan_open`, `scan_info`, `scan_nearest`, `scan_query`, `scan_segment`; `element_fit` (plane, sphere, cylinder, cone, torus, circle, point; ScanRuler's patch → LMedS → region growing → clipped Gaussian fit), `element_fit_marked`, `element_construct` (28 methods), `element_list`, `element_rename`, `element_remove`, `element_set_visible`; `align_datum` (3-2-1), `align_symmetry`, `align_clear`, `scan_scale`; `dimension_add` (sizes and GD&T), `dimension_set_limit`, `dimension_set_basic`, `dimension_remove`, `report_get`, `export_csv`. Not ported yet: `align_auto`.
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
- **Sections** (`sections` group): `section_cut`, `section_get`,
  `section_list`, `section_remove`, `section_fit` (ScanRuler's
  `reverse_section_fit`: lines and arcs with residuals) and
  `section_to_sketch`, which writes the fitted profile as a Sketcher sketch in
  a PartDesign body, ready for `pd_pad`.
- **Mesh Tools** (`meshtools` group, ScanRuler's Mesh Tools plugin):
  `mesh_inspect`, `mesh_remove_islands`, `mesh_delete_marked`,
  `mesh_flip_normals`, `mesh_cut`, `mesh_cut_preview`, `mesh_mirror`,
  `mesh_fill_holes`, `mesh_smooth`, `mesh_offset`, `mesh_reduce` (FreeCAD's
  `Mesh.decimate`, measured as ScanRuler measures it), `mesh_apply_reduced`,
  `mesh_discard`, `mesh_use_edited`, `mesh_discard_edited`, `mesh_undo`,
  `mesh_export`, `mesh_parts`. Edits go on a copy until `mesh_use_edited`.
- **2D measure** (`flat` group): `flat_open_image`, `flat_calibrate`,
  `flat_detect_edges`, `flat_edges`, `flat_fit`, `flat_dimension_add`,
  `flat_report`, `flat_export` (DXF, SVG). The sheet is an image or the
  section cut last.
