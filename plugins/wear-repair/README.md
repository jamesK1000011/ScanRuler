<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Wear repair

Brings a worn, dented or damaged part back to what it should be. The
reference is either its own other half, mirrored across its symmetry plane,
or a reference aligned in the Deviation workspace: the CAD, a twin's scan,
or a catalog download. It also pre-warps a model against a print of it, so
the next print comes out true.

- **Repair** moves each vertex in a region tagged worn onto the reference,
  fading out over a blend band, never inside a region tagged keep. The mesh
  keeps its triangles, so no boolean is needed on a scan that isn't closed.
- **Pre-warp** moves the target back along its normals by the error the
  print shows, smoothed. Each run is recorded, and a stop rule says when
  another isn't worth it.

## Commands (`wear.*`)

| Command | Changes | What |
|---|---|---|
| `wear.settings` | settings | Tolerance, blend band, how far the reference may be, add or both |
| `wear.tag` | regions | Boxes and spheres, worn or keep |
| `wear.reference` | reference | Mirror across a plane, or the aligned Deviation reference |
| `wear.diff` | nothing | Material lost and added per worn region |
| `wear.rebuild` | nothing | The repaired part as an STL, with the wear before and after |
| `wear.prewarp` | runs | The pre-warped target as an STL, the print's RMS, and whether to stop |

The agent guide is `guide.read { id: "wear-repair" }`.

## Layout

| Path | What |
|---|---|
| `core/geometry.ts` | Nearest points (three-mesh-bvh), regions, mirroring, normals |
| `core/repair.ts` | The diff and the snap repair |
| `core/prewarp.ts` | The smoothed inverse error field, and the stop rule |
| `tests/` | A block worn on one side, and a print 1 % long |
| `scripts/e2e-agent-wear.mjs` | Repair and two pre-warp runs through scanruler-mcp |
