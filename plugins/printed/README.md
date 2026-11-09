<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Printed circuits

On screen: the **Electronics** tab's **Printed wiring** page (workspace id
`printed`).

Circuits made inside a 3D-printed part, in a Reverse Engineer body, as
named features that stay editable there. There are two methods.

**Conductive traces (multi-material).** Each net is a run of conductive
filament: a mitred outline on a face or plane of the part, extruded between
two depths (flush, buried, or standing proud). It can also be a 3D route
swept along its rounded bends. The runs make a body of their own, named
after the plan ("Traces"), which a Combine cut that keeps the tool takes
out of the part, so the part and the traces never overlap. Pads are columns
of conductor up to the surface, for a wire, a pin (with a hole) or a
square SMD-style contact. Vias are columns to another depth.
`printed.export` gives the part and its traces as named STLs, with the
filament each takes.

**Channels for copper.** Each net is cut into the part as a groove open at
the surface, or as a tunnel under a roof. It is sized for a wire (by AWG or
diameter, over its insulation if given), copper tape, or conductive paint.
A level tunnel is laid at a pause: `printed.apply` records the channel's top
with the Hardware workspace (`hw.record`), so `hw.pauses` and
`slicer_slice { pauses }` stop the print there. A tunnel that climbs is
threaded through after printing.

Every net is measured: its length, cross-section and resistance end to
end. Resistance counts the run and a pad's column at each end, with a
filament's resistivity taken along or through the layers by the run's
direction (ρ = ρ_along·(1 − d_z²) + ρ_through·d_z², the resistivity tensor
projected on the run). It also gives the drop and power at a current, the
power per metre against a heat warning, and the current that stays under
it. The checks cover width and thickness for the nozzle and layers, cover
over a buried trace, a channel's roof, and clearance between nets.

The figures were taken from the makers' pages (below). The geometry and
the router are ScanRuler's own; no CAD or EDA package's code is used.

## Commands

| Command | What it does |
|---|---|
| `printed.list` | The filaments, copper wire AWG 10–30 worked out, and the settings |
| `printed.set` | Material (or your own Ω·cm), nozzle, layers, clearance, trace size, current, heat warning, copper; `reset` |
| `printed.plan` | A circuit on a body, changing nothing: each net's resistance, drop and heat, the warnings, the features |
| `printed.route` | The same, routing first each net given as two pads |
| `printed.apply` | Make the plan in Reverse Engineer: one undo step, all or none; a closed channel's pause recorded |
| `printed.check` | The plan measured again at a current |
| `printed.resistance` | One run's resistance: a filament along or through the layers, a wire by gauge, tape, paint |
| `printed.export` | The parts and their traces as named STLs in a zip, with `filaments.txt` |
| `printed.clear` | Put the plan and the check away |
| `printed.forget` | Take a circuit off the export list (its features stay) |

The settings and the circuits made are saved with the project and are part
of the undo history. The solids are Reverse Engineer features, saved and
undone there. `printed.apply` adds them through `reverse.feature.add`, and
records a pause through `hw.record`, both with `runWithin`
(`src/commands/registry.ts`).

## Conductors

The figures are typical, as the makers publish them. A print often measures
higher, where its layers bond poorly.

