<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# How each part is made: setups

A build mixes processes part by part: a bracket printed, a plate laser-cut, a shaft machined, a board ordered, screws bought. What a part is made **of** is the part's own; **how** it is made is its setup. A setup is one process and the bodies made by it, with that process's settings — as a setup is in Fusion's Manufacture workspace. The person decides how each part is made, with you, in conversation: a setup records what was chosen; nothing chooses it for them.

## 1. Read before you assume

- `setup_of { body }` says how a body is made, as recorded: its setups and their settings, or none. `setup_list` gives every setup, the one the Make tab shows, and the kinds this build has (each with its settings, its pages on the Make tab, what `part_review` checks on a part in it, and what it puts out).
- A body in no setup has no process recorded. Do not take it as printed: ask, then record the answer.

## 2. Record what was chosen

- `setup_add { type: "print", bodies: ["Bracket"], settings: { nozzle: "0.4", layerHeight: 0.2 } }` — a print setup for the bracket. `name` is the type's label by default ("Print", "Print 2" …). A body is in one setup of a kind at most; the refusal names the setup it is in.
- `setup_set { id, … }` changes one, by id (`S1`) or name: `name`; `bodies` (the whole list) or `add` and `remove`; `settings`, merged over its own, `null` dropping one. Each change is one undo step.
- `setup_remove { id }` takes one away; its bodies are then in no setup of its kind.

## 3. What a print setup holds

Each setting is optional; one left unset leaves each workspace on its own setting, as before setups. One set is what the workspaces use for a body in the setup:

| Setting | Read by |
|---|---|
| `printer`, `nozzle` | the printability check's profiles (`dfm_check` on the body) |
| `up` | the way up on the bed: the check's frame, and the strength study's build direction at `fea_solve` |
| `layerHeight`, `firstLayer` | the pauses for parts encased mid-print (`hw_pauses`), a pocket's least roof (`hw_embed`) |
| `walls`, `infill`, `lineMm` | the weight as printed (`mass_properties`) |
| `fit` | the printer's fit calibration — `"fits"` keeps Fits' calibration as it stands with the setup; holes are sized with it (`hw_plan`, `part_review`'s `printerFit`), and `fit_set { setup }` sizes Fits' parts with it |

Each answer that used a setup's value says so (`setup`, a mass row's `as`, `layers.from`, a note). An input given to a command for one call still wins over the setup.

## 4. Other kinds

- A **cut** setup (`type: "cut"`): parts laser-, waterjet-, plasma- or router-cut from sheet — the machine, the sheet's thickness and size, the kerf, the least feature, whether the file is kerf-compensated. Its page is Cut; the **cut** guide.
- A **mill** setup (`type: "mill"`): parts machined on a CNC mill — the axes, the tool directions, the stock, the least tool, the reach, the IT grade sizes hold. Its page is Mill; the **mill** guide.

Each setting is optional there too: unset, it comes from the machine and the part's material, and the answers list what was assumed. `fit_set { setup }` sizes Fits' parts for a cut setup's kerf or a mill setup's IT grade as for a printer.

A board ordered from a board house is a **PCB order** setup (`type: "pcb"`, page Order): the board's body, the fab, layers, thickness, finish, quantity and assembly — see the **pcb-order** guide. Only the board goes in it; its enclosure is a part of its own, in a print (or cut, or mill) setup.

## 5. The review follows the setup

`part_review { body }` judges a part in a print setup by the printing checks, a part in a setup of another kind by that kind's own checks, and informs on a part in no setup. The wall is read for every part, however it is made. See the **review** guide.
