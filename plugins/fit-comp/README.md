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

A run that fits poorly (χ²/dof over 4: warping, a lifted corner, a poor
alignment) is kept, with a warning, but its offsets are not turned into
anything: `fit.suggest`, `fit.export`, `fit.compensated_mesh` and
`fit.profiles { action: "save" }` refuse it and say what to do — look at the
outliers and the deviation map, fix the cause, measure again.

Against the scan noise to plan with — Scanner noise's, where the build has
it (the larger of the scanner's usual noise and this scan's), read through
`plugins/_shared/scanNoise.ts`, and the run's own scatter on flat faces
where that is larger — `fit.measure` adds `scanNoise`, and `nearNoise` with
`noiseNotes` for two judgements (`core/noiseCheck.ts`); the page shows them
under the run:

- an offset worth changing by its standard errors but under three times
  the noise is finer than a scan is trusted for: confirm it on a second
  print or scan before changing the slicer;
- a poor fit on a scan whose flat faces scatter well above (1.5×) the
  scanner's usual noise may be the scan's fault: rescan before blaming the
  printer.

The fit itself is unchanged: its errors come from the points read.

## The page

- **The print and its CAD** — the scan, the CAD and whether they are
  aligned; *Align in Surface Deviation* goes there to open and align it.
- **Printed on** — which way stood up, the slicer, printer, material,
  nozzle and first-layer height (the slicer values in use are set with
  `fit.settings`), and *Key maps of your own*: paste a map, or *Start from*
  the slicer chosen, *Add* to add or replace it, and remove one with its ×.
- **Measure the print** runs `fit.measure`. The run shows its fit
  (red over 4: "do not trust the offsets"), the scale on X/Y and Z, the
  outer-wall and hole offsets (marked when not separated) and the
  elephant foot; then *Slicer changes*, *Export .ini* and *Compensated
  STL* (greyed out for a poor fit), and *Compare the last two* once there
  are two runs.
- **Features read** — each flat face, hole and boss found on the CAD, read
  as an outer wall, a pocket wall or left out (`fit.tag`); measure again to
  use the change.
- **Calibration** — the printer's one calibration and where it came from;
  *Use the last run* makes the last run it when it came from elsewhere.
- **Profiles** — *Use* one, remove one, or *Save as* the last run's.

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

The agent guide is `guide.read { topic: "fit-comp" }`.

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
