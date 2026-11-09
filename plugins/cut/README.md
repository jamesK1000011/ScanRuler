<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Sheet cutting

Parts cut from sheet — laser, waterjet, plasma, or a CNC router cutting
through. It brings the **cut setup** (plugins/setups) and its page on the
**Make** tab, **Cut** (workspace id `cut`): a cut setup's parts checked as
sheet parts, and their outlines out as one DXF or SVG to cut from. What a
part is made of is the part's own (plugins/material); the rules read its
category.

The body is read through Reverse Engineer's commands, run by name: its
faces (`reverse.body.describe`) say whether it is a sheet part — two
parallel flat sides facing apart, every other face square to them — and
how thick; the kernel's own section through the middle of the sheet
(`reverse.body.section`, an `oriented` plane) is its profile, lines, arcs
and circles exact. The 2D reading (core/) needs no kernel.

## The cut setup

`registerSetupType(CUT_SETUP)` (app/cutSchemas.ts). Settings, each
optional: `machine` (laser, waterjet, plasma, router; laser unset),
`thickness` (the sheet's; the part's unset), `kerf` (a router's cutter
diameter), `minFeature`, `sheet` ([width, height]), `compensate` (the
file's path half a kerf off the part). A figure unset comes from
core/rules.ts by machine, material category and thickness — shop rules of
thumb, said as such (`cut.rules`). `part.review` runs `cut.check` on a part
in a cut setup. The machine's tolerance for Fits is `{ kind: 'kerf', kerf,
compensated, tolerance }`: Fits models holes and outlines a kerf the other
way when the path is not compensated.

## Commands (`cut.*`)

| Command | Changes | What |
|---|---|---|
| `cut.check` | nothing | A body judged as a sheet part: faces a straight cut does not make, thickness against the sheet's, webs and slots against the least feature and the kerf, round holes against the least feature and the thickness, a router's inside corners against its cutter, fitting the sheet; the material against the machine |
| `cut.export` | nothing | One DXF or SVG of the parts' profiles laid out in rows over sheets (copies by count), drawn edges or kerf-compensated |
| `cut.rules` | nothing | The figures a cut goes by where unset, and why |

All run headless. The agent guide is `guide.read { topic: "cut" }`.

## What is approximate

- Narrow webs and slots are read by rays square off the edges, met only by
  an edge facing back, sampled about a third of the least feature apart:
  a narrow place shorter than that can be missed.
- A curve that is no line or arc (a spline profile) is read by its samples;
  its bends are not judged as inside corners.
- Free-form edge faces count as square to the sides when their middle is.
- Kerf compensation offsets a sampled outline (corners rounded outside,
  mitred inside); circles stay circles. Fine while the kerf is small
  against the features — a slot narrower than the kerf closes up.
- Layout is row packing by boxes, tallest first, not true nesting.

## Files

- `core/flat.ts` — a sheet part read from its faces
- `core/profile.ts` — the profile: loops, narrow places, inside corners, holes, fitting a sheet, kerf offset, row packing
- `core/check.ts` — the findings
- `core/rules.ts` — the figures by machine and material
- `core/drawing.ts` — the layout as the app's DXF and SVG writers take it (src/core/flat/dxf.ts, svg.ts)
- `app/cutSchemas.ts` — the setup type; `app/cutCommands.ts` — the commands
- `ui/` — the setup's settings and the Cut page
