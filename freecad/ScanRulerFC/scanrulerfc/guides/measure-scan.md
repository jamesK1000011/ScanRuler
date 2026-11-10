# Measuring a 3D scan (ScanRuler for FreeCAD)
<!-- SPDX-License-Identifier: AGPL-3.0-only -->
<!-- Adapted from ScanRuler's measure guide (src/commands/guides/measure.md), by CNC Kitchen. -->

Guiding principle: **measure from reliable scan evidence, against datums the part actually uses, and never report a number finer than the scan can hold.**

A scan is a cloud of noisy samples of a surface. Every number you give rests on a fit, an alignment and a tolerance you chose; say which, so a person can repeat it. Numbers decide; pictures show where.

## 0. Setup

- **Groups.** The scan tools are in groups: `scan`, `elements`, `align`, `dimensions`, `sections`, `flat`, `deviation`, `thickness`, `meshtools`, `scan-noise`, `scan-thread`, `wear`, `catalog`, `manual`, `pack`, `fit-scan`. `tool_groups { enable: ["scan", "elements", "align", "dimensions"] }` lists those a measuring task needs; enable `deviation`, `thickness`, `sections` when it gets there. Any tool runs by name either way.
- **`scan_info` before acting and after**: the scan's box says where the part lies; the elements and dimensions what is measured. `session_state` is the FreeCAD document — the scan is not in it.
- **Every answer is in millimetres**, angles in degrees.
- **One undo step per change**, as for the document: `history_undo`, `history_checkpoint` / `history_restore`.
- **Keep the context small**: `limit` on point queries, pictures at the default size, `report_get` once at the end.
- **Task list:** open and inspect → noise floor and tolerance → datums → fit and dimension → sections, deviation, thickness as asked → report and files.

## 1. Open and inspect

