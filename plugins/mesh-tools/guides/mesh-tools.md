<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Cleaning up and editing a scan

The Mesh Tools workspace (commands under `mesh.*`) cleans a scan up, edits it
and reduces it to a light mesh for CAD. Every edit goes onto an **edited
copy** — made by the first edit — and every other workspace keeps measuring
the scan until `mesh.use_edited` takes the copy into use. Each edit is one
undo step (`history.undo` takes it back). The reduced mesh, a wrap and the
piece Trim to scan makes are made **beside** the mesh, as previews, not edits.

All coordinates are mm in the frame the part is measured in now (after any
alignment); `session.state` gives the scan's bounds. Align the part first if
it should land in CAD on its datums.

The workflow in short:

1. `mesh.parts`, `mesh.inspect` — what is there: islands, holes, closed or not.
2. `mesh.remove_islands`, `mesh.delete_marked` / `mesh.cut` — take off what is not the part.
3. `mesh.fill_holes` — close where the scanner could not see.
4. `mesh.smooth` — take the scatter out.
5. `mesh.reduce`, look, `mesh.export { part: "reduced" }` (or `mesh.apply_reduced`).
6. `mesh.use_edited` when the other workspaces should measure the cleaned mesh.

## Reading the mesh

- `mesh.parts` — the scan, the edited copy and its edits, the reduced mesh,
  the piece, the solids on offer to `mesh.boolean` / `mesh.trim` (by key and
  name), and what the parts list shows. Changes nothing.
- `mesh.inspect { pieceSize?, holeSize?, deviation? }` — vertices, triangles,
  bounds; whether it is closed (open and non-manifold edges) and the volume
  it encloses; the islands smaller than `pieceSize` and the holes smaller
  than `holeSize`, with the middle of each (use one as `fill_holes { at }`).
  `deviation: true` measures the edited copy against the scan in use. Run it
  before and after each edit.
- `mesh.cut_preview { plane, offset, keep? }` — what `mesh.cut` would do there,
  without cutting.

## Looking at it

- `mesh.show { scan?, reduced?, piece?, bodies?, deviation? }` — what the
  viewport shows, for a `view.render` picture. It puts Mesh Tools on screen
  and the tool in hand away; the answer's `back` names the workspace it
  replaced (`workspace.set` puts it back). The scan and the reduced mesh are
  shown one at a time. `deviation: true` colours the edited copy by its
  distance from the scan.
- `mesh.show { reduceView | wrapView | trimView }` — one view key alone puts
  that tool in hand with the key pressed: `reduceView` reduced / deviation /
  scan, `wrapView` wrap / inside / scan, `trimView` piece / gap / break.
  Each needs its result first.
- `mesh.mark { region, for? }` — mark a region on the part with the tool it is
  for in hand (`delete`, `flip`, `smooth`, `offset`), to look at it and then
  run that tool with `region: "marked"` — or let the person at the screen put
  the marking right first.

**Regions.** Where a command takes `region`: `"marked"` (what is marked on
screen now), or exactly one of `box { min, max }`, `sphere { center, radius }`
or `vertices [..]`, narrowed with `facing` (a direction) and `angleDeg`.

## Cleaning a scan

1. **Islands.** `mesh.inspect` counts them at a size; `mesh.remove_islands
   { size? }` deletes every connected piece smaller across than `size` (a
   hundredth of the part to start). Larger pieces all stay.
2. **What is not the part.** `mesh.delete_marked { region }` deletes the
   surface a region holds (a clamp, a fixture); the hole it leaves stays open.
   To take everything past a plane off — the table, a base — use
   `mesh.cut { plane, offset, keep, cap? }`: `plane` is "XY" / "YZ" / "XZ" or
   an element with a direction; `keep` plus or minus; `cap` (on to start)
   closes the part flat where the plane goes all the way round.
3. **Normals.** `mesh.flip_normals { region? }` for a part exported
   inside-out or patches that face in.
4. **Holes.** `mesh.fill_holes { size?, patch?, at? }` closes holes smaller
   than `size` (a twentieth of the part to start) — or, with `at`, only the
   one nearest that point. `patch` curved (to start) or flat. The answer's
   `closed` says whether the mesh is now closed — `mesh.boolean` and a hollow
   need it.
5. **Scatter.** `mesh.smooth { size?, limit?, keepEdges?, region? }` — bumps
   smaller than `size` go, larger shape stays; no point moves further than
   `limit`; `keepEdges` (on) leaves sharp edges as scanned.
6. **Reduce.** `mesh.reduce { tolerance?, maxTriangles? }` — a light mesh held
   within `tolerance` of the mesh, never above `maxTriangles` (50,000 to
   start). Take islands off first. Reduce again with other figures and it
   starts over. Look with `mesh.show { reduceView: "deviation" }` and
   `view.render`, then `mesh.export { part: "reduced", format? }` (stl or
   3mf) — or `mesh.apply_reduced` to make it the edited copy, or
   `mesh.discard { what: "reduced" }` to throw it away.
7. **Export / take into use.** `mesh.export { part: "edited" }` writes the
   edited copy; `mesh.use_edited` makes it the scan every workspace measures;
   `mesh.discard_edited` throws the copy and its edits away.

## Other edits

- `mesh.mirror { plane, offset?, mode?, keep? }` — `whole` reflects the part;
  `symmetric` reflects the kept side onto the other, replacing it.
- `mesh.offset { direction, distance, region? }` — expand or shrink along the
  normal (not a scale): spray thickness, a clearance.
- `mesh.boolean { op, solids }` — subtract, add or intersect solids on offer
  (fitted cylinders, cones, spheres from 3D Measure; Reverse engineer
  bodies). The mesh must be closed. A bore the scanner could not see the
  bottom of: fit a cylinder, extend it past the bottom, subtract it.
- `mesh.shell { thickness?, side?, mode? }` — a closed part is hollowed to a
  wall `thickness`; an open surface is thickened (`side` in / out / both). A
  part closed but for small holes is refused: fill them, or `mode: "thicken"`.
- `mesh.wrap { gap?, grow?, edges?, tolerance?, preview? }` — one closed skin
  round a messy mesh (an assembly in one file, internal shells, cracks):
  openings narrower than `gap` are bridged, so keep it small. A preview:
  look with `mesh.show { wrapView }`, then `mesh.apply_wrap` or
  `mesh.discard { what: "wrap" }`. A wrap takes a while: `mesh.stop` stops it.
- `mesh.trim { body, offset?, depth?, flip?, region? }` — mend a broken part:
  cut a Reverse engineer body (the missing piece, modelled a little long) with
  the scanned break, to print and glue in. Look with `mesh.show { trimView:
  "gap" }`; `mesh.export { part: "piece" }` writes it.

## Stopping and putting away

- `mesh.stop` — stops a `mesh.wrap` being worked out. A reduction, a trim
  and the edits run to their end.
- `mesh.discard { what: "reduced" | "wrap" }` — puts that preview away, as the
  panel's Discard does; nothing is applied.
