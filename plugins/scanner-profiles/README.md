<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Scanner profiles

Which scanner a scan came from, and how noisy it is.

- `scanner.noise` reads the noise off the open scan. On flat ground, it
  takes each vertex's distance along its normal from its neighbours'
  centre, robustly (1.4826 × the median), corrected for the neighbours'
  own noise. It also gives the median point spacing.
- `scanner.add`, `scanner.remove` and `scanner.list` manage your profiles
  (name, noise, spacing, note), kept in this browser across projects.
  `scanner.use` sets the project's profile, kept with the project.
- Other plugins read the noise to plan with from the session's `scanner`
  part: the profile's, else the measured value.

## In the app

A **Scanner** section in the 3D Measure panel: choose the project's profile
or the measured noise, **Measure noise** on the open scan, **Save as
profile**, add a profile by hand, and remove one with its ×. Each control
runs the command above.
