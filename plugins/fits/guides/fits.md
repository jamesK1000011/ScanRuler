<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Fits for printed parts

Lengths are mm. Clearances are diametral and as printed: positive is a gap, negative is interference. Fits works out the sizes to model by adding the printer's calibrated offsets.

## Calibrate first (once per printer, material and nozzle)

1. `fit.list` gives the classes, materials, settings and calibration in use. The default offsets are holes −0.2 and shafts +0.1, typical but not measured.
2. Use `fit.set { tolerance, material }`. `tolerance` is ± what a printed size lands within (0.15 by default).
3. Use one of these to calibrate:
   - **Print fit already measured a print** (`fit.measure`, fit-comp): run `fit.calibrate { from: "print-fit" }`.
   - **Calipers**: run `fit.test { compensate: false }` and print the coupon. Measure its holes and pegs, then pass the model sizes from the answer's `rows` with what you measured: `fit.calibrate { readings: [{ kind: "hole", model, measured }, { kind: "shaft", … }] }`.
   - **By feel**: run `fit.test` (compensated). Try the gauge pin in each labelled hole and the gauge ring over each peg, then pass the label each class felt right at: `fit.calibrate { classes: { slip: 0.1, press: -0.05 } }`. The classes keep their growth with size.

## Sizing

- **Hole and shaft**: `fit.pair { nominal, class }`. It returns sizes printed and modelled, the clearance range (worst case and RSS), and the ISO 286 fit it stands in for, which is a reference only. A printer holds about IT12–IT14. For a press it also gives the hub strain against the material's limit. Use `bought: "shaft"` for a steel dowel and `bought: "hole"` for a bearing bore. That side keeps its nominal and gets no offset.
- **Classes**: `free` turns freely or is a print-in-place gap. `slip` slides by hand. `close` locates without rattle. `press` is pushed in and holds. `tight_press` is pressed in with a vise.
- **Stack**: `fit.stack { items: [{ name, nominal, sign: 1 | -1, tol | plus+minus }], min }`. It returns the worst case, RSS, which item brings the most variance, and the chance the gap falls below `min` (each tolerance taken as ±3σ). Items without a tolerance take the printer's.

## Parts (made in Reverse Engineer)

- `fit.snap {…}` works out a cantilever hook. Pass `length`, `thickness`, `width`, `undercut`, `leadAngle`, `retainAngle`, `material`, `uses: once | repeated`, and `printed: flat | upright`. It returns the root strain against the permissible strain, and the deflection, push-in and pull-out forces. A pull-out of null means the hook locks. Check that `ok` is true and keep the strain ratio under 1 before making it. If it fails, lengthen or thin the beam, or reduce the undercut. The answer gives `minLength` and `maxUndercut`.
- `fit.hinge {…}` plans a print-in-place knuckle hinge. Its `clearance` (radial) and `gap` (axial) are as printed.
- `fit.pin {…}` plans a pin and socket at a class. Use `bought: true` for a socket alone, sized for a dowel.
- `fit.apply` builds the last one planned, or `{ part, params }`, as named bodies. One undo step.
- `fit.test {…}` makes the coupon at once. `fit.file { part, params, format }` gives the STEP or STL without the project.
- With `layout: "assembled"` (snap, pin) the parts come in where they meet. Check them with `reverse.body.clearance` or `reverse.body.check`, then move them with `moveBody`.

Print a snap hook lying on its side (fit.apply lays it so), so the beam bends along its layers. A hinge prints as it lies, both leaves on the bed.

Print fit (fit-comp) shares the `fit.*` names (`fit.measure`, `fit.suggest` …). It corrects the slicer from a scanned print, while Fits sizes the model.
