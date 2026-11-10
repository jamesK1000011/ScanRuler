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

- **scan, elements, align, dimensions** (3D Measure): `scan_open`, `scan_info`, `scan_nearest`, `scan_query`, `scan_segment`, `scan_qa` (the check before modelling), `scan_fit_surface` (plane, bilinear or quadric with curvature), `scan_draft` (draft against a pull), `scan_pattern` (rotational repeats), `scan_heightmap` (heights along an axis, with levels); `element_fit` (plane, sphere, cylinder, cone, torus, circle, point; ScanRuler's patch → LMedS → region growing → clipped Gaussian fit), `element_fit_marked`, `element_construct` (28 methods), `element_list`, `element_rename`, `element_remove`, `element_set_visible`; `align_auto` (read off the scan), `align_datum` (3-2-1), `align_symmetry`, `align_clear`, `scan_scale`; `dimension_add` (sizes and GD&T), `dimension_set_limit`, `dimension_set_basic`, `dimension_remove`, `report_get`, `export_csv`.
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
pass at once. The deviation map is also read on the reference (`on: "reference"`). Not
ported yet: closing a scan's holes with the reference before the volume
error (an open scan reads `unsure` there instead).
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

- **Into the document** (`scan-cad`): `element_to_document` puts the fitted
  planes, cylinders, cones, spheres and tori into the FreeCAD document as
  Part geometry (solids or surfaces), lines, circles and points as reference
  edges and vertices, and can write them as STEP — ScanRuler's `files.step`,
  where PartDesign can take them as references.

### ScanRuler's plugins

- **Scanner noise** (`scan-noise`): `scan_noise` (this scan's noise, as the
  scan check reads it), `scanner` (your scanners in `scanners.json`, exported
  and imported whole). The noise to plan with — the larger of the scanner's
  usual and this scan's — is what the thread, wear and print-fit tools read.
- **Thread match** (`scan-thread`): `scan_thread` names a thread from a
  fitted bore or boss — ISO metric, UNC, UNF, UNEF, NPT, G/R pipe, Tr, ACME
  and the 45° print form — or says which sizes tie and the one hand
  measurement that settles them.
- **Wear repair** (`wear`): `wear_setup`, `wear_diff`, `wear_rebuild`
  (against the mirrored other half or the aligned reference),
  `wear_prewarp` (a model moved against a print of it, with the stop rule).
- **Print fit from a scan** (`fit-scan`): `fit_scan_setup`,
  `fit_scan_features`, `fit_scan_measure` (scale, contour and hole offsets,
  elephant foot; can become Agent Link's fit calibration),
  `fit_scan_export` (Bambu Studio, OrcaSlicer, PrusaSlicer keys, or your own
  key map; a pre-compensated STL).
- **Parts catalog** (`catalog`): `catalog_part` (a screw, nut, washer or
  bearing from measured sizes), `catalog_links`, `catalog_provenance`. The
  library searches and downloads stay in scanruler-mcp.
- **Assembly manual** (`manual`): `manual_plan`, `manual_check` (each
  part's way in swept against the parts there; the words linted),
  `manual_render` (one HTML page with a picture per step). The line-art
  sheets and themes wait for a GUI.
- **Library pack** (`pack`): `pack_setup`, `pack_plan` (upstream licences
  checked), `pack_write` (a zip, every file scrubbed of personal details).
- **More model formats**: glTF/GLB, Collada, VRML 2 and 3DS open as the scan
  or the reference through Agent Link's readers. FBX does not: export it as
  glTF.

Not ported, because FreeCAD or Agent Link already does it: generation,
FEA, CAM, mass, materials, fits and hardware, slicing and printer hand-off,
part review, setups, BumpMesh texturing (`texture_prepare`,
`texture_check`). Flatbed parts: `flat_objects` (parts parted from the background, with area, holes, caliper widths) and `flat_profile` (a knurl's or gear's teeth counted round a centre or along an axis).
Not ported yet: patent kit (TechDraw does most of it),
and the electronics pages (KiCad's own tools and KiCad StepUp cover the
board).
