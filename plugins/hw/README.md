<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Hardware

Holes in a printed part for the hardware it takes, cut into Reverse Engineer
bodies as named sketch and extrude-cut features that stay editable there:

- screw clearances (ISO 273 fine, medium, coarse) with a counterbore for a
  socket cap (ISO 4762) or button head (ISO 7380), or a 90° countersink
  (ISO 10642);
- hex nut traps (ISO 4032), open at the surface or buried, with a side slot;
- heat-set inserts, pilots for thread-forming screws, disc magnets, and
  bearing seats (623–608, 6800–6806) with a relief behind — typical figures,
  adjustable;
- bolt circles, rectangles and grids of any of them.

Every diameter gets a printing allowance (0.2 mm by default; by kind). Level
holes are teardropped point up, and an upright stepped hole can keep a
sacrificial bridge layer. `hw.check` reads a round hole on a body and says
what it fits, and how loose or tight.

The figures were taken from the standards' published tables, and the
geometry is ScanRuler's own; no CAD package's code is used.

## Commands

| Command | What it does |
|---|---|
| `hw.list` | The table, and the settings |
| `hw.set` | Allowances, clearance class, head margin and sink, teardrop, bridge layer, insert and magnet extra; `reset` |
| `hw.plan` | The hole placed on a body — every step, depth and the features — changing nothing |
| `hw.pattern` | The same for a bolt circle, rectangle or grid |
| `hw.apply` | Cut the plan (or a hole given) into the body: one undo step, all or none |
| `hw.check` | What a round hole on a body, or a diameter, fits |
| `hw.clear` | Put the plan and the check away |

The settings are saved with the project and are part of the undo history. The
cuts are Reverse Engineer features, saved and undone there.

`hw.apply` makes its change through `reverse.feature.add` with `runWithin`
(`src/commands/registry.ts`). It runs another workspace's change inside the
one running, in its undo step, where `runCommand` would queue it behind its
caller.

## Tests

`tests/hw.test.ts` checks:

- the table against the standards' figures;
- each kind's steps: diameters with the allowance, depths, the counterbore,
  countersink cone and nut pocket, and the refusals;
- teardrops tangent to their circle, and the hex slot's outline;
- extents both ways along the plane's normal, and through;
- the feature list's order and names;
- pattern offsets and overlap;
- fit checks;
- the project section's reading of a saved file;
- the tool solids' volumes in OCCT against their closed forms.
