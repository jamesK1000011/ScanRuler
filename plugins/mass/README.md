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
  the inside is at the infill's share. A body in a print setup
  (plugins/setups) is weighed with the walls, infill and line width the
  setup sets, where it sets them — with its own material or, with none
  set, the Mass setup's; each row's `as` says printed or solid.
- **Encased parts:** magnets, nuts, bearings and inserts the Hardware
  workspace encases or records (`hw.masses`; Generate's Gridfinity magnets
  among them) are added to the total — their mass, centre and inertia —
  and listed apart (`embedded`, `embeddedMass`). One whose weight isn't
  known (an object recorded without `grams`) is named, not counted, and a
  reading goes stale when they change.
- **Calibrating:** weigh a print and the density scales to match (less the
  encased parts).
- **Ballast:** a pocket filled with a denser filler (steel BBs, lead shot,
  tungsten), solved so that mass and balance point both reach the target,
  the walls printed round the pocket counted. It's checked to lie clear of
  the body's surface, then cut into it as Reverse Engineer
  features (sketch and extrude cut), so it stays editable there.

## The panel

Each body with its own material (set in Reverse Engineer's body list),
printed or solid; the material for a body with none (*If none set*; just
*Material* without the Materials plugin), infill, walls and line width,
then **Weigh**: the mass (and the
calibration's scale), the balance point, each body and each encased part
with its mass and centre, and the principal inertia under *Inertia*.
**Calibrate** takes the grams a print weighed (*Reset* goes back to the
material's figures). **Target and ballast**: the mass wanted and the
balance point X, Y, Z (*Set target*, *Clear*), the filler, *Plan the
ballast* — the pocket's size and place, or why it doesn't fit — and *Cut
the pocket*. The Hardware panel's *From Mass* records the pocket for its
print pause. Each control runs a command below.

## Commands

| Command | What it does |
|---|---|
| `mass.materials` | Materials' and fillers' densities |
| `mass.setup` | Material or density (for a body with none), infill, walls, line width (written to the print setup every solid body is in), filler |
| `mass.properties` | Mass, volume, area, centre of mass, inertia, principal axes; per body and together |
| `mass.calibrate` | Scale to a weighed print; `reset` |
| `mass.target` | Mass and balance point wanted; `clear` |
| `mass.ballast` | The pocket that reaches the target, and whether it fits |
| `mass.apply` | Cut it into the body as Reverse Engineer features |

The study (setup, calibration, target) is saved with the project and is part
of the undo history.

Each body is weighed in its own material when one is set (`material.set`, the
Materials plugin; the library is `plugins/_shared/materials/`): solid, or — when
the body is in a print setup (`plugins/_shared/setups.ts`) — as printed, walls
round the infill (the setup's where it gives them, else this setup's) with the
calibration. A body with no material is weighed as before, printed in this
setup's material (solid when a setup makes it some other way), and the answer's
note says what was assumed. Each row of `mass.properties` says `material`, `as`
and `density`. The filaments here are the table Strength uses too: the same
ids, labels and densities. `tpu` is still taken for `tpu-95a`, and the Strength
workspace can take its own-weight load from `mass.properties`.

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
