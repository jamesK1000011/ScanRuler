<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Mass and balance

What a printed part weighs, where it balances and how it turns, from its
Reverse Engineer bodies, plus the ballast that brings it to a target mass and
balance point. Useful for a training replica that must feel like the real
thing, a handle that has to sit right in the hand, or a counterweight.

- **Weighing:** Eberly's polyhedral mass properties over each body's mesh give
  volume, centre of mass and inertia. The walls are a layer of
  walls × line width inside the surface, at full density (each face's slab,
  less the overlap at convex edges and plus the gap at concave ones), and
  the inside is at the infill's share.
- **Encased parts:** magnets, nuts, bearings and inserts the Hardware
  workspace encases (`hw.masses`) are added to the total — their mass,
  centre and inertia — and listed apart.
- **Calibrating:** weigh a print and the density scales to match (less the
  encased parts).
- **Ballast:** a pocket filled with a denser filler (steel BBs, lead shot,
  tungsten), solved so that mass and balance point both reach the target,
  the walls printed round the pocket counted. It's checked to lie clear of
  the body's surface, then cut into it as Reverse Engineer
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

The materials are the table Strength uses too (`plugins/_shared/materials.ts`):
the same ids, labels and densities. `tpu` is still taken for `tpu-95a`, and the
Strength workspace can take its own-weight load from `mass.properties`.

## Tests

`tests/mass.test.ts` checks:
- a box's and a cylinder's mass, centre and inertia against the closed form,
  and a turned box's principal moments and axes;
- a sphere within its tessellation;
- hollow boxes and a hollow sphere against their exact shells, and walls
  and infill between hollow and solid;
- holes, faces wound both ways, padded and broken STL files;
- walls in an L-shaped part; the pocket clear of the surface of an E-shaped
  one, and its size;
- inside-out meshes;
- parts combined by the parallel-axis rule;
- the ballast landing exactly on the target, its walls counted;
- binary STL reading;
- the setup through a project save and load.

`tests/massCommands.test.ts` runs the commands against a faked Reverse
Engineer: a body named twice weighed once, calibration in one step and in
range, a target with a part dropped, a plan made again when the body has
changed, a pocket too narrow for BBs, feature names that don't collide, a
stale plan refused, and weighings that overlap.
