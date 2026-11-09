# Scanner noise

Thresholds such as "worn if more than 3× the noise" need the scan's noise.
The session's `scanner` part (`plugins.scanner.noise` in `session.state`)
says what to plan with: `sigmaMm`, `source` (`profile`: the scanner's usual
noise; `measured`: this scan's), `from`, `finestMm` (3 × `sigmaMm`) and a
`warning` when there is one. It is the larger of the scanner's usual noise
and this scan's. Not 2D Measure's scanner profiles, which are a flatbed's
scale.

1. `scanner.noise` reads this scan's noise with the scan check — the same
   figure as `scan_qa`'s `noise.median` — and the point spacing. It's best
   on a flat, matte part. A shiny or sprayed part reads differently, so say
   which.
2. For a scanner the person uses often, `scanner.add { name, noiseMm,
   note }` keeps its usual noise for every project. Put their settings in
   `note` (mode, resolution, spray). `scanner.use { name }` names it for
   this project.
3. Read the `warning`, and say it to the person:
   - **this scan reads well above its scanner** — worse than the scanner
     usually gives (a shiny part, a poor pass). The plan already goes by the
     scan's; offer a rescan before reading fine detail.
   - **no scanner is set** — one scan's reading is all there is, and a scan
     that happens to read clean is trusted further than the scanner
     deserves. Ask which scanner it was, and its usual noise if they know
     it.
   With neither figure, say so and ask before choosing a tolerance.

**Scan to CAD.** The scan-to-CAD guide's noise floor — "nothing is
trustworthy finer than about 3 σ_scan", σ_scan being `scan_qa`'s noise —
takes `plugins.scanner.noise.sigmaMm` as σ_scan when it is larger: use
`finestMm` as the floor for tolerances, form errors, relations accepted
from the scan and small angles. A scan that reads cleaner than its scanner
does not make the scanner better.

Wear repair (`wear.diff`), Calibrate from a scan (`fit.measure`) and Thread
(`thread.identify`) read it themselves and say so in their answers
(`scanNoise`); they need nothing passed. Other workspaces don't read it:
pass `finestMm` on as their tolerance.

`scanner.list` gives the scanners kept in this browser, the one this
project names and the measured noise. The person has the same controls in
the 3D Measure panel's Scanner noise section. `scanner.remove { name }`
drops a scanner; a project naming it keeps its copy.

Don't guess a scanner's noise from its marketing figures. Measure it, or
use what the person tells you.
