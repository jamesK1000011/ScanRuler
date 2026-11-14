<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Bake-off: ScanRuler and FreeCAD's Agent Link, the same brief

One Gridfinity brief (`brief.mjs`) goes to two servers. The first is the
Agent Link add-on for FreeCAD, which lives in the FreeCAD fork
(jamesK1000011/FreeCAD-AgentLink, its own repository since 14 Nov 2026) and runs
headless. The second is ScanRuler, paired with the app in headless Chrome.
Every call is measured the same way (`measure.mjs`). ScanRuler's Deviation
workspace then compares the two bins both ways, and `score.mjs` writes the
scorecard.

`.github/workflows/freecad-bakeoff.yml` runs it all on GitHub's machines on
each push to `freecad-spike`.
