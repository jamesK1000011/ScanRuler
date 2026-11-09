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
- **The tolerance's floor.** `wear.diff` reads the scan's own scatter
  off the worn regions and, where the build has Scanner noise, the scan
  noise to plan with (`scanNoise`: the larger of the scanner's usual noise
  and this scan's, read through `plugins/_shared/scanNoise.ts`). The least
  tolerance the scan supports is twice the scatter or three times the
  noise, the larger (`floor`); a tolerance under it is warned about, in the
  answer's `note` and the panel. A scan that matches its mirror cleanly
  does not make the scanner finer than it is.
- **Pre-warp** moves the target back along its normals by the error the
  print shows, smoothed. Each run is recorded, and a stop rule says when
  another isn't worth it.

## The workspace

**Wear repair** is the Analyze tab's **Wear** page (workspace id `wear`),
after Strength and Mass: what use and making do to a part's material. Its
panel runs the commands below, the same ones an agent calls: what the
part should be (mirror, with Align on symmetry, or the part aligned in
Surface Deviation), the regions (a ball or a box, its centre picked on the
part), the settings, Read wear and Repair STL, and the pre-warp runs with
the stop rule's verdict.

It was a tab of its own in the Model group, after Mesh Tools; projects
saved there, and an agent's `workspace.set { workspace: "wear" }`, open
on the page (the host is `ANALYZE` in `plugins/_shared/workspaces.ts`).

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
| `core/repair.ts` | The diff, the snap repair, and the tolerance's floor |
| `core/prewarp.ts` | The smoothed inverse error field, and the stop rule |
| `app/useWearPlugin.tsx` | The workspace: its panel, and a click placing a region |
| `ui/WearPanel.tsx` | The panel; every control runs a `wear.*` command |
| `ui/panelModel.ts` | The region form as wear.tag takes it, and the panel's words |
| `tests/` | A block worn on one side, a print 1 % long, and the panel's sums |
| `scripts/e2e-agent-wear.mjs` | Repair and two pre-warp runs through scanruler-mcp |
