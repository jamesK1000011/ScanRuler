# Cleaning up and editing a scan (ScanRuler for FreeCAD)
<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from ScanRuler's Mesh Tools guide (plugins/mesh-tools/guides/mesh-tools.md), by CNC Kitchen. -->

The `meshtools` group cleans a scan up, edits it and reduces it to a light mesh for CAD. Every edit goes onto an **edited copy**, made by the first edit; every other tool keeps measuring the scan until `mesh_use_edited` takes the copy into use. `mesh_undo` takes the last mesh edit back. The reduced mesh is made **beside** the mesh, as a preview, not an edit.

**With the document.** `mesh_export { part, to: "document" }` puts the edited copy or the reduced mesh in the FreeCAD document as a mesh object, where Agent Link's `meshobj_*` tools (Evaluate & Repair, booleans, sections, unwrap), slicing and export work on it. `scan_open { object }` takes a document mesh back in to measure.

Coordinates are mm in the frame the part is measured in now, after any alignment: align first (`align_auto`, `align_datum`) when it should land in CAD on its datums.

## The workflow

1. `mesh_parts`, `mesh_inspect` — what is there: islands, holes, closed or not.
2. `mesh_remove_islands`, `mesh_delete_marked` / `mesh_cut` — take off what is not the part.
3. `mesh_fill_holes` — close where the scanner could not see.
4. `mesh_smooth` — take the scatter out.
5. `mesh_reduce`, look, `mesh_export { part: "reduced" }` (or `mesh_apply_reduced`).
6. `mesh_use_edited` when the measuring tools should read the cleaned mesh.

## Reading the mesh

- `mesh_parts` — the scan, the edited copy and its edits, the reduced mesh, and the step `mesh_undo` would take back. Changes nothing.
- `mesh_inspect { pieceSize, holeSize }` — vertices, triangles, bounds; open and non-manifold edges; the volume when closed; the islands smaller than `pieceSize` and the holes smaller than `holeSize`, with the middle of each (one is `mesh_fill_holes { at }`). Run it before and after each edit.
- `mesh_cut_preview { plane, offset, keep }` — what `mesh_cut` would do there, without cutting.
- **Look** with `view_render { objects: [] }` (the scan alone) — before an edit, and after, from the same view.

**Regions.** Where a tool takes `region`: exactly one of `box { min, max }`, `sphere { center, radius }` or `vertices [..]` (from `scan_query`), narrowed with `facing` (a direction) and `angleDeg`.

## Cleaning a scan

1. **Islands.** `mesh_remove_islands { size }` deletes every connected piece smaller across than `size` — a hundredth of the part to start. Larger pieces all stay.
2. **What is not the part.** `mesh_delete_marked { region }` deletes the surface a region holds (a clamp, a fixture); the hole it leaves stays open. To take everything past a plane off — the table, a base — `mesh_cut { plane, offset, keep, cap }`: `plane` "XY", "YZ", "XZ" or an element with a direction; `keep` plus or minus; `cap` (on to start) closes the part flat where the plane goes all the way round.
3. **Normals.** `mesh_flip_normals { region }` for a part exported inside out, or patches that face in.
4. **Holes.** `mesh_fill_holes { size, patch, at }` closes holes smaller than `size` (a twentieth of the part to start) — or with `at` only the one nearest that point. `patch` curved (to start) or flat. The answer's `closed` says whether the mesh is now closed.
5. **Scatter.** `mesh_smooth { size, limit, keepEdges, region }` — bumps smaller than `size` go, larger shape stays; no point moves further than `limit`; `keepEdges` (on) leaves sharp edges as scanned.
6. **Reduce.** `mesh_reduce { tolerance, maxTriangles }` — a light mesh within `tolerance` of the one worked on (FreeCAD's quadric decimation, measured both ways). Read `held`: whether 99.9 % lies within tolerance both ways.

## Shape edits

- `mesh_mirror { plane, mode, keep, offset }` — `whole` reflects all of it; `symmetric` keeps one side and mirrors it onto the other: a damaged side rebuilt from the good one.
- `mesh_offset { distance, direction }` — the surface moved along its normal: grow a part for a fit, shrink one for a clearance. Not a scale: edges stay sharp.

## Into CAD

- `mesh_export { part: "edited" | "reduced", path, format }` writes STL (or 3MF) in mm. `import_file` brings it into the FreeCAD document as a body (closed, up to 20000 triangles) or a mesh.
- For a parametric part, cut sections and draw them instead: `section_cut`, `section_fit`, `section_to_sketch`, then `pd_pad` — the measure-scan guide, section 5.

## traps

- The other tools measure the **scan in use**: edits do nothing to a measurement until `mesh_use_edited`. Measure once more after it.
- `mesh_fill_holes` on an opening the part really has (a bore, a slot) closes the part's own hole: read each hole's middle in `mesh_inspect` first and fill by `at`.
- `mesh_smooth` with a large `size` rounds real edges and small features off: keep `limit` near the scan's noise.
- A reduced mesh is a preview: nothing is changed until `mesh_apply_reduced` or `mesh_export`.
