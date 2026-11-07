<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Texturing a part for printing

The Texture workspace gives a part's surface a real, printable texture — the
mesh itself is displaced, not painted — with BumpMesh's engine (CNC Kitchen's
texturing tool, the same code its Export button runs, so a result here is the
result BumpMesh gives). ScanRuler supplies the part and, above all, the
regions: where the texture goes and where it must not. The output is a new
STL or 3MF; the scan is never changed.

Read this once before a texturing task. The workflow in short:

1. Read `session.state` — the part, its bounds and frame, and `plugins.texture`.
2. Find the surfaces: the ones to texture and the ones that must stay exactly as they are.
3. Pick a texture, depth and tile size that the printer can actually make.
4. Paint where it goes (`texture.mask`), look at the paint (`texture.show_mask`, `view.render`).
5. `texture.estimate`, then `texture.preview`, look, adjust.
6. `texture.export`, then `texture.check` — prove the protected surfaces are untouched.
7. Report: what was textured, with what, the file, and the check.

## 1. The part and its frame

- Work in the frame `session.state` reports: every coordinate a texture
  command takes or returns is mm in the frame the part is measured in now
  (after any alignment). Align first if the part is skewed — Z up, the bed
  face at the bottom — because cylindrical and planar mappings, the
  angle limits and "facing" all read Z as up.
- The part is the scan open in the session. To texture a model you rebuilt
  in the Reverse engineer, export its STL (`reverse.export_stl`) and open
  that as the scan. A Mesh Tools edited copy is textured only once taken
  into use (`mesh.use_edited`).
- `plugins.texture` in `session.state` shows the layers, each one's texture,
  depth, tile, mapping and paint, the output, and the last run.

## 2. Surfaces that must not change

Before anything is textured, name the surfaces that must stay exactly as
they are and say them back to the person: mating faces, press-fits, a cutout
another part slides into, a button, a datum face, a rail, threads, a hole
that takes a pin or a screw. A texture on any of these changes the fit. When
the person has called one surface the master fit, it is never textured,
whatever else changes.

Protect them one of two ways:

