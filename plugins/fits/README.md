<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Fits

Fit design for 3D-printed parts. Fits sizes the model so the printed parts
fit, using the printer's own offsets.

- **Hole and shaft.** Sizes from a nominal and a class: free, slip, close,
  press or tight press, or a clearance you give. You get the sizes as they
  print and as you model them, and the clearance's range worst case and
  RSS. The ISO 286 fit each class stands in for is given as a reference,
  along with the IT grade the printer holds at that size. For a press you
  also get the strain it puts on the hub. One side can be a bought part,
  such as a steel dowel or a bearing, which keeps its size.
- **Calibration.** Fits learns how much smaller holes print and how much
  bigger shafts print in three ways: from features you measure on a print,
  from offsets you enter, or from Print fit's last run (fit-comp's hole and
  contour offsets, doubled). It also records the clearance at which each
  class felt right on the test coupon.
- **Test coupon.** A plate of holes and a bar of pegs, each with its
  clearance engraved in seven-segment figures (`+.10`, `-.05`). It comes
  with a gauge pin and a gauge ring at the nominal and is made in Reverse
  Engineer.
- **Snap fit.** A cantilever hook of constant section with its strain,
  forces and limits, and the hook and its catch window as solids.
- **Print-in-place hinge.** Knuckles on two leaves with a pin through them,
  with radial and axial clearances.
- **Pin and socket.** A chamfered pin and a blind socket with a lead-in,
  sized by class, or a socket alone for a bought dowel.
- **Tolerance stack.** A chain of sizes added up worst case and RSS, with
  each size's share of the variance and the chance the gap closes.

Every part is built with OCCT in a worker and brought into Reverse Engineer
through `reverse.import.step` as named bodies. There you can place it, cut
it into a part, check it and export it.

## Formulas

| What | Formula | Source |
|---|---|---|
| Tolerance unit | i = 0.45·∛D + 0.001·D µm | ISO 286-1; IT5 = 7i … IT18 = 2500i |
| Snap strain | ε = 1.5·t·y / L² | Cantilever, constant rectangular section, load at the tip (Bayer/Covestro snap-fit design guide) |
| Deflection force | P = b·t²·Es·ε / (6·L) | Same, from σ = 6PL/(bt²) = Es·ε |
| Mating, separation | W = P·(µ + tan α)/(1 − µ·tan α) | Same guide; it locks where µ·tan α ≥ 1 |
| Press strain | ε ≈ δ / D at the bore | A thick hub on a stiff shaft (Lamé) |
| Stack | worst Σ hᵢ; RSS √Σ hᵢ² | hᵢ the half-width of each zone, its mid moving the mean |
| Chance under min | Φ((min − mean)/σ), σ = RSS/3 | Each tolerance taken as ±3σ; erf from Abramowitz & Stegun 7.1.26 |

Repeated assembly allows 60 % of the one-time strain, the snap-fit guides'
usual figure. A beam printed standing up allows half, because it bends
across its layers.

The class clearances and the material figures (secant modulus, permissible
strain, friction) are typical starting points. They are not standards or
datasheet values, so calibrate with a print. The strains follow the moulded
figures in the snap-fit guides (ABS 2.5 %, nylon 4 %), held at or below them
for printing. PLA is held lower for its brittleness.

No FreeCAD or other CAD package code is used.

## Commands (`fit.*`)

These share the `fit` namespace with Print fit (`fit-comp`) under different
verbs.

| Command | Changes | What |
|---|---|---|
| `fit.list` | nothing | Classes with their clearance at a size, materials, parts, settings, calibration |
| `fit.set` | settings | Tolerance, material, the panel's page; `reset` |
| `fit.calibrate` | calibration | From readings, offsets entered, Print fit, or the classes felt on a coupon; `reset` |
| `fit.pair` | nothing | Hole and shaft sizes, printed and modelled, range, ISO reference, press strain |
| `fit.stack` | nothing | Worst case, RSS, contributions, chance under a minimum |
| `fit.snap` | nothing | Hook strain, forces and limits; kept for `fit.apply` |
| `fit.hinge` | nothing | The hinge's knuckles, bore, wall and clearances; kept for `fit.apply` |
| `fit.pin` | nothing | Pin and socket sizes; kept for `fit.apply` |
| `fit.test` | Reverse Engineer | Makes the test coupon |
| `fit.apply` | Reverse Engineer | Makes the part planned last, or `{ part, params }` |
| `fit.file` | nothing | The part as STEP or STL |
| `fit.stop` | nothing | Stops a build |

Every panel control runs one of these, and an agent gets the same tools.
The agent guide is `guide.read { id: "fits" }`.

## Saved with the project

Saved: the settings, the calibration, the panel's page, and the values each
tool was last given. The parts made are Reverse Engineer's Import features,
saved with it.

## Layout

| Path | What |
|---|---|
| `core/fits.ts` | Classes, pair, ISO 286 grade, calibration, stack |
| `core/snap.ts` | Materials, the hook's formulas |
| `core/plans.ts` | Inputs and calibration into sizes to model, checks and notes |
| `core/parts.ts`, `core/kernel.ts` | The solids, the seven-segment labels |
| `core/build.ts`, `core/fitsWorker.ts`, `app/fitsClient.ts` | Building in a worker |
| `app/fitsCommands.ts` | The commands |
| `ui/FitsPanel.tsx` | The panel |

## Tests

- `tests/fits.test.ts` checks the formulas against hand-worked values: the
  pair, the IT grade, calibration from readings and from Print fit, the
  stack, the hook, and the plans' refusals.
- `tests/parts.test.ts` builds every part with OCCT and checks the sizes,
  and that mating parts don't overlap: cutting one by the other leaves its
  volume whole. It also checks the gaps between them (the hinge's leaves,
  the hook and its catch, a slip pin in its socket), that a hook pulled
  back catches on the plate, and that a press pin overlaps its socket by
  the interference.
- `tests/fitsCommands.test.ts` runs the commands against a stand-in Reverse
  Engineer, building in Node.
