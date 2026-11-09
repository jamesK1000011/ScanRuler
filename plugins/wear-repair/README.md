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

## The workspace

**Wear repair** is a tab of its own in the Model group, after Mesh Tools.
Its panel runs the commands below, the same ones an agent calls: what the
part should be (mirror, with Align on symmetry, or the part aligned in
Surface Deviation), the regions (a ball or a box, its centre picked on the
part), the settings, Read wear and Repair STL, and the pre-warp runs with
the stop rule's verdict.

It is not a page of a shared tab: the tab it belongs beside, Mesh Tools, is
a workspace of its own rather than a host (see `plugins/_shared/
workspaces.ts`), and Fits, Print and Electronics are about other work.
Should Mesh Tools become a host, Wear repair is one `host:` line away from
being its page.

## Commands (`wear.*`)

| Command | Changes | What |
|---|---|---|
| `wear.settings` | settings | Tolerance, blend band, how far the reference may be, add or both |
| `wear.tag` | regions | Boxes and spheres, worn or keep |
| `wear.reference` | reference | Mirror across a plane, or the aligned Deviation reference |
| `wear.diff` | nothing | Material lost and added per worn region |
| `wear.rebuild` | nothing | The repaired part as an STL, with the wear before and after |
| `wear.prewarp` | runs | The pre-warped target as an STL, the print's RMS, and whether to stop |

The agent guide is `guide.read { topic: "wear-repair" }`.

## Layout

| Path | What |
|---|---|
| `core/geometry.ts` | Nearest points (three-mesh-bvh), regions, mirroring, normals |
| `core/repair.ts` | The diff and the snap repair |
| `core/prewarp.ts` | The smoothed inverse error field, and the stop rule |
| `app/useWearPlugin.tsx` | The workspace: its panel, and a click placing a region |
| `ui/WearPanel.tsx` | The panel; every control runs a `wear.*` command |
| `ui/panelModel.ts` | The region form as wear.tag takes it, and the panel's words |
| `tests/` | A block worn on one side, a print 1 % long, and the panel's sums |
| `scripts/e2e-agent-wear.mjs` | Repair and two pre-warp runs through scanruler-mcp |
