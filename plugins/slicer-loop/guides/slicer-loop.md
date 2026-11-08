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

## Pauses for parts dropped in

When the part has encased pockets (the Hardware workspace's `hw.embed`, or
Mass's ballast), call `hw_pauses` (the page's `hw.pauses`) with the
profile's `layerHeight` and `firstLayer`. If the bodies go out as one STL,
give `together`. Then slice with `slicer_slice { …, pauses }`, using the
answer's `slicer.pauses` as is.

- The answer's `pauses` lists each one: `layer` (pause before it, from 1),
  `z` (the height it pauses at) and `printZ` (that layer's Z in the
  slicer's preview). It also gives the G-code put in, `command.from` (where
  the pause command came from), and `warnings`.
- Check the layers match `hw.pauses`. If they don't, the profile's layer
  heights differ from what you gave. Ask, then do both again.
- A warning that a top falls inside a layer means that layer may print
  closed over the pocket. Plan the pocket again at the profile's layers.
- `pauseCommand` is needed when the G-code doesn't say which printer it is
  for: `M601` (Prusa; Marlin with park on pause), `M600` (Marlin filament
  change), `PAUSE` (Klipper), `M400 U1` (Bambu Lab).
- Tell the person what to have ready, and what goes in at each layer.

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
- Pauses go into the G-code after slicing, not through the slicer's own
  per-layer pause. Say so if asked.
- Nothing is sent to a printer. That is printer-handoff's job, and a person
  presses Start.
- Each job keeps its inputs, command line and log in its folder. When a
  slice fails, point the person to `slicer.log` there.
