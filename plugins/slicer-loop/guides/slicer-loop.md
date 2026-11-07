<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Slicing with OrcaSlicer, Bambu Studio or PrusaSlicer

The `slicer_*` tools run the slicers installed on this computer from their
own command lines. They are listed when the MCP server is started with
`SCANRULER_MCP_EXTRAS` naming `slicer`. If `slicer_slice` isn't among your
tools, say so: the person adds `"SCANRULER_MCP_EXTRAS": "slicer"` to the
server's `env` in their client config.

## Workflow

1. **Set up once.** `slicer_detect { save: true }` finds OrcaSlicer, Bambu
   Studio and PrusaSlicer where they install, checks their `--help`, and
   writes `slicers.json`. Ask the person which profiles they print with, and
   name them as defaults in `slicers.json` (`slicer_list` shows the file).
2. **Export the part.** `export_stl { path }`, or `texture_export`, or
   `fit_compensated_mesh`, depending on what you're slicing.
3. **Slice.** Use `slicer_slice { model, slicer?, machine?, process?,
   filament?, overrides? }`. Profiles are names from `slicer_profiles`, or
   paths. Overrides are settings by key. fit-comp's `fit_suggest` changes go
   in as `{ key: to }`.
4. **Read it.** The answer has three parts: `totals` (the slicer's own time,
   filament and layers), `counted` (layers, heights, filament by feature,
   travel, retractions) and `heuristic`. `heuristic` is an estimate; say so
   when you quote it.
5. **Compare.** `slicer_compare { a, b }` puts two jobs side by side, to
   check what a changed setting did to time and filament.

## Profiles

- **OrcaSlicer and Bambu Studio** profiles are JSON: machine, process and
  filament. The person's own saved presets are in the slicer's `user`
  folder. A preset that only inherits from the slicer's built-in bundle may
  need exporting in full from the slicer before the command line takes it.
  If the slicer's log says a setting is missing, that is why.
- **PrusaSlicer** profiles are INI files: printer, print and filament.
  Overrides go to it as `--key value` flags.

## Limits

- A slice is checked against the slicer's `--help`. A flag it doesn't list
  is refused by name. Report it; don't work around it.
- Nothing is sent to a printer. That is printer-handoff's job, and a person
  presses Start.
- Each job keeps its inputs, command line and log in its folder. When a
  slice fails, point the person to `slicer.log` there.
