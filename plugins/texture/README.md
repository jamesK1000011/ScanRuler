<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Texture

The Texture workspace, as a plugin — see [../README.md](../README.md) for what
a plugin is. It runs **BumpMesh** (CNC Kitchen's surface-texture tool) on the
part ScanRuler has open: the same engine BumpMesh's Export button runs — the
result is BumpMesh's to the bit — with ScanRuler's regions for where the
texture goes.

## Texture: giving a part a printable surface

Open a part — a scan, or a model rebuilt in the Reverse engineer and exported
as STL — and pick the **Texture** tab.

- **Layers**: up to four, bottom first, each with its own texture, settings
  and surface. A layer covers the ones below where it reaches, or adds onto
  them.
- **Texture**: BumpMesh's library (grip, mold, geometric, patterns, …) or your
  own heightmap image, white high.
- **Settings**: mapping (triplanar, cubic, cylindrical, outline wrap,
  spherical, planar), depth, tile size, rotation, edge falloff, into or out of
  the surface, a stamp placed once.
- **Where it goes**: *Keep plain* paints the surfaces that must stay as they
  are; *Texture only* paints the only surfaces to texture. Mark with the
  window, brush or lasso and take the marking into the layer.
- **Output**: resolution, triangle budget, the bed face kept plain, and
  *Leave plain faces exactly as they are* (on by default) so a mating face
  comes out untouched.
- **Preview** builds it coarser and shows it in place of the scan; **Export
  STL / 3MF** builds it at full resolution.

## For agents

Commands under `texture` (`texture_*` tools through scanruler-mcp):
`textures`, `set`, `image`, `mask`, `show_mask`, `layer`, `output`,
`settings`, `estimate`, `preview`, `show`, `export`, `check`, `stop`; the
guide is `guide.read { topic: "texture" }`. `texture.check` proves after an
export that every protected vertex is where it was.

## The engine

`bumpmesh/` holds BumpMesh's engine and texture library, copied from a
BumpMesh checkout by `scripts/sync-engine.mjs` (which records the commit in
`bumpmesh/VERSION.json`); the `.d.ts` files beside it are the plugin's own.
Run the sync after pulling BumpMesh, then the e2e:

    node plugins/texture/scripts/sync-engine.mjs ../bumpmesh
    node plugins/texture/scripts/e2e-agent-texture.mjs     (dev server running)

BumpMesh is AGPL-3.0, as ScanRuler is; some library textures are CC BY 4.0
(Hero Patterns) or CC0 (ambientCG, Poly Haven) — see `bumpmesh/LICENSE`.

## Not yet

- The live shader preview BumpMesh draws as you drag a slider: here a
  preview is a coarse build of the real geometry.
- Headless runs (scanruler-mcp `--headless`): texturing needs the page.
- Soft-edged brush paint: a face is painted or not; `boundaryFalloff` ramps
  the texture in at a painted edge.