- **Texture only what is meant** — `mode: "include"` and paint just the
  panels to texture (a grip, a handle, a knob's rim). Everything else stays
  plain. Safest when the textured area is the smaller part.
- **Keep plain what must fit** — `mode: "exclude"` (the default) and paint
  the protected surfaces. Everything else is textured. Right when most of
  the part gets the texture.

Then:

- Keep `preserveUntextured` on (`texture.output`; it is on by default): the
  plain faces are then not refined or decimated at all, so they come out
  bit for bit as they went in.
- Give a protected feature a margin: paint a little past its edge, or set
  `boundaryFalloff` (0.5–1 mm) so the texture ramps in instead of standing
  at full depth against the edge.
- After export, `texture.check` proves it: every vertex all of whose faces
  are plain, looked for in the output at the same place to 0.001 mm.

## 3. Finding regions

`texture.mask` takes `region` as ScanRuler's region shapes, or `"marked"`:

- **A smooth surface by a point**: `{ near: [x, y, z], spreadDeg: 20 }` grows
  from the face nearest the point across every edge gentler than spreadDeg —
  one face or one fillet-joined panel, stopping at creases. Lower spreadDeg
  keeps it to flatter ground; raise it to run over fillets. Get the point from
  `scan.query`, an element's fit, a section, or the bounds.
- **Planar regions found for you**: `scan.segment` lists the part's flat
  regions with ids, normals, areas and boxes; `scan.segment { mark: [ids] }`
  marks them, then `texture.mask { region: "marked" }` takes the marking.
  Read its curved runs before taking strips for faces.
- **A box, narrowed by facing**: `{ box: { min, max }, facing: [1, 0, 0], angleDeg: 30 }`
  — the grip's side faces, say, without its top.
- **A sphere**: `{ sphere: { center, radius } }` — around a feature.
- **Vertices**: by number, as other commands report them.
- **"marked"**: whatever is marked on the part — by `scan.segment { mark }`,
  `element.fit { mark: true }`, or the person at the screen with the window,
  brush or lasso. Ask them to mark it when the surface is easier to point at
  than to describe; then take it with `region: "marked"`.

Combine with `op`: `set` (replace), `add`, `remove`, `clear`. Build up a grip
as several `add`s, cut a hole out of it with `remove`.

Always look before building: `texture.show_mask` lays the layer's paint on
the part in orange; `view.render` from two or three sides confirms it covers
what was meant and nothing it must not. A face counts as painted only when
all three of its corners are.

## 4. Textures

`texture.textures` lists the library by category:

- **grip**: Knurling (diamond knurl), Grip Surface, Isogrid — handles, grips, knobs.
- **mold**: Fine Stipple, Haircell, Hammered, Fine Leather, Brushed, Concrete —
  the finishes injection-moulded parts have; stipple and haircell read as a
  moulded grip and hide layer lines.
- **geometric / patterns / organic / fabric / natural** — decorative.

`texture.set { texture: "Knurling" }` gives the active layer a texture and its
default tile (a share of the part's largest side). Your own heightmap:
`texture.image { path }` — a PNG or JPEG, white high, black low; it is saved
with the project.

## 5. Depth and tile size the printer can make

These are starting points for FDM with a 0.4 mm nozzle; ask what the person
prints with if it matters (a 0.2 mm nozzle or resin can go finer).

- **Depth** (`textureHeight`, mm): 0.3–0.6 for a stipple or fine finish,
  0.5–1.0 for a grip or knurl, more for a bold pattern. Under about 0.2 mm
  the texture is lost in the layer lines.
- **Tile** (`scaleU`, mm): the smallest feature in a tile must be at least
  about two nozzle widths (0.8 mm) across or it prints as mush. A diamond knurl
  wants a pitch around 1.5–3 mm; a stipple's tile 5–15 mm.
- **Which way**: out of the surface (default) adds material — the part grows
  by the depth there. **Into the surface** (`invertDisplacement`) keeps the
  outside envelope — right for a part that must fit a holster, a case or a
  hand-measured size. **Both ways** (`symmetricDisplacement`) keeps the mean
  size. Into the surface thins the wall by the depth: read the wall first
  (`thickness.measure`) and keep at least 1.2 mm (three perimeters) under the
  texture.
- **Overhangs**: a deep texture on a downward face prints poorly; keep
  `bottomAngleLimit` (default 5°) for the bed face and consider
  `noDownwardZ`.

## 6. Mapping

- **Triplanar (5)**, the default, projects from the three axes and blends at
  the seams: good for most parts with flat-ish panels.
- **Cylindrical (3)** wraps round Z: handles, grips, bottles, knobs. The tile
  is rounded so a whole number wraps the part (snapSeamlessWrap); set
  `cylinderCenterX/Y` and `cylinderRadius` if the round part is not the
  part's middle.
- **Outline wrap (8)** follows the part's outline round Z — a grip that is not
  round, wrapped without stretching.
- **Cubic (6)** projects from the box faces — boxy parts.
- **Planar (0, 1, 2)** from one direction — a single face.
- **Stamp** (`stampOnce: true`, `stampCenterX/Y/Z`): the image once, a label
  or a logo, scaleU × scaleV mm. A planar stamp projects along its axis
  (planar YZ along X, XZ along Y, XY along Z) and lands on the side
  `stampSide` says: 1 the + side, -1 the − side — say it, or it lands on the
  mode's own side, which may be the far one. Surface normal (7) with
  `stampNormalX/Y/Z` set to the surface's normal at the centre lands it on a
  curved or tilted face. Look at it from that side (`view.render`).

## 7. Layers

Up to four, bottom first (`texture.layer`): a fine stipple over the whole
body on layer 1, a knurl only on the grip panels on layer 2. A layer covers
the ones below where it reaches (`blend: "cover"`) or adds onto them
(`"add"`). Each layer has its own paint and mode; texture.mask and texture.set
act on the active layer unless `layer` says otherwise.

## 8. Preview, budget, export

- `texture.estimate` first: the textured area, how many triangles it comes
  to at `refineLength`, and whether `maxTriangles` will squeeze it. The
  resolution is the part's diagonal / 250 unless set; it should be at most a
  quarter of the smallest feature in the tile. A squeezed build is decimated
  coarser than asked: raise `maxTriangles` (2–4 M is fine for a slicer) or
  accept it.
- `texture.preview` builds at twice the resolution, quickly, and shows it in
  place of the scan: `view.render` it from the sides that matter, and up close
  to the protected features (`view.set` to frame them). `texture.show
  { what: "scan" }` puts the scan back.
- `texture.export { format }` builds at full resolution (or reuses the last
  full build when nothing changed) and returns the file. Fine resolutions on
  big parts take minutes; `texture.stop` stops it.

## 9. Proving it

- `texture.check` after export: `kept` of `protectedVertices`, and `moved` —
  which must be 0 when surfaces were protected. Edge vertices (where plain
  meets textured) may move with the texture beside them; that is the boundary,
  not the protected surface. If anything moved: was `preserveUntextured` off,
  or did the paint miss part of the feature? Fix and export again.
- Say the result plainly: what is textured, depth and tile, which surfaces
  were kept and that the check passed (or what did not), the file and its
  triangle count.

## 10. Traps

- A texture outward makes the part bigger by its depth wherever it is: a
  grip that must still fit a holster wants "into the surface".
- Switching a layer's mask mode clears its paint (the paint means the opposite).
- `refineLength` far above the tile's features gives a blurred texture;
  far below gives a slow, huge build that is then decimated anyway.
- Textures cannot make a feature the printer cannot: the slicer will drop it.
- The scan must be the part's real surface: noise on a raw scan is textured
  too — smooth it in Mesh Tools first.
- Masks count the scan's vertices: opening another scan, or a Mesh Tools edit
  taken into use, invalidates them — paint again.
