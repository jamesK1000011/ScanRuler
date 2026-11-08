<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Circuit

Circuit boards written as code with [tscircuit](https://github.com/tscircuit/tscircuit)
(MIT), built on this computer by its command line, and brought into the
model: the board, its copper and its parts' keep-outs as solids in Reverse
Engineer, to design an enclosure round, and figures read from the board's
Circuit JSON.

- **Projects from templates**: a blank board, an LED with its resistor sized
  for the supply, carriers for a Raspberry Pi Pico or an ESP32-DevKitC, and a
  board cut to fit an enclosure's inside — notched round its bosses, or taken
  from Generate's project box.
- **Builds** with `tsci build` and `tsci export`, each in a job folder of its
  own: circuit.json, Gerbers, BOM, pick-and-place, `.kicad_pcb`, STEP, GLB,
  SVG, with the build's DRC and routing errors. Every flag and format is
  checked against the installed `tsci --help` first and refused by name when
  it is not there.
- **Circuit JSON read directly**, without tscircuit: each element checked,
  those that do not check left out and listed.
- **Figures**: size, layers, trace lengths and the narrowest trace, the
  smallest drill, the nets the copper makes, the least clearance between
  copper of two nets on a layer.
- **Solids** with OCCT in a worker: the outline at the board's thickness with
  its holes, slots and cutouts through; each layer's copper as thin solids on
  its own face, drilled — bodies of their own, to show, export or print in a
  conductive filament; the components' footprints as keep-out boxes.
- **Resistance** per trace and net, in copper or a printed conductor
  (Protopasta conductive PLA, Multi3D Electrifi — typical figures), vias
  included.

tscircuit runs on this computer, through the agent connection (Settings →
Agents): `npm install -g tscircuit` once — the guide says how. Reading,
measuring and building solids need neither.

The element shapes are read as circuit-json's schemas define them
(github.com/tscircuit/circuit-json, ISC). No tscircuit code is used or
bundled; `tsci` is run as a program.

## Commands

| Command | What it does |
| --- | --- |
| `circuit.tools` | Whether `tsci` is installed, its version, flags and formats; the templates |
| `circuit.new` | A project folder from a template (`fromBox` fits Generate's box) |
| `circuit.build` | `tsci build` and `tsci export` into a job folder; opens the board |
| `circuit.files` | Projects, builds and their files |
| `circuit.open` | A circuit.json, by build, path or text |
| `circuit.stats` | The board's figures |
| `circuit.resistance` | Each net's trace resistance for a conductor |
| `circuit.set` | Conductor, thicknesses, keep-out height, solids, project |
| `circuit.bodies` | The board, copper and keep-outs into Reverse Engineer |
| `circuit.clear` | Close the board |
| `circuit.stop` | Stop a build or the solids |

Every panel control runs one of these. With `SCANRULER_MCP_EXTRAS=circuit`
the agent's server also offers `circuit_tools`, `circuit_new`,
`circuit_build`, `circuit_files` and `circuit_read` directly
(`mcp/src/extras/circuit.js`).

## Hand-off to KiCad

`circuit.build { outputs: ["kicad_pcb"] }` writes `board.kicad_pcb` in the
job folder — a file KiCad opens, and so does the Boards workspace:
`pcb.open { path }` with the build's `files["board.kicad_pcb"]`, then
`pcb.enclosure` and `pcb.fab` as for any KiCad board.

## Saved with the project

The settings, the project folder, the last build, what was made, and the open
board's circuit.json (as `circuit/circuit.json` in the archive), so the board
opens again on a computer without tscircuit. The bodies are Reverse
Engineer's Import feature, saved with it.

## Tests

`tests/circuit.test.ts` reads a hand-written two-layer board
(`tests/fixtures/two-layer.circuit.json`) and checks the reading, units and
refusals; trace lengths, nets and the least clearance worked by hand; the
resistance in copper, Protopasta and Electrifi, a taper and a via, worked by
hand; and the solids in OCCT — the board's volume less its drills, holes
through, each layer's copper islands on their own face and drilled, volumes
against their areas, keep-outs at their heights and turned.

`tests/circuitCommands.test.ts` runs the commands against a faked server,
worker and Reverse Engineer: a board opened and measured, a printed
conductor's resistance, a project fitted to Generate's box with its bosses
where Generate puts them, a build that opens its board and one that fails,
the bodies named after the parts standing where they do, and a stop.

The server's side is tested in `mcp/tests/circuit.test.js` against a
stand-in `tsci` (`mcp/tests/fakeTsci.js`).
