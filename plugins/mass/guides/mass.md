<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Weight, balance and ballast

The Mass workspace (`mass.*`) weighs Reverse Engineer bodies as they will
print. The walls count as solid and the inside is taken at the infill's
share. It gives the centre of mass and the inertia, and plans a ballast pocket
that brings the part to a target.

## Weigh it

0. A body with a material of its own (`material.set`; read the material
   guide) is weighed in it — solid, or as printed when it is in a print
   setup. What follows sets up the bodies with none, and the walls and
   infill a print setup does not give.
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
   - Parts encased in them (the Hardware workspace's: a magnet or nut
     dropped in at a pause) under `embedded`, each with its mass and
     centre, counted in the total; `embeddedMass` is theirs alone. One whose
     weight isn't known (an object without `grams`) is named in the note.
   `closed: false` means the mesh has holes, or faces wound both ways, and
   its volume isn't to be trusted.
3. **Calibrate:** `mass.calibrate { grams }` with a print of the same
   settings weighed on the scales. Every reading after that matches their
   printer and spool. Encased parts are taken off the grams first, so
   weigh it with them in. `reset: true` undoes it. With more than one body
   shown, say which was printed (`body`). A print more than 5 times off (or
   under a fifth) is refused: the settings don't match it.

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
  suits (one of them alone, and the other two sides match). The walls the
  slicer prints round the pocket are counted in the mass.
  - It says whether the pocket lies clear of the body's surface by a skin
    (the walls' thickness, 1 mm at least) and, for BBs, whether it is wide
    enough for them. If not, move the target inward, allow more mass, or
    change the shape.
  - A balance point alone can't be reached: ballast adds mass, so give the
    mass too.
  - Fillers are as packed: steel BBs at about 62 % packing (about 0.37 g
    each), lead shot, tungsten putty, tungsten cubes, a steel slug.
- `mass.apply` cuts the pocket into the body as Reverse Engineer features: a
  sketch at the pocket's floor and an extrude cut up its height, named
  "Ballast", "Ballast 2" and so on. It stays editable there. If the bodies
  changed since the plan, plan again first.
- It makes no lid. Add one (a slide-in plug, glue, or tape over BBs) and keep
  a loose filler from rattling.

## Limits

- One pocket, box-shaped. To split ballast across two pockets, plan each one
  against the target in turn.
- The balance point is read from meshes at a 0.05 mm chord, which is good to
  a hundredth of a millimetre on most parts.
- `mass.materials` lists the printed materials' densities and the ballast fillers' packed densities.
