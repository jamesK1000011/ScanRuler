<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Scanner profiles

Which scanner a scan came from, and how noisy it is.

- `scanner.noise` reads the noise off the open scan. On flat ground, it
  takes each vertex's distance along its normal from its neighbours'
  centre, robustly (1.4826 × the median), corrected for the neighbours'
  own noise. It also gives the median point spacing.
  The reading is kept with the project.
- `scanner.add`, `scanner.remove` and `scanner.list` manage your profiles
  (name, noise, spacing, note), kept in this browser across projects;
  `scanner.add { use: true }` also makes it the project's. A project using
  a profile you remove keeps its copy.
- `scanner.use { name }` sets the project's profile, kept with the project;
  `scanner.use { measured: true }` goes back to the measured noise.
- The noise to plan with — the profile's, else the measured value — is in
  `session.state` under `plugins.scanner` (`noise.sigmaMm` and where it
  came from), for thresholds set as a multiple of the noise. No other
  plugin reads it on its own.

## In the app

A **Scanner** section in the 3D Measure panel (`registerPanelSection`):

- **Scanner** — one of your profiles, or *Measured from the scan*; the
  noise in use is shown under it, and the measured noise and spacing once
  read. A profile the project names that isn't among yours (made in
  another browser) is shown as the project's.
- **Measure noise** reads it off the open scan; **Save as profile** opens
  *Add a profile* filled in with the reading.
- **Add a profile** — name, noise (1σ), point spacing (0 for none), note,
  and *Use it for this project*.
- Each profile in the list, with its noise; its × removes it.

Each control runs the command above.
