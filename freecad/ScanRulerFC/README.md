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
