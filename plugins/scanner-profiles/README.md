<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Scanner noise

Which scanner a scan came from, with its usual noise, and how noisy this
scan is — and from the two, the noise to plan with. Not the *scanner
profile* of 2D Measure, which keeps a flatbed scanner's scale.

- `scanner.noise` reads this scan's noise with the scan check: `scan.qa`'s
  `noise.median`, the median scatter of small plane fits, the figure the
  scan-to-CAD guide's "nothing finer than about three times the noise" is
  written against. It does not measure noise on its own, so there is one
  noise figure for a scan, not two that disagree. It adds the median point
  spacing, which the scan check gives only for a CAD tessellation and a
  scanner's entry keeps beside its noise. A CAD tessellation is refused: it
  has no scan noise. The reading is kept with the project.
  The flat-faces-only reading this plugin used to make is gone: on a curved
  part the scan check's figure reads a little higher, which only errs safe.
- `scanner.add`, `scanner.remove` and `scanner.list` manage your scanners
  (name, usual noise, spacing, note), kept in this browser across projects;
  `scanner.add { use: true }` also names it for this project. A project
  naming a scanner you remove keeps its copy.
- `scanner.use { name }` names the project's scanner, kept with the
  project; `scanner.use { measured: true }` names none.
- **The noise to plan with** is the larger of the scanner's usual noise and
  this scan's when both are known, else whichever is. A scan is never surer
  than its scanner, and one that reads worse is worse. It warns when this
  scan reads 1.5 times its scanner's or more (a shiny part, a poor pass)
  and when no scanner is named. The rule is in
  [`_shared/scanNoise.ts`](../_shared/scanNoise.ts).
- It is in `session.state` under `plugins.scanner.noise`: `sigmaMm`,
  `source` (`profile`, the scanner's, or `measured`, this scan's), `from` in
  words, `finestMm` (three times it, the finest difference to trust),
  `profile`, `measured` and `warning`.
- Wear repair (`wear.diff`), Calibrate from a scan (`fit.measure`) and
  Thread (`thread.identify`) read it through `readScanNoise` in
  `_shared/scanNoise.ts`, without importing this plugin; a build without it
  stands, and they go by their own readings.
- The command names stay `scanner.*`, and the plugin's id, panel section,
  project key and state section are unchanged, so earlier projects open.

## In the app

A **Scanner noise** section in the 3D Measure panel (`registerPanelSection`):

- **Scanner** — one of your scanners, or *None: this scan's noise*; under
  it the noise to plan with and where it comes from, this scan's noise and
  spacing once read, and the warning when there is one. A scanner the
  project names that isn't among yours (made in another browser) is shown
  as the project's.
- **Measure noise** reads this scan's with the scan check; **Save as
  scanner** opens *Add a scanner* filled in with the reading.
- **Add a scanner** — name, usual noise (1σ), point spacing (0 for none),
  note, and *Use it for this project*.
- Each scanner in the list, with its noise; its × removes it.

Each control runs the command above.
