<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Ordering a circuit board

A board from Electronics — KiCad (`pcb.*`) or tscircuit (`circuit.*`), brought into Reverse Engineer as a body — made by a board house. How it is made is its setup, as for any part: a **PCB order** setup (type `pcb`) holds the board's body and the order. Its page on the Make tab is **Order**.

## 1. Record the order

- Bring the board in first: `pcb.import` (KiCad: the green body named after the file) or `circuit.bodies` (tscircuit: "Board").
- `setup_add { type: "pcb", bodies: ["tiny"], settings: { fab: "jlcpcb", finish: "enig", quantity: 10, assembly: "smt" } }`. Every setting is optional:

| Setting | Unset |
|---|---|
| `fab` — `generic`, `jlcpcb`, `pcbway`, `oshpark` | generic |
| `layers`, `thickness` (mm) | the board's own |
| `finish` — `hasl`, `lf-hasl`, `enig`, `osp`, `immersion-silver`, `immersion-tin` | the fab's first |
| `quantity` | 5 |
| `assembly` — `none` or `smt` (the fab places SMT parts from the BOM and CPL) | none |
| `limits` — `{ minTrace, minSpace, minDrill }` mm, the fab's own figures over the profile's | the profile's |
| `source` — `kicad` or `tscircuit`, when the body's name does not say | from the body |

- The fab profiles are **typical** figures for a fab's standard service, not its word: its capabilities page and order form are, and they move with layers and options. Say so when you quote them. When the person has the fab's real figures, set `limits`.
- Only the board goes in this setup. Its **enclosure** (`pcb.enclosure`'s box and lid, or one modelled round a tscircuit board) is a part of its own: put it in a print, cut or mill setup. `pcbo_check` calls an enclosure in a PCB order an error, and says when the enclosure is in no setup.

## 2. Check

`pcbo_check { setup }` (or `{ body }`): the DRC (KiCad's `pcb.drc`; tscircuit's build and circuit.json errors), then the board against the fab — the narrowest trace, the least space between copper, the smallest drill, the layers, the size — and the order's thickness, finish and assembly against what the fab usually offers. `verdict` is ok, fix, or unknown when DRC did not run.

- The space: tscircuit's is measured on the board. KiCad's is the least its `.kicad_pro` rules allow, which DRC holds the board to — a rule under the fab's figure is a warning: raise the clearance in Board Setup and run DRC again. A board read before these figures existed asks for `pcb.open` again.
- For SMT, the BOM and CPL are checked once `pcbo_package` has gathered them: each part in both, and every part of the board in one.
- `part_review` on the board runs this check under `made`.

## 3. Package

`pcbo_package { setup }` returns one zip, a folder `<board>-order/`:

- `<board>-gerbers.zip` — the Gerbers and drill files: the file to upload;
- `assembly/<board>-bom.csv`, `assembly/<board>-cpl.csv` — for SMT assembly only (KiCad's placement list in JLCPCB's columns; tscircuit's `pick_and_place.csv`);
- `<board>.step` — the setup's bodies from Reverse Engineer;
- `reports/…-drc.json` — KiCad's DRC report;
- `order.md` — the order sheet: size, layers, thickness, finish, quantity, assembly, the fab, the files, and what to put right first.

From KiCad it runs `pcb.fab`. From tscircuit it uses the last build when that holds the outputs, else builds for them (`rebuild: true` always does). Nothing is ordered: the person uploads the files on the fab's own page.