- `scan_open` with the full path. An STL carries no units: check the box in the answer. A 40 mm bracket reading 1.57 across was in inches; 40000 across, in micrometres — open it again with `units`. Opening replaces the scan; it refuses over measurements unless `discard: true`.
- **A photogrammetry scan has no true size**: ask the person for lengths taken on the real part with calipers — long ones, best between centres. Measure the same lengths on the scan (fits and `dimension_add`), then `scan_scale { references: [{ dimension, true }], dryRun: true }` to see each reference's `offPct` (one far off the others is a bad fit or a typo), then without `dryRun`. Everything measured scales with it.
- **Look at the part**: `view_render { objects: [], views: "all" }` draws the scan alone from four sides (`objects: []` leaves the document's bodies out). Note open rims (missing data, not holes), spikes, blobs in holes and stitching seams — none of them may carry a measurement.
- **Measure the noise floor.** `element_fit { kind: "plane" }` on the largest face that is clearly one flat surface; its form error (RMS) is σ_scan. Fit a cylinder in the best bore as well. **Nothing measured on this scan is trustworthy finer than about 3 σ_scan.** It goes in the report.
- **Decide the tolerance** you judge against: the drawing's if the person has one, otherwise ask, otherwise a process value — machined 0.02–0.05 mm, moulded 0.05–0.1, cast, forged or printed 0.3–0.5. A tolerance under 3 σ_scan: say the scan cannot decide it, before measuring.

- `scan_qa` once before modelling: open rims (holes the scan did not close, circles where they fit), noise, a CAD tessellation told from a scan, and the thickness along an axis with the main faces' trend (a taper or a merge error called out).
- A moulded or cast part: `scan_draft { pull }` along each way the tools open, early — walls that lean half a degree to a few explain fits that miss by the lean. `split: "symmetry"` keeps a handed part's halves apart.
- A sloped or curved patch: `scan_fit_surface { box, normal }` names the simplest of plane, bilinear and quadric, with curvature radii. The outline seen along an axis: `section_cut { kind: "shadow" }`, then `section_fit`. Tiers, pockets and ledges: `scan_heightmap { levels: true }` (a gentle warp is taken out first and said); square onto a fitted face, `plane: <element>`; an icon or lettering on a curved face, `of: "relief"`; the deviation map laid flat, `of: "deviation"`. Blades, spokes, a bolt circle: `scan_pattern { axis }` counts them and finds the one out of place.

## 2. Datums and alignment

- **Coarse first:** `align_auto` reads a frame off the scan — the directions its faces are square to, the axis round walls run along — and stands the part on its base, long side along X. Read its `note` and `square` (how square the faces came out); `largestInside` means the largest flat face looks into the part (a rib's wall), not a face it mates on.
- **Then datums from function**, with `align_datum`: the primary is the face that mates (the mounting face, a flange, a turned part's axis) — not the largest plane. Secondary: an edge, a second face or a line through two hole axes. Origin: a hole axis, a corner, a sphere. Fit the datum elements first; each slot takes an element or points on the scan.
- **Symmetric parts:** `element_construct { kind: "plane", method: "plane-symmetry" }` finds the scan's mirror plane without moving it; `symmetry.rms` is how asymmetric the part is. `align_symmetry` settles the pose on it.
- **Cross-check** the frame with another face or bore: the angle between a fitted face and the axis it should lie on is the alignment's residual. Report it.
- Everything measured moves with the part. `align_clear` puts it back as scanned.

## 3. Fitting elements

- `element_fit` with a place: `{ point: [x, y, z] }` (the nearest vertex is taken) or `{ vertex: n }`. **Aim at the feature's middle**, not near an edge or a fillet — the fit grows its surface from there.
- **Outliers:** `sigma: 3` by default; 2 on noisy, threaded or knurled surfaces; 0 keeps every point. Record which.
- **Read every fit:** radius, form error, coverage and point count. A low count or coverage: the seed sat on a small patch — move it. A form error far over σ_scan on a surface meant to be one shape: it is not one shape (a fillet caught, two faces read as one, wear).
- **Regions by hand:** `scan_query { box | near, normal }` returns the vertices facing a direction; `element_fit_marked` fits exactly those. Use it for a face the seeded fit leaks off — and take the whole face.
- **Designed sizes:** `assumed` keeps a nominal diameter beside the fit; it is still reported as measured. **Known balls:** `knownDiameter` holds a gauge ball's diameter and fits the centre alone.
- **Constructions:** `element_construct` — midplanes, offsets, intersections, circles where a plane cuts a cylinder, planes from numbers.
- `scan_nearest` checks a place lies on the scan before fitting there. Runs of fits and probes go in one `batch`.

## 4. Dimensions and checks

- `dimension_add` with the elements as `refs`. Without `type` the type follows the elements (two planes: their distance; two spheres: centre distance). With `type`: distances and angles; `size-diameter`; form (`form-flatness`, `form-cylindricity`, `form-circularity`, `form-sphericity`); orientation (`orient-parallelism`, `orient-perpendicularity`, `orient-angularity` with a basic angle); location (`loc-coaxiality`).
- **Limits:** `limit: { kind: "band", nominal, plus, minus }` for a size, `{ kind: "max", max }` for a zone; each dimension then carries pass or fail. `dimension_set_limit` and `dimension_set_basic` change them later.
- **GD&T-like, not certified.** A flatness of 0.04 on a scan with σ 0.02 is mostly the scan: say so.
- **A verdict within 3 σ_scan of its limit is not a verdict** — call it inconclusive and say why.
- **Distances between features come from their fitted elements**, never from single picked points.

## 5. Sections, the 2D sheet and back to CAD

- `element_to_document` puts the fitted elements into the FreeCAD document (and STEP with `export`): align first, so they land in the part's own frame; then sketch on the planes and pad up to the faces.

- `section_cut { across: "XY" | "YZ" | "ZX", offset }` — the offset is then the coordinate — or across an element with a direction. `section_get` returns the polylines in the section's own [u, v]; `space: "world"` gives [x, y, z].
- `section_cut { across, kind: "shadow", play }` — not a cut: the whole scan seen along the plane's normal, its outer outline (holes and indentations filled), never inside the part. `play` mm all round for a slip fit (negative for a press fit), to `tolerance` (0.1). The outline for a foam cutout, a gridfinity insert, a tool holder: `section_to_sketch`, then pad it or pocket it into a block.
- **Slice pockets, bosses and holes at several heights**: the change from slice to slice reveals draft, tilt and rounds.
- **To CAD:** `section_fit` reads a section as lines and arcs with their residuals; `section_to_sketch` writes it as a Sketcher sketch in a PartDesign body, ready for `pd_pad` — the scan turned into a parametric part in FreeCAD. Check the sketch is closed before padding.
- **The 2D sheet** measures a section or a flatbed image of a flat part: `flat_open_image`, `flat_calibrate` against a known length (until then the scale is only the file's), `flat_detect_edges` (sensitivity 0–1), `flat_edges`, `flat_fit`, `flat_dimension_add`, `flat_report`, `flat_export`.
- Not in this port yet: shadow sections (`kind: "shadow"`, a part's widest outline), and the sheet's objects, profiles and picture.

## 6. Deviation against a reference

- `deviation_open_reference` with the reference's path (STEP, IGES, BREP, STL, PLY, OBJ, 3MF; `units` for meshes), or `body` — a solid in the FreeCAD document, so a part modelled here is the reference.
- **Align:** `deviation_align`.
  - `mode: "auto"` — a best fit over the whole part. It spreads a real error over everything: a shifted bore makes the whole part read slightly off.
  - `mode: "points"` — three or more pairs of the same point on scan and reference, then refined: for symmetric parts auto may turn wrongly.
  - `mode: "local"` — refined on a marked surface only (`vertices` from `scan_query`): fitting on the datum faces, the way the part is held. Prefer it when the person cares how the part sits.
  - Read the RMS and the points matched; report the mode.
- **Set the reading:** `deviation_settings { tolerance, range, maxDistance }` — range about 3 × tolerance; `maxDistance` large enough for real errors, under the wall thickness. `deviation_measure` measures again under the alignment in hand.
- **Volume first: `deviation_volume`** — how much material is wrong and where: `excess` (the reference has it, the part has not), `missing` the other way, each region with volume, depth and box; `unsure` is where the scan does not say — never an error.
- **Then `deviation_hotspots`, not the colours**: patches over tolerance, largest and farthest first, with centroid, box, mean and extreme — and `far`, read every time: scan beyond the search distance, a whole feature missing or extra that a clean map within reach still misses.
- **Read it on the reference too**: `deviation_hotspots { on: "reference" }` turns the map round — each spot of the CAD read against the scan. `coveredPct` is how much of the reference the scan stands behind; `unscanned` says where it does not (never scanned, or a feature the part lacks); `mostOutside` is material the part lacks, `mostInside` material it has over the model. `view_render { map: "deviation-reference" }` paints it on the reference, grey where unscanned.
- **Look:** `view_render { map: "deviation", objects: [] }` — red stands proud, blue below, grey past the max distance — and `zoom: { at: patch.centroid, size }` on each patch. `layers: ["scan", "reference"]` draws both, the reference blue.
- **Against an element instead:** `deviation_set_target` maps how far the scan strays from one of its own fitted elements — a face's or a bore's form made visible.
- **Classify every patch:** a real deviation; misalignment (opposite signs on opposite sides, a twist); scan artefact (spikes, fill in holes, open rims); or scatter within tolerance — count it once, don't chase it.

## 7. Wall thickness

- `thickness_settings` then `thickness_measure`. `method: "ray"` shoots along the inward normal to the far wall; `"sphere"` takes the largest sphere that fits — the true wall at corners and ribs. `maxThickness` just over the thickest wall expected.
- Read min, mean and the share under the limit. Thin readings along open rims are rays escaping, not thin walls: check a thin patch with `view_render { map: "thickness", zoom }` and a `section_cut` through it before reporting it.

## 7a. Noise to plan with

- `scan_noise` reads this scan's σ (the median scatter of small plane fits); `scanner { action: "use", name }` names the scanner it came from, with its usual noise. The **noise to plan with** is the larger of the two: a scan is never surer than its scanner. Nothing finer than three times it (`finestMm`) is trustworthy.
- Scanners are the person's own data, in `scanners.json` with their files: `scanner { action: "export" }` and `"import"` move them between machines. Never invent a scanner's noise: measure it on a flat, matte part and `scanner add` that.

## 7b. Threads

- Fit a cylinder in the bore or on the boss (`element_fit` kind cylinder; a thread's form error is high — that is the teeth), then `scan_thread { axis: { element } }`.
- `match` high: name it. `match` low: name it as likely. `ambiguous`: give the person `deciding[0]` — the one caliper or gauge reading that settles it — and what each size would read. `none`: worn, printed or non-standard; say so.
- A noisy scanner ties neighbouring sizes on purpose (the tolerance follows the noise to plan with). On the model, `thread_cut` cuts metric and Unified sizes with FreeCAD's Hole.

## 7c. Wear repair and pre-warp

- **What it should be:** its own other half (`align_symmetry`, then `wear_setup { reference: { source: "mirror", plane } }`) or the CAD or a twin aligned in deviation (`{ source: "deviation" }`). Tag the worn regions, and `keep` what must not move (a fit face, a feature meant to differ).
- `wear_diff` before `wear_rebuild`: if `note` says the tolerance is under the floor, raise it — what is past a scatter-level tolerance is scatter, not wear.
- `wear_rebuild` writes an STL; a broken-off piece does not come back — model it from the reference.
- **Pre-warp loop:** the target as the deviation reference, a scan of its print as the scan, `deviation_align`, `wear_prewarp`. Print what it writes, scan, run again until `stop`. Starting a print is the person's call.

## 7d. A standard part from its sizes

- `catalog_part { dims }` names a screw, nut, washer or bearing from caliper readings (or sizes fitted on the scan): it names one only within 5% and clearly ahead of the next; otherwise it says what to measure. `catalog_links { query }` gives search pages for its CAD with each source's terms; record what comes in with `catalog_provenance`.

## 7e. Assembly instructions

- Model the parts where they sit assembled. `manual_plan { fromBodies: true, steps }`: each step places parts with the way they move in (`move`, toward their place). `manual_check` sweeps each one in against what is already there and lints the words; fix every `blockedShortBy` (another way in, or another order) before `manual_render` writes the HTML.
- The plan is data: `manual_plan { export }` and `{ import }` move it between projects.

## 7f. Sharing the part

- `pack_setup { title, author, licence }`, then `pack_plan`: every part taken from others (catalog_provenance's records) is checked against the licence. A guide, not legal advice: the person confirms each upstream licence and the choice of their own.
- `pack_write` scrubs every file (paths, user names, printer access codes and serials, e-mails, metadata) and says what it took out. The upload is the person's.

## 7g. Calibrate the printer from a scan of a print

- The CAD it was printed from as the reference, the scan of the print as the scan, `deviation_align`. `fit_scan_setup { up, slicer, current }` (the slicer values in use), then `fit_scan_measure`.
- χ²/dof over 4 is a poor run: warping, a lifted corner, a bad alignment — the offsets are not to be used. `nearNoise`: finer than this scan is trusted for; confirm on a second print before changing the slicer.
- A good run: `fit_scan_export { what: "ini" }` for the slicer, `{ what: "stl" }` for a pre-compensated model, and `fit_scan_measure { calibrate: true }` to make it the calibration every hole Agent Link sizes takes.

## 8. Report and files

- `report_get` — the frame, every element and dimension with value, limit and verdict. `export_csv` writes the measurements; `deviation_export` a coloured PLY, CSV, NPY or the text report; `mesh_export` the scan as it stands; `view_render { path }` the pictures, the map and its range named beside each.
- The scan and its measurements live in this session, not in the FreeCAD file: write the report before the session ends.
- **Write-up:** what was measured, on which scan, in which frame (datums and residuals), σ_scan, the tolerance and where it came from, every dimension with nominal, measured and verdict, deviation with its alignment mode and `far`, thickness with its method, every assumption (`assumed`, sigma), and the pictures.

## Red flags

| Symptom | What it means | What to do |
|---|---|---|
| Scan size implausible (1.57 across for a 40 mm part) | Wrong units | `scan_open` again with `units` |
| Datum plane form error far over σ_scan | A fillet or a second face caught, or a bowed part | `scan_query` + `element_fit_marked`; report a bow |
| Fit with low coverage or few points | The seed sat near an edge or on a small patch | Seed in the middle; several places for a broken surface |
| Bore radius sensible, form error high | Threads, knurl, scan stripes | `sigma: 2`; read it as a thread, not a size |
| A verdict within 3 σ_scan of its limit | The scan cannot decide it | Report inconclusive, with σ_scan |
| `deviation_align` RMS high | Wrong reference, wrong units, or a wrong turn | Check units; `mode: "points"` |
| Opposite-sign patches on opposite sides | Misalignment, not the part | `mode: "local"` on the datums, measure again |
| `far` high | A missing or extra feature, or the part far off | Look at each far patch; check the alignment |
| Thin readings along rims | Rays escaping at open boundaries | `method: "sphere"`; check with a section |
| `scan_thread` ambiguous between a metric and an inch size | The scan can't resolve the pitch difference over this length | Ask for `deciding[0]`; a longer cylinder helps |
| `section_cut` misses the scan | The offset is a coordinate on a coordinate plane | Read the box; give the coordinate |
| `align_auto` `largestInside` | The largest face is a rib's or pocket's wall | `align_datum` on the face it mates on |
| A batch answers stopped | Refused at a call, earlier ones rolled back | Fix that call, send the batch again |
