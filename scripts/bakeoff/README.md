<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Bake-off: ScanRuler and FreeCAD's Agent Link, the same brief

**The pins moved (16 Nov 2026).** The add-on pins the Claude extension
installs live in jamesK1000011/AgentLink-FreeCAD, `packaging/pins/<name>-ref`,
with the list in `packaging/addons.json`, the launcher in
`packaging/mcpb/server/index.js`, and the bake-off that gates them in its
`.github/workflows/bakeoff.yml`. The `*-ref` files here and
`scripts/freecad/addons.json` are the old update channel: kept equal to
AgentLink-FreeCAD's until every installed extension has hopped to the new
one (its launcher, copied to `scripts/freecad/mcpb/server/index.js`, does
that at its next update), then retired. `safetynet-ref` is used only by
this repository's manual bake-off. The workflow here is manual only.

One Gridfinity brief (`brief.mjs`) goes to two servers. The first is the
Agent Link add-on for FreeCAD, which lives in the FreeCAD fork
(jamesK1000011/AgentLink-FreeCAD, its own repository since 14 Nov 2026) and runs
headless. The second is ScanRuler, paired with the app in headless Chrome.
Every call is measured the same way (`measure.mjs`). ScanRuler's Deviation
workspace then compares the two bins both ways, and `score.mjs` writes the
scorecard.

`.github/workflows/freecad-bakeoff.yml` runs it all on GitHub's machines when
asked (Run workflow); AgentLink-FreeCAD's bake-off runs the FreeCAD side of
the brief on every pin bump.
