<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# CNC milling

Parts machined on a CNC mill — basic, no toolpaths. It brings the **mill
setup** (plugins/setups) and its page on the **Make** tab, **Mill**
(workspace id `mill`): a mill setup's parts checked for machining, and
handed over as STEP with a setup sheet. What a part is made of is the
part's own (plugins/material).

The body is read through Reverse Engineer's commands, run by name: its
faces and edges (`reverse.body.describe`) and each face's triangles
(`reverse.body.face_triangles`); the file is `reverse.export.step`; the wall
is `dfm.wall` where the build has it. The reading (core/) needs no kernel.

## The mill setup

`registerSetupType(MILL_SETUP)` (app/millSchemas.ts). Settings, each
optional (defaults in core/defaults.ts): `axes` ("3" or "3+2"; 3),
`directions` (tool directions, "+z" … or [x, y, z]; ["+z"]), `margin`
(stock round the part's box; 2), `stock` ([x, y, z], over the margin),
`minTool` (3), `reach` (30), `grade` (IT grade, 5–14; 8), `note`.
`part.review` runs `mill.check` on a part in a mill setup. The machine's
tolerance for Fits is `{ kind: 'it', grade }`: Fits models a pair as
drawn, each size within the grade's zone at it.

## Commands (`mill.*`)

| Command | Changes | What |
|---|---|---|
| `mill.check` | nothing | Undercuts (faces no tool direction reaches), square inside corners and inside rounds under the least tool, small and deep holes, narrow and deep floors, faces past the reach, the stock, the wall against the material |
| `mill.export` | nothing | A zip: the parts as STEP, and the setup sheet as setup.json and setup.md |

Both run headless. The agent guide is `guide.read { topic: "mill" }`.

## What is approximate

- Reach is read off each face's triangles: a face counts as reached from a
  direction when under 2 % of its area faces away and most of up to five
  samples on it see out along the direction. A face half under an
  overhang may count either way.
- Floors' widths are the narrowest of their boxes turned in 5° steps: a
  floor of an odd shape reads wider than its narrowest neck. Depth to
  width is judged for every floor below the top, an open ledge too.
- Inside corners are read where two flat faces meet along a tool
  direction, and at round faces standing along one; corners at an angle
  to the tool are not judged.
- No toolpaths, tool libraries, feeds or fixtures: the setup sheet gives
  the material's cutting data where the library has it.

## Files

- `core/reach.ts` — the reading and the findings, the stock
- `core/sheet.ts` — the setup sheet
- `core/defaults.ts` — the figures where unset
- `app/millSchemas.ts` — the setup type; `app/millCommands.ts` — the commands
- `ui/` — the setup's settings and the Mill page
