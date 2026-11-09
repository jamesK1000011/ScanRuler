<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Fits

The Fits tab's first page, **Design** (workspace id `fits`); the second,
**Calibrate from a scan**, is fit-comp's. The two share one calibration.

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
  from offsets you enter, or from a print measured on the Calibrate from a
  scan page (fit-comp's hole and contour offsets, doubled — a good run
  becomes the calibration by itself, so the printer has one calibration).
  It also records the clearance at which each
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
| Tolerance unit | i = 0.45·∛D + 0.001·D µm, D the geometric mean of the size's step (3–6, 6–10 …) | ISO 286-1; IT5 = 7i … IT18 = 2500i (IT7 at 6–10 is 15 µm, IT14 at 80–120 870 µm) |
| Snap strain | ε = 1.5·t·y / L² | Cantilever, constant rectangular section, load at the tip (Bayer/Covestro snap-fit design guide) |
| Deflection force | P = b·t²·Es·ε / (6·L) | Same, from σ = 6PL/(bt²) = Es·ε |
| Mating, separation | W = P·(µ + tan α)/(1 − µ·tan α) | Same guide; it locks where µ·tan α ≥ 1 |
| Press strain | ε = δ/D on a bought (stiff) shaft; (δ/D)·((1 + k²) + ν(1 − k²))/2 on a printed one of the same material, k = D/Do, ν 0.35; δ/D with no wall given | Hoop strain at the hub's bore, Lamé thick-walled cylinders |
| Stack | worst Σ hᵢ; RSS √Σ hᵢ² | hᵢ the half-width of each zone, its mid moving the mean |
| Chance under min | Φ((min − mean)/σ), σ = RSS/3 | Each tolerance taken as ±3σ; erf from Abramowitz & Stegun 7.1.26 |

Repeated assembly allows 60 % of the one-time strain (Bayer's snap-fit
guide, Table 2). A beam printed standing up bends across its layers and
allows the material's share of it: printed bars across their layers reach
about half of PLA's strain flat, 40 % of PETG's and ASA's, 30 % of ABS's.

The class clearances are starting points, not a standard: calibrate with a
print. The material figures:

| Material | Modulus, MPa | Strain, flat | Upright share | Friction | From |
|---|---|---|---|---|---|
| PLA | 2680 | 1.4 % | 0.5 | 0.35 | printed: yield 2.9 % (Prusament PLA data sheet), peak 2.1 % flat / 1.1 % upright (BASF Innofil3D comparison sheet) |
| PETG | 2000 | 2.0 % | 0.4 | 0.35 | printed: yield 3.5 % (Prusament PETG data sheet); PET 3.0 / 1.3 % (Innofil3D) |
| ABS | 2000 | 1.6 % | 0.3 | 0.6 | printed: 2.4 / 0.7 % (Innofil3D); friction Bayer 0.50–0.65 × 1.2 |
| ASA | 1950 | 1.7 % | 0.4 | 0.6 | printed: 2.6 / 1.0 % (Innofil3D) |
| Nylon (unfilled) | 1200 | 4 % | 0.5 | 0.45 | typical — no printed figure; friction Bayer PA 0.30–0.40 × 1.5 |
| TPU 95A | 26 | 15 % | 0.5 | 0.6 | typical |

The strain is two-thirds of the printed yield or peak (the lower where the two sources differ), the margin Bayer
keeps for polycarbonate (4 % allowed against about 6 % at yield). The
moduli are the Strength workspace's (in the plane of the layers), so the
workspaces agree; the ids are the shared ones (`tpu` is still taken for
`tpu-95a`). Moulded figures (ABS 2.5 % in the old guides) are higher than
printed parts bear. Your filament's data sheet comes first.

### Beside the Hardware workspace

Hardware (`hw.*`) sizes holes for bought parts with an allowance added to
the diameter — 0.2 by default for screws, nuts and magnets, 0.1 for a
bearing — where Fits adds its calibration (holes print 0.2 small by
default) to a class's clearance as printed. With the defaults they agree:
an M3 clearance hole, ISO 273 medium 3.4 + 0.2, prints at 3.4 — 0.4 round
a 3 screw, Fits' free class at 3 (0.412); a 608's 22 pocket, 22.1
modelled, prints 0.1 under the bearing — a press, as Fits' press class at
22 (0.138 under) is; a magnet's pocket prints at the magnet's size, between
close and press — Hardware's hw.check calls that snug, to press in. They are not linked: after
`fit.calibrate`, set Hardware's allowances (`hw.set { allowance }`) to the
new hole offset too.

No FreeCAD or other CAD package code is used.

## Commands (`fit.*`)

These share the `fit` namespace with Calibrate from a scan (`fit-comp`)
under different verbs.

| Command | Changes | What |
|---|---|---|
| `fit.list` | nothing | Classes with their clearance at a size, materials, parts, settings, calibration |
| `fit.set` | settings | Tolerance, material, the panel's page; `reset` |
| `fit.calibrate` | calibration | From readings, offsets entered, a scanned print, or the classes felt on a coupon; `reset` |
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
The agent guide is `guide.read { topic: "fits" }`.

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
