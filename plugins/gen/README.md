<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Generate

Parametric parts made to a standard, built as solids with OCCT in a worker
and brought into Reverse Engineer as bodies to finish, check and export.

- **Gridfinity bin.** Width and depth in 42 mm cells, height in 7 mm units.
  Options: the stacking lip (on a 45° support, so it prints without one), 6 × 2 mm magnet holes and M3 screw holes
  under each cell, wall and floor thickness, dividers across and deep, and
  a label ledge with a 45° underside that prints without support. With
  `wall: 0` the bin is a solid block, for cutting your own pocket.
- **Gridfinity baseplate.** A grid of pockets, open underneath, or on a
  3 mm floor with magnet holes.
- **Project box.** A rounded box and a lid whose lip drops inside at a set
  clearance, with optional M3 corner bosses. The lid is laid out beside the
  box, top down, so it prints flat.
- **Board enclosure** (`board_box`). A box round a circuit board, made in the
  board's own frame (its bottom face at z = 0) so it stands round it.
  Standoffs go under the mounting holes, with heat-set insert holes or
  self-tapping pilots; the screw size comes from the hole (M2 to M4; figures
  copied from the hardware plugin's table). There is room above and below
  the parts, an opening in the wall for each connector at the edge, and a
  lid on a lip. It takes a board besides its values (`board`: outline,
  thickness, the parts' reach, holes, openings). The Boards workspace makes
  one from a KiCad board.

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

`gen.set`, `gen.make`, `gen.measure` and `gen.export` take `board` for
`board_box`; the board set last is used when none is given, and
`gen.measure` gives the standoffs and openings planned.

Every panel control runs one of these. An agent gets the same tools
(`gen_list`, `gen_make` and so on).

## Saved with the project

The generator picked, the values that differ from the defaults, and the
board set for `board_box`. The
parts made are Reverse Engineer's Import features, saved with it. Values
an older or newer version does not take are dropped when the project
opens.

## Tests

`tests/gen.test.ts` builds every generator with OCCT. It checks the sizes
against the specification (a 1×1×3 bin is 41.5 × 41.5 × 25.4 mm, a
baseplate 4.65 mm tall), the base's profile and the magnet holes (6.5 ×
2.4 mm at ±13 mm), that the lip stands on a support, that a bin stacks in
another's lip and its feet drop into a baseplate pocket without touching,
that a lid turned over sits on its box without touching inside, that
corner bosses stay inside however round the corners, that bad values are
refused, and that a saved setup reads back whatever order its values come
in.

`tests/boardBox.test.ts` builds the board enclosure. It checks that the
standoffs stand under the holes with the insert's or the pilot's hole, that
the board clears the walls and floor (square inside corners when there is
no gap), that the openings sit at the connectors with wall beside and above,
that a round opening works, that the lid turned over sits on the rim without
touching, and that a standoff too short for the parts underneath is refused.

`tests/genCommands.test.ts` runs the commands against a faked Reverse
Engineer and worker: builds one at a time, a stop that ends those waiting
too, bodies named after the part that stands where they do, and names that
don't collide.
