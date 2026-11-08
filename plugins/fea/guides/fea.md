<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Checking a printed part's strength

The FEA workspace (`fea.*`) solves a Reverse Engineer body under load on the
person's computer: Gmsh meshes it into quadratic tetrahedra and CalculiX
solves it, through the agent's server. `fea.tools` says whether both are
found. FreeCAD ships both.

## 1. Set it up

- `fea.setup { body, build, material }`. **build** is the way the layers
  stack, in the part's frame: "+z" printed as it stands, "+x" stood on its
  −X end. Ask how it will be printed. If they haven't decided, solving it
  two ways is the answer to "which way up?".
- Materials: pla, petg, abs, asa, petg-cf, pa6-cf, tpu-95a. In-layer and
  across-layer stiffness and tensile strength come from Bambu Lab
  datasheets. The between-layer shear strength (`Sz`) is an estimate,
  0.6 × the across-layer tensile strength, because little is published.
  Put the person's own figures in `overrides` (MPa). TPU is linear here, so
  read it as a rough guide only.
- The figures are for solid print (100 % infill). For a part printed with
  thin walls and sparse infill, lower `Exy`, `Ez` and the strengths, or say
  the result is for solid.

## 2. Hold and load it

- `fea.hold { faces | where | selected: true }`: faces held still, such as
  bolted, clamped or glued. A rigid hold is stiffer than any real mount, so
  stress at its edges reads high.
- `fea.load { …faces, force: [x, y, z] }` in N, the whole force spread over
  the faces by area, or `pressure` in MPa pushing on them. 1 kg ≈ 9.8 N;
  1 bar = 0.1 MPa.
- Name faces by index (`reverse.body.describe`), by query (`where`, e.g.
  `{ kind: "plane", between: [[-1, 0, 0]], withinDeg: 5 }` for flat faces
  facing −X), or `selected: true` for what the person selected in Reverse
  Engineer.

## 3. Solve and read it

- `fea.solve` returns the worst **safety factor** and where it is: below 1
  it breaks, and `target` (2 by default) is what the person wants. **mode**
  says how it fails:
  - *in the layers*: the in-layer stresses.
  - *layers pulled apart*: tension across the layers (with any shear).
  - *layers sheared*: shear between the layers (with any tension).
  - *layers crushed*: compression across the layers.
- When the worst spot is on a hold (`atAHold`) or a load (`atALoad`),
  `awayFromHolds` gives the worst clear of both. Report both, and say the
  first figure is pessimistic.
- `warnings` says what to tell the person: part of a hold or load not found
  on the mesh, faces in two loads, large strain or movement (a linear answer
  only roughly holds), or no stress at all.
- `vonMises` (MPa) and `displacement` (mm) are the largest anywhere.
- `fea.show { field }` colours the part, and `view.render` pictures it.
  Fields: safety, vonMises, displacement, across (pull across the layers),
  shear (between the layers).
- To check the mesh is fine enough, solve again finer (`fineness: "fine"`).
  If the worst figure moves more than about 10 %, it wasn't.

## Advice from it

- If the layers fail first, turn the part so the load runs along the
  layers. Compare build directions.
- If it fails in the layers, add material where the stress is: a thicker
  wall, a rib, a fillet at the corner.
- Linear and static only: no buckling, no fatigue, no creep (PLA creeps
  under steady load), and no impact. Say so whenever these apply.
