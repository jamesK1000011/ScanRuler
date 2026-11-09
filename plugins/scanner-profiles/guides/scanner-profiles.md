# Scanner profiles and scan noise

Thresholds such as "worn if more than 3× the noise" need the scan's noise.
The session's `scanner` part (`plugins.scanner` in `session.state`) says
what to plan with (`noise.sigmaMm`, and `from`: the profile or the scan).
No other workspace reads it for itself: pass it on as their tolerance.

1. `scanner.noise` reads it off the open scan. It's best on a flat, matte
   part. A shiny or sprayed part reads differently, so say which.
2. For a scanner the person uses often, `scanner.add { name, noiseMm,
   note }` keeps it for every project. Put their settings in `note` (mode,
   resolution, spray). `scanner.use { name }` sets it for this project.
3. Without a profile, go by the measured noise (`scanner.use { measured:
   true }` goes back to it). With neither, say so and ask before choosing a
   tolerance.

`scanner.list` gives the profiles kept in this browser, the one this
project uses and the measured noise. The person has the same controls in
the 3D Measure panel's Scanner section. `scanner.remove { name }` drops a
profile; a project using it keeps its copy.

Don't guess a scanner's noise from its marketing figures. Measure it, or
use what the person tells you.
