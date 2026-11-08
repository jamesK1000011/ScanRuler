<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Generate

Parametric parts made to a standard, built as solids with OCCT in a worker
and brought into Reverse Engineer as bodies to finish, check and export.

- **Gridfinity bin.** Width and depth in 42 mm cells, height in 7 mm units.
  Options: the stacking lip, 6 × 2 mm magnet holes and M3 screw holes
  under each cell, wall and floor thickness, dividers across and deep, and
  a label ledge with a 45° underside that prints without support. With
  `wall: 0` the bin is a solid block, for cutting your own pocket.
- **Gridfinity baseplate.** A grid of pockets, open underneath, or on a
  3 mm floor with magnet holes.
- **Project box.** A rounded box and a lid whose lip drops inside at a set
  clearance, with optional M3 corner bosses. The lid is laid out beside the
  box, top down, so it prints flat.

The dimensions are Gridfinity's published ones (Zack Freedman's open
system), written here from the specification. No other generator's code is
used.

## Commands

| Command | What it does |
| --- | --- |
| `gen.list` | The generators, their parameters (key, kind, range, unit), defaults and the values set |
| `gen.set` | Picks the panel's generator and sets its values, checked; `reset` restores the defaults |
| `gen.measure` | Builds without making anything: each part's size and volume |
| `gen.make` | Brings the part into Reverse Engineer as named bodies (an Import feature) |
| `gen.export` | The part as a STEP or STL file, outside the project |
| `gen.stop` | Stops a build |

Every panel control runs one of these. An agent gets the same tools
(`gen_list`, `gen_make` and so on).

## Saved with the project

The generator picked and the values that differ from the defaults. The
parts made are Reverse Engineer's Import features, saved with it. Values
an older or newer version does not take are dropped when the project
opens.

## Tests

`tests/gen.test.ts` builds every generator with OCCT. It checks the sizes
against the specification (a 1×1×3 bin is 41.5 × 41.5 × 25.4 mm, a
baseplate 4.65 mm tall), that a bin's feet drop into a baseplate pocket
without touching it, that a lid turned over sits on its box without
touching inside, and that bad values are refused.
