<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Strength (FEA)

Will a printed part hold? The **Strength** workspace solves a Reverse Engineer
body under load with the finite element method. The material model is
print-aware: stiffer and stronger in its layers than across them, with the
layers' normal set by the build direction — for a body in a print setup
that sets its way up (plugins/setups), the setup's, said in the solve's
note. A result goes stale when that way up turns. A build direction set
here along one of the six axes is written to the print setup that prints
the body too (`printSetup.wrote`); one off the axes leaves the setup's to
govern, said with the `setup.set` that changes it.

The work runs on your computer, through the agent's server
(`mcp/src/extras/fea.js`):

- **Gmsh** meshes the body's STEP into quadratic tetrahedra (C3D10).
- **CalculiX** solves it, with the material written as engineering constants
  about the layers' axes (`*ORIENTATION`).
- The server reads the results back and judges each node:
  - A quadratic check in the layers on the in-layer principal stresses,
    with tension or compression strength as each has it (the same whichever
    way the part is turned in the layer).
  - The between-layer check: the pull across and the shear between the
    layers together, and compression across on its own.
- Before solving, the server reads the STEP in millimetres whatever its
  units, joins touching solids, refuses a piece that is not held or a mesh
  too large for the computer's memory, and refuses an answer that
  overflowed rather than reporting it.

Both programs come with FreeCAD (`FreeCAD.app/Contents/Resources/bin`), or
from Homebrew. They run as programs of their own, and nothing is linked into
ScanRuler. Holds and loads are sent as the triangles of the CAD faces they act
on and matched to the mesh's surface on the server, so no face numbering has
to agree between the programs.

## Using it

1. Build or import the part in Reverse Engineer.
2. In Strength:
   - Choose the body, how it is printed, the material and the safety factor
     wanted. A body with a material of its own (set in Reverse Engineer's
     body list) shows it, printed or solid; the list under it (*If none
     set*) is for a body with none.
   - Hold it by faces, either the ones selected in Reverse Engineer or the
     flat faces facing a direction.
   - Load faces with a force (N) or a pressure (MPa), and count the part's
     own weight if it matters (**Own weight**: the way it pulls).
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
| `fea.setup` | Body, build direction, material and overrides, mesh, target, own weight |
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

These are printing figures — process data, in `plugins/_shared/materials/printed.ts`
— and apply only to a body in a print setup (`plugins/_shared/setups.ts`), or
to a body with no material of its own, solved as before in the study's
material and said so. A body set with `material.set` solves in its own
material: printed as above when it is a filament in a print setup; otherwise
as the solid material, the same in every direction — its Young's modulus,
Poisson's ratio and shear modulus, judged by von Mises against its yield
strength (its ultimate where the library has no yield, said so). The page
sends those figures whole with the material's name and density (`bulk`); a
server older than the page (no `fea.bulk` feature) solves the figures but
judges them by the layer checks, and the answer says so.

Ids, labels and densities are the table Mass uses too
(`plugins/_shared/materials/`); the server's copy in `mcp/src/extras/fea.js`
is held to it, densities and printing figures both, by
`plugins/fea/tests/fea.test.ts`. `tpu` is still taken for `tpu-95a`.

## Own weight

`fea.setup { gravity: { direction, g, from } }` adds the part's weight as a
load on every element (CalculiX `*DLOAD … GRAV`, with the density in t/mm³ in
the N-mm-s units the job is written in). `g` above 1 stands for a shake or a
drop. By default the weight is what the Mass workspace weighs the body at, with
its walls, infill and calibration, spread over the solid; with
`from: "material"`, or without Mass, it is the solid material's. A cantilever
under its own weight matches wL⁴/8EI within 0.3 %.

Parts encased in the body by the Hardware workspace (`hw.masses`: a steel
magnet or nut in a sealed pocket) are a void in the mesh, so their weight is
added on its own: each part's mass, at the same g and direction, spread by
area over the walls of its pocket — the surface faces within its reach (and a
margin for the pocket's clearance) of its centre that face it. That is the
simplest load that puts the whole weight where the part bears on the print;
how it rests inside the pocket changes the stress only right at the pocket
(Saint-Venant). The answer's `gravity.mass` includes them and
`gravity.embedded` is theirs. A part whose weight isn't known is named in
the note, and so is an agent's server too old to take them (one without
the `fea.encased` feature): restarting the agent app brings the new one.

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
  apart. The same beam under its own weight against wL⁴/8EI, and as a STEP in
  inches (a `CONVERSION_BASED_UNIT`) and in metres against one in mm. The
  materials' densities and the old `tpu` name.
- `plugins/fea/tests/fea.test.ts`: the project section (own weight
  included), the colour range, and the server's materials against the shared
  table.
