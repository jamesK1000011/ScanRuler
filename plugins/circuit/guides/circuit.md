# Circuit boards with tscircuit

Boards written as code with tscircuit (React components in a `.tsx` file), built on this computer by its command line, `tsci`, through the agent's server, then read back from their Circuit JSON.

## Install tscircuit (once, on the Mac)

1. Node.js: from nodejs.org, or `brew install node`.
2. In Terminal: `npm install -g tscircuit` (with Bun: `bun install --global tscircuit`).
3. Check: `tsci --help` lists `build` and `export`.
4. `circuit.tools` should then say `ready: true` with the version. If it says not found though `which tsci` finds it, set `SCANRULER_TSCI` to that path in the agent app's server settings and restart the app. With only Bun installed it runs through `bunx tscircuit`, which may fetch it first.

## The workflow

1. `circuit.tools` — is `tsci` there, which flags and export formats it lists, the templates and their values.
2. `circuit.new { name, template, params }` — a project folder (package.json, tsconfig.json, index.circuit.tsx) in `~/.scanruler/circuits/`: `blank` (a board, M3 corner holes), `led` (header, resistor sized from `supply`, `current`, `vf`, LED), `pico_carrier` / `esp32_carrier` (sockets for the module board, a power LED — check the row spacing and the 3V3/GND pins against your board), `enclosure` (inside size less `clearance`, corners rounded, notched round `keepouts` circles). `fromBox: true` takes the inside and the screw bosses from Generate's project box as set (`gen.set`), both centred on the origin.
3. Edit `index.circuit.tsx` (the person can run `tsci dev` in that folder to see it live). Positions are mm from the board's centre: `pcbX`, `pcbY`; footprints as strings (`"0603"`, `"soic8"`); `<trace from=".R1 > .pin2" to=".LED1 > .anode" />`.
4. `circuit.build { outputs }` — `tsci build`, then `tsci export` from its circuit.json, into a job folder: `gerbers` (zip), `bom`, `pnp` (from the Gerbers zip), `kicad_pcb`, `step`, `glb`, `pcb_svg`, `schematic_svg`, `netlist`. It opens the board built. Read `summary.errors` / the answer's `errors`: DRC, routing and placement errors are the build's own. A flag or format the installed `tsci` lacks is refused by name — update tscircuit rather than work round it. `routing: false` skips the autorouter (fast, unrouted); `partsEngine: false` works offline.
5. `circuit.stats` — size, layers, traces, narrowest trace, least clearance between nets (with what it is between), smallest drill, nets. Computed from the JSON, not tscircuit's DRC: both are worth reading.
6. `circuit.bodies` — the board into Reverse Engineer: "Board" on z = 0 to its thickness, "Copper top N" on its top face, "Copper bottom N" under it (one body per island of copper), "Keep-out <part>" boxes. Then design the enclosure round it there: `reverse.body.clearance` against the keep-outs, cut standoffs and openings with `reverse.feature.add`.
7. `circuit.resistance { conductor, thickness }` — each net's traces end to end: `copper` (1 oz, 35 µm by default), or printed `protopasta` (~30 Ω·cm along layers, ~115 across) and `electrifi` (~0.006 Ω·cm) at a printed height (0.6 mm by default). The printed figures are typical, not measured: say so when you quote them.

## Notes

- KiCad: `outputs: ["kicad_pcb"]` writes `board.kicad_pcb` in the job folder; open it in KiCad, or in the Boards workspace: `pcb.open { path }` with the answer's `files["board.kicad_pcb"]`, then `pcb.enclosure` for a box round it and `pcb.fab` for the fab package.
- `circuit.files` lists projects and builds; `circuit.open { path }` opens any circuit.json in one, `{ json }` one given as text.
- Inner layers are counted but not built as solids. Silkscreen and BREP pours are read and counted, not built.
- Saved with the project: the settings, the project folder, the last build, the open board's circuit.json.
- `circuit.set` picks the conductor and trace thickness for `circuit.resistance`, and the copper solids' thickness; `circuit.clear` puts the open board away (its bodies stay); `circuit.stop` stops a build or the solids being made.
