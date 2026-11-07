# Scanner profiles and scan noise

Thresholds such as "worn if more than 3× the noise" need the scan's noise.
The session's `scanner` part says what to plan with (`noise.sigmaMm`).

1. `scanner.noise` reads it off the open scan. It's best on a flat, matte
   part. A shiny or sprayed part reads differently, so say which.
2. For a scanner the person uses often, `scanner.add { name, noiseMm,
   note }` keeps it for every project. Put their settings in `note` (mode,
   resolution, spray). `scanner.use { name }` sets it for this project.
3. Without a profile, plugins go by the measured noise. With neither, say
   so and ask before choosing a tolerance.

Don't guess a scanner's noise from its marketing figures. Measure it, or
use what the person tells you.
