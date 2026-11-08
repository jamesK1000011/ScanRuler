<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Strength (FEA)

Will a printed part hold? The **Strength** workspace solves a Reverse Engineer
body under load with the finite element method. The material model is
print-aware: stiffer and stronger in its layers than across them, with the
layers' normal set by the build direction.

The work runs on your computer, through the agent's server
(`mcp/src/extras/fea.js`):

- **Gmsh** meshes the body's STEP into quadratic tetrahedra (C3D10).
- **CalculiX** solves it, with the material written as engineering constants
  about the layers' axes (`*ORIENTATION`).
- The server reads the results back and judges each node:
  - Hill's quadratic check in the layers, with tension or compression
    strength as the stress has it.
  - The between-layer check: pulled apart, or sheared.

Both programs come with FreeCAD (`FreeCAD.app/Contents/Resources/bin`), or
from Homebrew. They run as programs of their own, and nothing is linked into
ScanRuler. Holds and loads are sent as the triangles of the CAD faces they act
on and matched to the mesh's surface on the server, so no face numbering has
to agree between the programs.

## Using it

1. Build or import the part in Reverse Engineer.
2. In Strength:
   - Choose the body, how it is printed, the material and the safety factor
     wanted.
   - Hold it by faces, either the ones selected in Reverse Engineer or the
     flat faces facing a direction.
   - Load faces with a force (N) or a pressure (MPa).
3. Press **Solve**. A medium mesh takes seconds, and **Cancel** stops it.
4. Read the answer:
   - The worst safety factor, where it is, and how it fails.
   - The largest stress and movement.
   - The part coloured by safety factor, stress, displacement, stress across
     the layers, or between-layer shear.

## Commands

| Command | What it does |
|---|---|
| `fea.tools` | Whether Gmsh and CalculiX are found, and the materials |
| `fea.setup` | Body, build direction, material and overrides, mesh, target |
| `fea.hold` / `fea.load` | Faces held, faces loaded: by index, query or selection; `remove` |
| `fea.solve` / `fea.cancel` | Mesh and solve; stop |
| `fea.results` / `fea.show` | The last answer; the field on the part |
| `fea.clear` | Holds, loads, the result, or all |

Internal: `fea.answer` and `fea.progress` (the server's replies), plus Reverse
Engineer's `reverse.body.face_triangles` and `reverse.body.selected_faces`.

## Materials

The presets are PLA, PETG, ABS, ASA, PETG-CF, PA6-CF and TPU 95A. Each has
in-layer and across-layer stiffness and strength (MPa).

- The tensile figures come from Bambu Lab's datasheets (ISO 527, 100 %
  infill, X-Y and Z specimens).
- Compression, in-layer shear and Poisson's ratios are typical values.
- The between-layer shear strength is an estimate (0.6 × across-layer
  tension), because little is published.

The figures are for solid print. Use `overrides` for your own, and lower them
for thin walls and sparse infill.

## Limits

- Linear, static and small-strain only. No buckling, fatigue, creep or
  impact.
- A rigid hold over-reads the stress at its edge, so the answer also gives
  the worst found away from the holds.
- A body over a few hundred thousand elements is refused: use a coarser mesh.
- The study is saved with the project. The answer isn't, since it takes
  seconds to solve again.

## Tests

- `mcp/tests/fea.test.js`: the mesh read with its mid-side nodes in
  CalculiX's order, the input, the result file, the checks, and a PLA
  cantilever against beam theory, printed flat and then on end. The
  cantilever runs only where Gmsh and CalculiX are found. It matches beam
  theory within 0.5 %, and printed on end it fails by the layers pulling
  apart.
- `plugins/fea/tests/fea.test.ts`: the project section and the colour range.