| Conductor | Along the layers | Through the layers | Source |
|---|---|---|---|
| Protopasta conductive PLA | 30 Ω·cm | 115 Ω·cm | [Proto-pasta, Conductive PLA](https://proto-pasta.com/pages/conductive-pla): "Volume resistivity of 3D printed parts along the layers (X/Y axes): 30 ohm-cm … against the layers (Z axis): 115 ohm-cm"; use below 50 °C |
| Multi3D Electrifi | 0.006 Ω·cm | none published (taken as the same) | [MatterHackers listing of Multi3D's Electrifi](https://www.matterhackers.com/store/l/electrifi-conductive-filament-100g/sk/MN8E9WA7): 0.006 Ω·cm, printing at 130–160 °C. [Filament2Print](https://filament2print.com/en/advanced/4451-conductive-filament-electrifi.html) gives 0.001–0.1 Ω·cm and 140–180 °C. |
| Your own | entered | entered (or the same) | `printed.set { material: "custom", along, through }` |
| Copper (wire, tape) | 1.68e-8 Ω·m | the same | Copper at 20 °C; settable (`copper`) |
| Paint | entered: Ω/sq at its thickness, or Ω·cm | the same | its data sheet |

A wire's diameter is worked out from the gauge's definition,
d = 0.127 mm × 92^((36 − n)/39), and its resistance from d and copper's
resistivity; nothing is copied from a table. AWG 22 comes to 0.6438 mm and
0.0516 Ω/m. Tables that give 0.0530 Ω/m use annealed copper (IACS,
1.724e-8 Ω·m): set `copper` to that to match them.

The heat warning is a rule of thumb on power per metre of run (`heatWarn`,
1 W/m by default, halved for a filament with no published use
temperature). It is not a thermal model of the part.

## The panel

The **Method** (conductive traces or channels for copper) and what carries
the current: the filament (or your own Ω·cm along and through), or copper
wire by gauge and outer diameter, tape by width and thickness, or paint by
Ω per square. **Where**: the body, the flat face by its index, the depth
(a trace's top under the surface, or a channel's roof), a trace's
thickness, and for a tunnel whether the wire is laid *at a pause* or
*threaded after*. **Nets**, one per line: its name, points or two pads,
width and vias. *Plan* works it out, *Route* routes the two-pad nets first,
*Make* makes it (`printed.apply`); the plan shows each net's resistance and
length and the warnings, and is planned again when a setting has changed.
*Check* gives each net's drop and power at the current, *Export* the STLs;
each circuit made is listed, its × taking it off the export list.
*Settings*: nozzle, layer height, clearance, trace width, current, heat
warning; *Defaults*.

## Input, and tying in other tools

A net is `{ name, width?, points? | path?, pads?, vias? }`. `points` lie on
the sheet as [u, v] mm. 3D [x, y, z] points are taken onto the sheet, and
`{ x, y }` objects are read as [u, v]. `path` is a 3D route.

A tscircuit Circuit JSON `pcb_trace` maps onto a net. Each `route` point
with `route_type: "wire"` becomes a point (its `x`, `y` and the first
`width` taken as they are). Each `route_type: "via"` becomes a via at its
`x`, `y`, with `to` the depth of the layer it reaches. `pcb_smtpad` and
`pcb_plated_hole` become pads (`shape: "square"`, or `hole`). The board's
outline gives `bounds`, and its keep-outs give `keepouts`. A KiCad
footprint's pads map the same way, as [u, v] on the sheet.

## Routing

`printed.route` routes each net given as two pads and no points. It runs A*
on a square grid laid on the first pad, with moves along the axes and on the
diagonals (orthogonal and 45° runs) and a cost per bend. Every cell it
passes is clear by half the width plus the clearance plus half a diagonal
step, from keep-outs, other nets' pads and runs already there. Nets are
routed in order, and each one routed becomes an obstacle to the next. A net
that can't get through is reported, with the reason. Other nets are still
planned. There is no rip-up, no reordering, nothing past two points, and at
most 200 000 cells (coarser grid or tighter bounds past that).

## What it doesn't do

- **Filaments in the 3MF.** The app's 3MF writes each body as an object but
  can't say which filament it takes. The export is named STLs and a note
  instead: load them together as one object of several parts, then give
  each part its filament.
- **Closed channels on other faces.** A closed channel laid at a pause has
  to be level. On a standing face it is threaded.
- **Contact resistance.** Where a wire or pin meets a pad, contact
  resistance isn't modelled, and it is often the largest part of a printed
  circuit's resistance.

## Tests

`tests/printed.test.ts` checks the arithmetic, worked by hand:

- resistivity units;
- Protopasta along, through and at 45°, and Electrifi;
- AWG from its definition, and AWG 22 at 0.0516 Ω/m (0.0530 at 1.724e-8);
- drop, power and the safe current;
- pad columns and vias;
- runs up a standing face;
- the width, thickness, cover, heat and clearance warnings.

It also checks the geometry: a mitred run's area is length × width, short
segments fall back, and distances and rounded bends come out right. The
router is checked on small grids: straight, a detour round a keep-out, a
wall, a start in a keep-out, a second net keeping clear of the first, and
too fine a grid. The features of a trace and a channel, and a closed
channel's top, are checked too.

`tests/occt.test.ts` builds the plan's own features in Open CASCADE on a
block:

- a trace's volume is length × width × thickness, for an L and for 45° jogs;
- the part with the traces cut out never overlaps them, and the two
  together are the block;
- pads reach the surface, and a pin hole goes through both;
- an open groove opens on the face it is cut from (top or bottom);
- a closed channel is solid above its roof.

`tests/printedCommands.test.ts` runs the commands against a stand-in Reverse
Engineer and `hw.record`. It covers:

- plan and make;
- the traces body named;
- a failed feature taking everything out;
- refusals;
- Circuit JSON points;
- a closed channel recorded at its roof Z (from the top and from the
  bottom);
- a standing one refused for a pause and threaded;
- no Hardware workspace;
- routing and a failed net;
- 3D routes' profile planes;
- check, the calculator, export, and the settings.
