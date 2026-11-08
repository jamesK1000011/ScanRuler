<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Mass and balance

What a printed part weighs, where it balances and how it turns, from its
Reverse Engineer bodies, plus the ballast that brings it to a target mass and
balance point. Useful for a training replica that must feel like the real
thing, a handle that has to sit right in the hand, or a counterweight.

- **Weighing:** Eberly's polyhedral mass properties over each body's mesh give
  volume, centre of mass and inertia. The walls are a layer of
  walls × line width on the surface, at full density, and the inside is at
  the infill's share.
- **Calibrating:** weigh a print and the density scales to match.
- **Ballast:** a pocket filled with a denser filler (steel BBs, lead shot,
  tungsten), solved so that mass and balance point both reach the target.
  It's checked to fit inside the body, then cut into it as Reverse Engineer
  features (sketch and extrude cut), so it stays editable there.

## Commands

| Command | What it does |
|---|---|
| `mass.materials` | Materials' and fillers' densities |
| `mass.setup` | Material or density, infill, walls, line width, filler |
| `mass.properties` | Mass, volume, area, centre of mass, inertia, principal axes; per body and together |
| `mass.calibrate` | Scale to a weighed print; `reset` |
| `mass.target` | Mass and balance point wanted; `clear` |
| `mass.ballast` | The pocket that reaches the target, and whether it fits |
| `mass.apply` | Cut it into the body as Reverse Engineer features |

The study (setup, calibration, target) is saved with the project and is part
of the undo history.

## Tests

`tests/mass.test.ts` checks:
- a box's mass, centre and inertia against the closed form;
- a sphere within its tessellation;
- walls and infill between hollow and solid;
- inside-out meshes;
- parts combined by the parallel-axis rule;
- the ballast landing exactly on the target;
- binary STL reading.
