<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Materials

What each part is made of, as a property of the part — as in FreeCAD and
Fusion. A build mixes processes part by part: a printed bracket, a
laser-cut acrylic plate, a machined aluminium shaft, a bought brass
insert. The material is the part's; how the part is made is its setup
(`plugins/_shared/setups.ts`), kept apart. Who picks a material is not the
app's business: the person and the agent settle it between them, and the
app records it and uses it.

| Command | What it does |
|---|---|
| `material.list` | The library, briefly — by category (`metal`, `thermoplast`, `wood`, `glass`, `aggregate`, `carbon`) and by words; paged |
| `material.get` | One material whole (figures, other names, printing figures, source and licence), or a body's material and setup |
| `material.set` | A library material, or one of your own (`{ name, base?, density, youngsMPa, poisson, yieldMPa, ultimateMPa }`), on one body or several |
| `material.clear` | Take it off a body, or every body |

All run headless. A body is keyed by its Reverse Engineer id, so a rename
keeps its material; the project keeps them under `materials`. In the
panel, the bar under Reverse Engineer's body list has a Material list for
the bodies picked.

## Who uses it

- **Mass** weighs each body in its material: solid, or — in a print setup —
  as printed, walls round the infill (the setup's where it gives them, else
  the Mass setup's) with the calibration. A body with no material is
  weighed as before, in the Mass setup's material, and the answer says
  what was assumed.
- **Strength** solves in the body's material: a filament in a print setup
  as printed, weaker across its layers; anything else as the solid
  material, the same in every direction, judged by von Mises against its
  yield. With none set, the study's material as before, said so.
- **Part review** reports the material the part was weighed in.
- **Fits** takes its moduli from the printing figures and knows the
  library's polyamide as its nylon.

## The library

`plugins/_shared/materials/`: FreeCAD's material cards (131: metals —
steels, cast irons, aluminium, copper, titanium —, plastics, wood, glass,
concrete, graphite; the Machining cards with cutting speeds and cutting
force), and the fork's own: the printing filaments, polycarbonate, HDPE,
POM and brass. Each entry keeps its source and licence;
[MATERIALS-LICENSES.md](../_shared/materials/MATERIALS-LICENSES.md) credits
FreeCAD and the cards' authors, and the library puts its credit in the
imprint itself (`Notices.tsx`, registered by `index.ts`), so it is there
whenever the library is bundled — by Mass, Strength or Fits in a build
without this plugin too. `scripts/convert-fcmat.mjs` converts the cards
again from a FreeCAD checkout.

## Tests

`tests/material.test.ts` (the commands, a rename, a material of your own,
the project file) and `plugins/_shared/tests/materials.test.ts` (the
conversion against the cards, licences, aliases, the setups reader); the
consumers' in `plugins/mass/tests/massCommands.test.ts` and
`plugins/fea/tests/fea.test.ts`.
