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
- bolt circles, rectangles and grids of any of them;
- parts encased in the print — nuts, magnets, bearings, inserts, or a box or
  cylinder of your own (a weight, a tag) — in a pocket closed under a roof,
  with the layer the print pauses at to drop each one in.

Every diameter gets a printing allowance (0.2 mm by default; by kind),
moved by the printer's fit calibration from Fits where there is one
(`printerFit`, plugins/_shared/printerFit.ts) — for a body in a print
setup that keeps a calibration of its own (plugins/setups), that one. Level
holes are teardropped point up, and an upright stepped hole can keep a
sacrificial bridge layer. `hw.check` reads a round hole on a body and says
what it fits, and how loose or tight.

## The panel

Hardware is the Fits tab's second page (workspace id `hw`), between Design
and Calibrate from a scan, whose calibration sizes its holes. Its panel runs
the commands below:

- **Kind** and **Size** (with the head, clearance class, through or a
  depth, a nut's sunk depth and side slot, a bearing's relief, as the kind
  takes); **Encase** closes it under a roof (roof layers, what goes in, for
  the printer's screen), or encases a box or cylinder of your own.
- **Where** — the body, the flat face by its index, and a pattern (one
  hole, bolt circle, rectangle, grid) with its counts and steps.
- **Plan** shows every step and the features without cutting; **Cut** cuts
  them (`hw.apply`). A plan made before a setting changed is planned again.
- **Settings** — *Printer fits*, each kind's allowance (shown as sized by
  the calibration), the default clearance, head margin and sink, bridge
  layer, insert and magnet extra, teardrop; *Defaults*.
- **Check a hole** — a round face by its index: what it fits.
- **Pauses** — layer height and first layer, *List pauses*, *From Mass*
  (the ballast pocket planned there), and each encased part, its × taking
  it off the list.

The figures were taken from the standards' published tables, and the
geometry is ScanRuler's own; no CAD package's code is used.

## Commands

| Command | What it does |
|---|---|
| `hw.list` | The table, and the settings |
| `hw.set` | Allowances, printer fit on or off, clearance class, head margin and sink, teardrop, bridge layer, insert and magnet extra; `reset` |
| `hw.plan` | The hole placed on a body — every step, depth and the features — changing nothing |
| `hw.pattern` | The same for a bolt circle, rectangle or grid |
| `hw.apply` | Cut the plan (or a hole given) into the body: one undo step, all or none |
| `hw.check` | What a round hole on a body, or a diameter, fits |
| `hw.clear` | Put the plan and the check away |
| `hw.embed` | An encased pocket planned: sunk under its roof, its top on a layer boundary, its pause |
| `hw.record` | A pocket cut another way (or Mass's ballast, or Generate's Gridfinity magnets) recorded for its pause, with what goes in (`kind` and `size`, or `grams`) for its mass |
| `hw.pauses` | The pause layers, merged per layer, and `slicer_slice`'s `pauses` |
| `hw.masses` | The encased parts as solids — mass, centres, inertia — for Mass and Strength |
| `hw.unembed` | Forget an encased part (its cut stays) |

An encased nut, magnet, bearing or insert carries its own mass, from the
table's size and its usual material (NdFeB 7.5, steel 7.85, brass 8.5
g/cm³; a bearing at 65 % of its steel ring), resting at the pocket's low
end; `grams` gives what one weighs instead, and is needed for an object.
`mass.properties` adds them to the part, and `fea.solve` to its own weight.

The settings and the encased parts are saved with the project and are part
of the undo history.

The pause goes before the first layer whose bottom is at or above the
pocket's top. Layer n runs from `firstLayer + (n − 2) × layerHeight` (0 for
the first) to `firstLayer + (n − 1) × layerHeight`, above the bed. A
pocket's top above the bed is its Z less its body's lowest point (the
slicer sets an object's lowest point on the bed), or the lowest of the
bodies exported together. For bodies in print setups that agree on them,
`layerHeight` and `firstLayer` are the setups' (the answer's `layers.from`
says so); the layers given to `hw.pauses` still win. The
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

`tests/embed.test.ts` checks the pause layer, with a first layer of its own
height, a top on a boundary, a hair either side and between two, floating
steps that don't add up, and several parts on one layer and two bodies. It
also checks each kind's encased pocket, an outline's reach and the project
file. `tests/embedCommands.test.ts` runs `hw.embed`, `hw.apply`,
`hw.record`, `hw.pauses` and `hw.unembed` against a stand-in Reverse
Engineer.
