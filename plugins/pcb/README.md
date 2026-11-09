<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Boards

On screen: the **Electronics** tab's **KiCad** page. Its workspace id is
still `pcb`, which projects and `workspace.set` use; `electronics` opens the
tab at the page last shown.

KiCad circuit boards in ScanRuler: a board brought into Reverse Engineer as
solids, an enclosure made round it, and its fabrication package and design
rule check.

KiCad's own command line, `kicad-cli`, does the KiCad work. It runs on this
computer as a separate program, started by the agent's server
(`mcp/src/extras/kicad.js`), because the page cannot start programs. None
of KiCad's code is used or copied (KiCad is GPL). The board file is read
here with a parser of ScanRuler's own (`mcp/src/extras/kicadBoard.js`).

- **Open.** The board's outline from Edge.Cuts (lines, arcs, rectangles,
  circles, polygons, in footprints too), its thickness, its mounting holes
  (MountingHole footprints, footprints of unplated holes only, circles on
  Edge.Cuts), and the connectors within 2.5 mm of the edge. Each connector
  gets the wall it faces and the opening it needs.
- **Import.** `kicad-cli pcb export step`, centred on the outline's box,
  brought in as bodies: the board named after its file, the edge
  connectors after their references. Measures the parts' reach above and
  below the board and each connector's 3D box. KiCad's placement file
  checks the connectors' places and gives their rotations. A part with no
  3D model comes in as a grey placeholder box, named "board R1
  (placeholder)": its footprint's courtyard (else fab outline, else pads),
  as tall as the file says or 3 mm. The reach, the enclosure and a
  clearance check see the box; the import and the panel name the parts it
  stands for. A board that gives no STEP back says the likely cause and
  what to do.
- **Enclosure.** Generate's `board_box` (plugins/gen/core/boardBox.ts):
  standoffs under the holes with heat-set insert holes or self-tapping
  pilots (figures copied from the hardware table), room above and below
  the parts, openings in the walls, and a lid on a lip. `pcb.plan` (the
  panel's *Preview*) gives the box's size, the standoffs and the openings,
  with the sizes it guessed, before anything is made. Its holes, the gap to
  the board, the lid clearance and the opening margins follow the
  printer's fit calibration from Fits unless set (`printerFit`; `false`
  builds with Generate's defaults).
- **Fab package.** Gerbers, Excellon drill files (plated and unplated
  apart), the placement CSV, the parts list from the schematic (KiCad 8+)
  and the DRC report, in a job folder under the ScanRuler folder's
  `boards/`, zipped. The board-house naming uses Protel extensions
  (`.GTL`, `.GBL`, `.GTS`, …, `.GKO`) and JLCPCB's column names.
- **DRC.** `kicad-cli pcb drc --format json --exit-code-violations`. Exit 5
  means violations were found.

Opening sizes for USB-C, micro- and mini-USB, USB-A, barrel jacks, RJ45,
pin headers and JST housings are typical figures. Any other connector is
sized by its 3D model's box, or by its footprint with a guessed height.

## kicad-cli versions

kicad-cli is looked for in `SCANRULER_KICAD_CLI`, then where KiCad
installs (`/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli`,
Homebrew, `/usr/bin`, `C:/Program Files/KiCad/<v>/bin`), then on the PATH.
Before each command is used, its `--help` is read for the flags it needs.
A needed flag that is missing stops the command, with the flag named.
Wanted flags are passed only where listed.

| Command | Needs | Uses where listed | Versions |
|---|---|---|---|
| `pcb export step` | `--output --force --user-origin` | `--subst-models --board-only --no-dnp` | 7–10 (`--no-dnp` from 8) |
| `pcb export gerbers` | `--output --layers` | `--no-protel-ext` | 7–10 |
| `pcb export drill` | `--output --format --excellon-separate-th --excellon-units` | | 7–10 |
| `pcb export pos` | `--output --format --units --side` | `--exclude-dnp` | 7–10 (`--exclude-dnp` from 8) |
| `pcb drc` | `--output --format --exit-code-violations` | `--severity-all --units --schematic-parity` | 8–10 |
| `sch export bom` | `--output` | `--fields --labels --group-by --exclude-dnp` | 8–10 |

## Commands

| Command | What it does |
|---|---|
| `pcb.tools` | kicad-cli found, its version, each command's flags |
| `pcb.open` | Reads a `.kicad_pcb`: outline, holes, edge connectors |
| `pcb.import` | The board as STEP into Reverse Engineer, bodies named, parts measured |
| `pcb.set` | Import, naming, the parts' reach, connectors to skip, the enclosure's values |
| `pcb.plan` | The enclosure worked out and sized, nothing made |
| `pcb.enclosure` | The box and lid made round the board (Generate's `board_box`) |
| `pcb.fab` | The fabrication package, as a zip |
| `pcb.drc` | KiCad's design rule check |
| `pcb.close` | Puts the board away |
| `pcb.stop` | Stops kicad-cli |

Every panel control runs one of these: *Check* for kicad-cli; the board
file's path (opened when entered, put away when cleared); the connectors'
openings ticked on or off; *Import*, with the placeholders it made named;
the enclosure's values, *Preview*, *Make enclosure* and *Defaults*; the
file names (board house or KiCad's own), *Fab package* and *Check rules*;
*Stop*. With `SCANRULER_MCP_EXTRAS=pcb` the
server also offers `kicad_tools`, `kicad_board`, `kicad_drc` and
`kicad_fab`, which work without a ScanRuler page.

The Catalog searches KiCad's 3D model library (`kicad`). That library is
kicad-packages3D by the KiCad Libraries Team, CC-BY-SA 4.0 with the KiCad
libraries exception. Models installed with KiCad are found on disk first.
Otherwise a library folder's file list comes from GitLab's API, cached for
a month, one request a second at most. The licence goes into
provenance.json with each file taken.

## Saved with the project

The board file's path, what was read of it (outline, holes, connectors),
what the import measured, and the settings. An enclosure can be made again
without KiCad. The bodies are Reverse Engineer's, saved with it.

## Beside it

The Electronics tab's other pages are tscircuit (`circuit`: boards written
as code, built here and brought in as solids) and Printed wiring
(`printed`: traces or copper channels inside a printed part). Generate's
`board_box` takes any board in its `BoardSpec` shape (core/boardSpec.ts).

## Tests

`mcp/tests/kicad.test.js` uses a stand-in kicad-cli (`fakeKicad.js`) that
lists KiCad 7's, 8's and 9's own flags and refuses any other. It checks
the board read from a hand-written `tiny.kicad_pcb` (outline with an arc,
two M3 holes, a USB-C and a pin header at the edge), KiCad 5 arcs, turned
footprints, and an outline that does not close. It checks that no flag
reaches a version that does not list it, the STEP origin, the fab names
and zips, and DRC exit codes. A real kicad-cli, where installed, runs the
fixture through. `boardAsks.test.js` checks the page's asks, and
`kicadModels.test.js` checks the 3D library against a stand-in GitLab.

`plugins/gen/tests/boardBox.test.ts` builds the enclosure with OCCT. It
checks that the standoffs stand under the holes with an insert's or
pilot's hole, that the board clears the walls, that openings sit at the
connectors with wall beside them, that a round opening works, and that
the lid fits. `tests/pcb.test.ts` checks the board's bodies found, the
parts' reach, the openings made from typical sizes or 3D boxes, and the
project section. `tests/pcbCommands.test.ts` runs the commands against a
faked server, Reverse Engineer and Generate.
