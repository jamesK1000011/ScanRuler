<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Cutting parts from sheet

A part laser-, waterjet-, plasma- or router-cut from sheet is a **sheet part**: a profile cut straight through a sheet of one thickness. How a part is made is its setup (the **setups** guide): a cut setup records the machine and its figures; the material is the part's own (`material_set`). Do not decide for the person that a part is cut: ask, then record it with `setup_add { type: "cut", bodies: [...] }`.

## 1. Record the setup

`setup_add { type: "cut", bodies: ["Plate"], settings: { machine: "laser", thickness: 3, sheet: [600, 400] } }`. Every setting is optional:

| Setting | What | Unset |
|---|---|---|
| `machine` | `laser`, `waterjet`, `plasma`, `router` | laser |
| `thickness` | the sheet's, mm | the part's own |
| `kerf` | the width the cut takes out, mm — a router's cutter diameter | by machine and material |
| `minFeature` | the least web, slot or hole, mm | by machine, material and thickness |
| `sheet` | `[width, height]`, mm: parts checked to fit and laid out on it | no sheet |
| `compensate` | the file's path moved half a kerf off the part | false: the machine's software compensates |

`cut_rules { machine, material, thickness }` gives the figures used where one is unset, and why: shop rules of thumb, not a datasheet. When the person knows their machine's kerf or least feature, set it.

## 2. Check

`cut_check { body }` — or `part_review { body }`, which runs it for a part in a cut setup and judges by its findings (under `made`). The input can override the setup for one call (`machine`, `thickness`, `kerf`, `minFeature`, `sheet`).

- **Not a sheet part** (`flat` errors, each naming a face): a step or pocket between the sides, a bevel or chamfer, a rounded edge, a side hole, a countersink. Say what the face is and where. A sheet cut cannot make it: model it as a through profile, or machine it after (then it is two steps — say so), or choose another process with the person.
- **Thickness** against the sheet's: a part 3 thick in a 2 setup is an error.
- **Narrow places**: a web (material) or a slot narrower than the least feature warns; narrower than the kerf cannot be cut at all.
- **Holes**: under the least feature warns (drill after); under the thickness on a laser or plasma (`hole-thickness`) comes out tapered — drill or ream to size. Under the kerf, or a router's cutter, cannot be cut.
- **Router inside corners**: a square inside corner keeps the cutter's radius; round it to that radius, or a dogbone where a square part has to fit.
- **The sheet**: a part that will not fit it, turned any way, is an error; one that fits only turned says the angle.
- **The material**: plasma needs a conductive metal; glass is not lasered or routed. With no material set the rules are generic — ask what it is made of.

`figures.assumed` lists what came from the rules rather than the setup: say so when it matters.

## 3. The file

`cut_export { setup: "S2", format: "dxf" }` (or `bodies`, with `{ body, count }` for copies). One file, every part's outline and holes as lines, arcs and circles read exactly off the kernel's section, laid out in rows (not true nesting) with a gap — by default the larger of 3 and two kerfs — onto as many sheets as needed. DXF in millimetres (AutoCAD 2000), or SVG at one unit a millimetre.

- `compensate: true` only when the person's machine expects the path, not the part: most laser and waterjet software compensates itself. Compensated circles stay circles; other outlines become short lines.
- `labels: true` writes the part names on a layer of their own; off by default, since a cutter may cut text.
- A part that is not a sheet part is still drawn by its section, with a note: tell the person.

## 4. Fits

A cut hole on the drawn line comes out a kerf larger; an outline a kerf smaller. `fit_set { setup: "S2" }` sizes Fits' holes and pins for the cut setup's kerf (none when compensated), held to the cut's ±.
