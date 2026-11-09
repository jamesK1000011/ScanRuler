<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Board order

On screen: the **Make** tab's **Order** page (workspace id `pcbo`), the one
page of a **PCB order** setup.

A circuit board — from Electronics › KiCad or tscircuit, brought into
Reverse Engineer as a body — made by a board house. It is a kind of setup
(`registerSetupType`, plugins/_shared/setups.ts): the board's body, and
its order's settings. The board's enclosure is not in it: that is a part
of its own, made by a print, cut or mill setup.

## The setup type (`pcb`)

| Setting | What | Unset |
|---|---|---|
| `fab` | A fab profile: generic, jlcpcb, pcbway, oshpark | generic |
| `layers` | Copper layers ordered | the board's |
| `thickness` | Board thickness | the board's |
| `finish` | hasl, lf-hasl, enig, osp, immersion-silver, immersion-tin | the fab's first |
| `quantity` | Boards | 5 |
| `assembly` | none, or smt (placed by the fab from the BOM and CPL) | none |
| `limits` | The fab's own least trace, space and drill over the profile's | the profile's |
| `source` | kicad or tscircuit, when the body does not say | from the body |

The profiles (app/pcboCommandCore.ts) hold typical figures for each fab's
standard service — least trace and space, least drill, layer counts,
thicknesses, finishes, largest board, whether it assembles. They are not
the fab's word, and every answer and the page say so. `part.review` judges
a board in such a setup by `pcbo.check` (its findings under `made`). It
has no machine tolerance: Fits sizes nothing by it.

## Commands (`pcbo.*`)

| Command | What |
|---|---|
| `pcbo.check` | DRC, and the board's figures and the order against the fab; for SMT, the BOM and CPL of the last package |
| `pcbo.package` | The fab files, BOM, CPL, STEP and an order sheet in one zip |

Both run headless. They reach the board only through Electronics'
commands and readouts — `pcb.drc`, `pcb.fab`, the KiCad board's figures
(`stats`, `rules` from its `.kicad_pro`); `circuit.stats`, `circuit.build`,
`circuit.read` — and Reverse Engineer's `reverse.export.step`. A build
without one of them still stands, and says which it needs.

KiCad's least clearance is not measured from the board: its DRC holds the
board to its own rules, so those rules are what is compared with the fab.
tscircuit's is measured (`circuit.stats`).

## Tests

`tests/pcbOrder.test.ts`: the order resolved from the settings and the
board, the board judged against the profiles, BOM and CPL references read
and compared, the order sheet; then both commands against KiCad and
tscircuit faked (`tests/orderFakes.ts`) — DRC read, an enclosure refused,
the fab zip split, a tscircuit build made for missing outputs, the lists
kept for the next check — and the setup type's settings.
