<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Print fit — Calibrate from a scan

The Fits tab's second page, beside Design (`fits`). Its workspace id is
`fit-scan`; `workspace.set { workspace: "fits" }` opens the tab.

Reads a scanned print against the CAD it was printed from and fits what the
printer did:

- scale on X, Y and Z
- the contour offset (outer walls too far out)
- the hole offset (holes too small)
- the elephant foot

It turns these into settings for OrcaSlicer, Bambu Studio or PrusaSlicer,
added to the values in use, or into a pre-compensated model. The Deviation
workspace opens and aligns the two parts. fit-comp reads the reference's
flat walls, floors and tops and its upright holes and bosses on the scan,
then solves one weighted least-squares fit over all of them. Each answer
comes with its standard error and says whether this part can separate it.

The printer has one calibration, the one Fits sizes holes and shafts with:
a run of `fit.measure` that fits well (χ²/dof up to 4, hole and contour
offsets separated) becomes it, through `fit.calibrate { from: "print-fit" }`
in the same step — calibrate once, from a scan or from Fits' test coupon,
and both read the same offsets.

## Commands (`fit.*`)

| Command | Changes | What |
|---|---|---|
| `fit.settings` | settings | Up axis, read band, first-layer height, slicer, what it was printed on, the slicer values in use |
| `fit.features` | nothing | The walls, floors, holes and bosses read on the reference |
| `fit.tag` | settings | Tags walls `inner` (pockets) or features `ignore` |
| `fit.measure` | a run | Scale, offsets, elephant foot, their errors, χ²/dof, outliers |
| `fit.suggest` | nothing | What's worth changing, and the slicer's new values |
| `fit.export` | nothing | The settings as an `.ini` fragment or JSON |
| `fit.compensated_mesh` | nothing | The reference pre-distorted, as an STL |
| `fit.runs` | nothing | Runs kept with the project; `compare` the last two |
| `fit.profiles` | profiles | Named correction sets per printer, material and nozzle |
| `fit.keymaps` | key maps | Your own slicer key maps beside the built-in ones |

The agent guide is `guide.read { id: "fit-comp" }`.

## Slicer key maps

`keymaps/*.json` map each correction to a slicer key and say how its value
changes:

- `add`, with a sign
- `percentMeasured`: OrcaSlicer's filament shrink
- `percentShrink`: PrusaSlicer's shrinkage compensation
- `objectScale`: scale the object in the slicer
- `unsupported`

Add a JSON file here, or use `fit.keymaps { action: "add" }` for a map kept
with the project.

## Layout

| Path | What |
|---|---|
| `core/frame.ts` | The build frame: which way was up on the printer |
| `core/features.ts` | Axis-square faces and upright circles on the reference |
| `core/measure.ts` | The scan read against each one, with standard errors |
| `core/solve.ts` | The weighted fit, its priors, outliers and χ² |
| `core/suggest.ts` | What's worth changing; slicer values; the `.ini` fragment |
| `core/compensate.ts` | The pre-compensated model |
| `app/` | Commands, the reference and scan in the build frame, the project section |
| `tests/` | A plate printed with known errors, read back |
| `scripts/e2e-agent-fit.mjs` | Drives it through scanruler-mcp end to end |
