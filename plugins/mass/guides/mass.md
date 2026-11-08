<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Weight, balance and ballast

The Mass workspace (`mass.*`) weighs Reverse Engineer bodies as they will
print. The walls count as solid and the inside is taken at the infill's
share. It gives the centre of mass and the inertia, and plans a ballast pocket
that brings the part to a target.

## Weigh it

1. `mass.setup { material, infill, walls, lineMm }`. Ask what they print with,
   or take their slicer profile: infill in percent, walls as line count, line
   width in mm (0.42 for a 0.4 mm nozzle). `density` in g/cm³ overrides the
   material's.
2. `mass.properties` (all the shown bodies, or `bodies`). It gives:
   - Each body's mass (g), volume and area.
   - The centre of mass (mm).
   - The inertia about the centre of mass (g·mm²), with principal moments
     and axes.
   - The bodies together.
   `closed: false` means the mesh has holes and its volume isn't to be
   trusted.
3. **Calibrate:** `mass.calibrate { grams }` with a print of the same
   settings weighed on the scales. Every reading after that matches their
   printer and spool. `reset: true` undoes it.

The walls are modelled as a layer on every surface, so top and bottom skins
count like walls. Slicers print gyroid or grid infill a little heavier than
its percent suggests. Calibrating takes care of both.

## Match a target

- `mass.target { mass, com }`: the real thing's mass (g) and balance point
  (mm, in the part's frame). For a training replica, weigh the real one and
  find where it balances on a knife edge along each axis.
- `mass.ballast { filler, width?, depth? }` solves for the pocket's volume
  and centre so that both the mass and the balance point land on the target.
  The pocket is a cube by default; give `width` and `depth` and the height
  suits.
  - It says whether the pocket fits inside the body with a 1 mm skin. If it
    doesn't, move the target inward, allow more mass, or change the shape.
  - Fillers are as packed: steel BBs at about 62 % packing (about 0.37 g
    each), lead shot, tungsten putty, tungsten cubes, a steel slug.
- `mass.apply` cuts the pocket into the body as Reverse Engineer features: a
  sketch at the pocket's floor and an extrude cut up its height. It stays
  editable there.
- It makes no lid. Add one (a slide-in plug, glue, or tape over BBs) and keep
  a loose filler from rattling.

## Limits

- One pocket, box-shaped. To split ballast across two pockets, plan each one
  against the target in turn.
- The balance point is read from meshes at a 0.05 mm chord, which is good to
  a hundredth of a millimetre on most parts.
