<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Material data: sources and licences

The material library (`index.ts`) is two tables.

## FreeCAD's material cards — `freecad.json`

131 materials converted from the material cards of [FreeCAD](https://www.freecad.org/)
(`src/Mod/Material/Resources/Materials/Standard` and `…/Machining`), with
the units checked against FreeCAD's material models
(`…/Resources/Models`, LGPL-2.0-or-later, © 2023 David Carter and
sliptonic). The data stays under each card's own licence, which its entry
carries in `source` with the card's path, UUID and author:

| Licence | Cards |
|---|---|
| LGPL-2.0-or-later | 100 (95 that say so; 5 metal cards with no License line, shipped in FreeCAD's LGPL material library — `source.licenseNote` marks them) |
| CC-BY-3.0 | 31 |

FreeCAD's `Default` card (GPL-2.0-or-later, a placeholder of density
1 kg/m³) is left out: it is no material.

Card authors, as the cards name them:

| Author | Cards | Licence |
|---|---|---|
| M. Münch | 93 | LGPL-2.0-or-later |
| Jonas Bähr | 13 (the Machining cards) | CC-BY-3.0 |
| Uwe Stöhr | 11 | LGPL-2.0-or-later, CC-BY-3.0 |
| Bernd Hahnebach | 3 | CC-BY-3.0 |
| Juergen Riegel | 3 | CC-BY-3.0 |
| DaviKaur | 2 | CC-BY-3.0 |
| Przemo Firszt | 2 | CC-BY-3.0 |
| Mandeep Singh | 1 | CC-BY-3.0 |
| Yorik van Havre | 1 | CC-BY-3.0 |
| vlk | 1 | LGPL-2.0-or-later |
| (none named: AlZn4-5Mg1F35) | 1 | LGPL-2.0-or-later |

Changes made in conversion (`scripts/convert-fcmat.mjs`): figures turned
into the app's units (g/cm³, MPa, µm/(m·K), MS/m …; a 0 read as not
given); ids made from the file names; `PLA-Generic` and `ABS-Generic`
named "PLA (generic)" and "ABS (generic)" beside the printing filaments;
`Reinforcement-FIB-B500` ("Reinforcement-Harry") filed as steel; and the
Machining cards, which hold cutting data only, given the bulk figures of
the Standard card named in their `bulkFrom` (the fork's choice), or a
density — from the card's own description for hard and soft wood, a
typical figure for balsa, MDF and particle board (`densitySource` says
which).

CC-BY-3.0: https://creativecommons.org/licenses/by/3.0/ — LGPL-2.0:
https://www.gnu.org/licenses/old-licenses/lgpl-2.0.html

## The fork's own — `fork.ts` and `printed.ts`

AGPL-3.0-only, like the app. Typical figures, each entry's `source.basis`
saying where from: the printing filaments (PLA, PETG, ABS, ASA, PETG-CF,
PA6-CF, TPU 95A) from Bambu Lab's data sheets, as the app has always used
them; polycarbonate, HDPE, POM and free-cutting brass from makers' data
sheets for common grades. `printed.ts` holds what printing does to the
filaments — in-layer and across-layer stiffness and strength — as process
data, not material data.
