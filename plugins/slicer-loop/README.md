<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Slicing

On screen: step 2, **Slice**, of the **Print** tab (Check → Slice → Send),
workspace id `slice`. Slicing itself is the agent's server's; the page shows
what the project adds to a slice — Hardware's pauses (`hw.pauses`) and the
slicer changes from a scanned print (`fit.suggest`) — each where its plugin
is in the build.

Slices from ScanRuler with the slicers on this computer: OrcaSlicer, Bambu
Studio and PrusaSlicer, each driven from its own command line. The work is
the MCP server's, because a page can't start a program:

- `mcp/src/extras/slicer.js` holds the adapters, `slicers.json` and the job
  folders.
- `gcode.js` is the G-code reader.
- `zip.js` reads the G-code inside a `.3mf`, and writes one back.
- `pauses.js` puts pauses for parts dropped in mid-print into the G-code.

Its tools are listed when `SCANRULER_MCP_EXTRAS` names `slicer`. This plugin
carries the guide an agent reads first, `guide.read { id: "slicer-loop" }`.

## Tools

| Tool | What |
|---|---|
| `slicer_detect` | Finds the installed slicers, checks their `--help`, and with `save` writes `slicers.json` |
| `slicer_list` | The slicers set up |
| `slicer_profiles` | A slicer's machine, process and filament profiles (or printer, print and filament) |
| `slicer_slice` | Slices a model with profiles and overrides into a job folder, and reads the G-code back; `pauses` puts in a pause per part dropped in |
| `slicer_jobs` / `slicer_result` | The jobs run, and one in full |
| `slicer_compare` | Two jobs side by side |

A flag the installed slicer's `--help` doesn't list is refused by name.
Nothing is sent to a printer.

## Pauses

`slicer_slice { pauses: [{ z, note }], pauseCommand? }` takes each `z` as a
pocket's top above the bed (the Hardware workspace's `hw.pauses` gives the
list). After the slicer has run:

- The layers are read from the G-code's own markers: `;LAYER_CHANGE` and
  `;Z:` from PrusaSlicer and OrcaSlicer, `; CHANGE_LAYER` and `; Z_HEIGHT:`
  from Bambu Studio. So the first layer's height and any variable layer
  height are as printed.
- Each pause goes before the first layer whose bottom (the Z of the layer
  under it; the bed for the first) is within 2 µm of its `z` or above it.
  Pauses on one layer are merged. It goes after the layer's first move up,
  when that comes before the layer's first extrusion (filament drawn back,
  nozzle lifted); otherwise after the marker.
- The command is the profile's own pause G-code where the G-code's settings
  give one (`pause_print_gcode`, `machine_pause_gcode`), without
  placeholders. Otherwise it goes by the printer: `M601` for Prusa and
  Marlin (`M600` on request), `PAUSE` for Klipper, `M400 U1` for a Bambu Lab
  printer. Before it, `M117` puts the note on the screen, except on a Bambu
  printer, which shows none. A `; ScanRuler pause:` comment marks each one.
- An exported `.3mf` gets every plate's G-code done the same way, and its
  `plate_N.gcode.md5` is written again.
- Refused: no layer markers, Z going back down (printed object by object),
  binary G-code, a printer it can't tell (give `pauseCommand`), a height
  above the last layer, and G-code already paused.

The slicers' own per-layer pause is set in their apps (a 3MF's
custom G-code per layer). Their command lines have no flag for it, and none
was available here to check what a 3MF's per-layer entries do when sliced
from the command line. So the pause goes into the G-code after slicing, and
the answer says so (`pauses.how`).

## Tests

- `mcp/tests/slicer.test.js` runs the adapters against stand-in slicers
  (`mcp/tests/fakeSlicers.js`).
- `mcp/tests/pauses.test.js` puts pauses into G-code laid out as PrusaSlicer,
  OrcaSlicer (Klipper) and Bambu Studio write it (`mcp/tests/gcodeSamples.js`),
  into a `.3mf` with its MD5, and through `slice` with the stand-in slicers.
- `scripts/e2e-agent-slicer.mjs` drives the whole loop through scanruler-mcp
  and the page: export, slice, override, compare.
