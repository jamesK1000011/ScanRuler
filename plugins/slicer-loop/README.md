<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Slicing

Slices from ScanRuler with the slicers on this computer: OrcaSlicer, Bambu
Studio and PrusaSlicer, each driven from its own command line. The work is
the MCP server's, because a page can't start a program:

- `mcp/src/extras/slicer.js` holds the adapters, `slicers.json` and the job
  folders.
- `gcode.js` is the G-code reader.
- `zip.js` reads the G-code inside a `.3mf`.

Its tools are listed when `SCANRULER_MCP_EXTRAS` names `slicer`. This plugin
carries the guide an agent reads first, `guide.read { id: "slicer-loop" }`.

## Tools

| Tool | What |
|---|---|
| `slicer_detect` | Finds the installed slicers, checks their `--help`, and with `save` writes `slicers.json` |
| `slicer_list` | The slicers set up |
| `slicer_profiles` | A slicer's machine, process and filament profiles (or printer, print and filament) |
| `slicer_slice` | Slices a model with profiles and overrides into a job folder, and reads the G-code back |
| `slicer_jobs` / `slicer_result` | The jobs run, and one in full |
| `slicer_compare` | Two jobs side by side |

A flag the installed slicer's `--help` doesn't list is refused by name.
Nothing is sent to a printer.

## Tests

- `mcp/tests/slicer.test.js` runs the adapters against stand-in slicers
  (`mcp/tests/fakeSlicers.js`).
- `scripts/e2e-agent-slicer.mjs` drives the whole loop through scanruler-mcp
  and the page: export, slice, override, compare.
