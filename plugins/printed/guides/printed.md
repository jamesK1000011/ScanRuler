<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Printed circuits

Electronics › Printed wiring (`printed.*`) makes circuits inside a printed
part, in a Reverse Engineer body. There are two methods:

- **trace** (the default). Each net is a run of conductive filament. The runs
  form a body of their own, "Traces", which is cut out of the part so the
  two never overlap. Print the part in its usual filament and the traces in
  the conductive one.
- **channel**. Each net is a groove or tunnel cut in the part for copper:
  wire (by AWG or diameter), copper tape, or conductive paint. A groove is
  open at the surface (`depth: 0`). A tunnel is closed under a roof
  (`depth` > 0), and the wire is laid at a pause or threaded through after.

## Conductors

`printed.list` gives the filaments and the AWG table. The filament figures
are typical, from the makers:

- **Protopasta conductive PLA**: 30 Ω·cm along the layers, 115 Ω·cm through
  them. That makes 15 kΩ for a 100 × 2 × 1 mm trace. It suits signals,
  touch pads and an LED at a few mA, not power. Use it below 50 °C.
- **Electrifi**: 0.006 Ω·cm, which makes 3 Ω for the same trace. It prints
  at 130–160 °C and softens at low temperature, so keep the current and the
  heat low.
- **custom**: `printed.set { material: "custom", along, through }`.

A printed trace often measures higher than these figures, where its layers
bond poorly. If the user has measured a test bar, use their figures.

Copper wire: the diameter comes from the gauge, and the resistance from
copper's resistivity (`copper`, 1.68e-8 Ω·m). AWG 22 is 0.0516 Ω/m at that
figure; tables that give 0.0530 use annealed copper at 1.724e-8.

## Settings

`printed.set` sets: `material`; `nozzle` (0.4) and `layerHeight` (0.2);
`clearance` (1 mm, conductor edge to edge); a trace's `width` (2),
`thickness` (0.6) and `depth` (0, flush); `current` (0.01 A) and
`heatWarn` (1 W per metre), which the checks use; `copper`;
`wireClearance` (0.3); `tapeClearance` (0.2); and `roofLayers` (3).

## Plan, then make

1. Find the face. `reverse.body.describe { body, where: { kind: "plane" } }`
   lists the flat faces. The runs are drawn on the face's sheet in [u, v]
   mm; the answer's `frame` says which way u and v run. Or give
   `on: { plane: "XY" }` (or a plane object) and, if needed, `into: 1`.
2. Write the nets:
   ```json
   { "body": "Box", "on": { "face": 4 }, "depth": 0.6, "thickness": 0.6,
     "nets": [ { "name": "LED+", "width": 2,
                 "points": [[-15, 0], [0, 0], [10, 10]],
                 "pads": [ { "at": [-15, 0], "hole": 1.1 },
                           { "at": [10, 10], "shape": "square", "size": 3 } ] } ] }
   ```
   - `points` lie on the sheet. 3D points are taken onto it, and `{ x, y }`
     objects (Circuit JSON route points) are read as [u, v].
   - `path` is a 3D route in the part's frame instead. Its bends are
     rounded, and its first or last straight has to lie square to X, Y or Z.
   - A pad is a column of conductor from the run up to the surface, for a
     wire, pin or contact; `hole` makes a hole for a pin. In a channel, a
     pad is the wire's way out.
   - A via is a column from the run's middle to another depth (`to`; 0 is
     the surface).
3. `printed.plan` changes nothing. For each net it returns the length, the
   cross-section and the resistance end to end (the run and a pad column at
   each end; along or through the layers by direction). It also returns the
   drop and the power at the current, the current that stays under the heat
   warning, the warnings, and the features. Read the resistances and the
   warnings back to the user.
4. `printed.apply` (no input) makes what was planned, as one undo step. If
   any feature fails, none is kept. The traces body is named after the plan.
5. `printed.export` gives a zip with the part's STL, the traces' STL and
   `filaments.txt`. The app's 3MF can't say which filament an object takes,
   so the files are separate. Load them into the slicer together as one
   object of several parts, so they keep their places, then set the
   filaments.
6. `printed.clear` puts away the plan and check. `printed.forget { id }`
   (or `{ all: true }`) takes a circuit off the export list; its features
   stay in Reverse Engineer.

## Routing

`printed.route` takes the same input. A net given as two `pads` and no
`points` is routed on a grid (`grid`, 0.5 mm). Its runs go along the
sheet's axes and at 45°, a clearance away from `keepouts` (`{ rect: [u0,
v0, u1, v1] }` or `{ circle: [u, v, r] }`), from other nets' pads, and from
runs already there. Nets are routed one at a time, in order; reorder them
if one fails. A net that can't get through is listed in `failed` with the
reason, and the rest are planned. There is no rip-up and nothing beyond two
points; route a three-pad net as two nets. Each run is checked as it will be
drawn, mitred corners included, and routed again with more room where a
corner or an end comes short; the clearance check in the plan measures the
same outlines.

## Channels and the pause

A tunnel laid at a pause has to run level: on a face that faces up or down,
or a level `path`. The print pauses at its top. `printed.apply` records it
with the Hardware workspace (`hw.record`), so `hw.pauses` gives the layer
and `slicer_slice { pauses }` stops there. A level `path` laid at a pause
is swept square, not round, so it is open as wide as the wire up to its flat
top when the print stops. For a tunnel that climbs, use
`lay: "thread"` to pull the wire through after printing, with pads at both
ends as the way in and out. Paint goes into an open groove only.

## Checks

`printed.check { current }` measures the plan again at a current.
`printed.resistance` works out a single run: `{ conductor: "protopasta",
length, width, thickness, climb }`, or `{ conductor: { kind: "wire", awg:
22 }, length }`.

The warnings cover:

- a width under two lines, or a thickness under two layers (refused under
  one);
- a thickness that isn't a whole number of layers;
- thin cover over a buried trace;
- nets closer than the clearance;
- a clearance under two lines (conductive filament oozes);
- power per metre past `heatWarn` (half that for a filament with no
  published use temperature).

## Tying in

A tscircuit Circuit JSON `pcb_trace` maps onto a net: its `route` points of
`route_type: "wire"` become `points` (`{ x, y, width }` are read as they
are), and its `route_type: "via"` points become `vias`. Use the board's
outline as `bounds` and its keep-outs as `keepouts`.
