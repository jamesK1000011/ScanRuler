# Generated parts

Standard parts made to size as solids, then finished in Reverse Engineer.

1. `gen.list` gives the generators (`gridfinity_bin`, `gridfinity_baseplate`, `project_box`, `board_box`), each parameter's key, kind, range and unit, and the values set now.
2. `gen.measure { generator, params }` builds without making anything and gives each part's size and volume: check before you make.
3. `gen.make { generator, params, name? }` brings the part into Reverse Engineer as bodies (an Import feature, saved with the project). The box and its lid come in as two bodies, the lid beside the box, upside down. A name already taken gets 2, 3 … after it. Builds run one at a time; `gen.stop` ends the one running and any waiting.
4. Finish it there: cut a pocket or a slot with `reverse.feature.add`, move it with `moveBody`, check it with `reverse.body.check`, and export with `reverse.export.stl` or `reverse.export.step`.
5. `gen.export { format: "step" | "stl" }` gives the file alone, without the project.

Gridfinity: 42 mm cells, 7 mm height units (base included, the 4.4 mm stacking lip on top). A bin is 0.5 mm short of the grid; a baseplate is the grid. `wall: 0` gives a solid block, ready for `reverse.feature.add` to cut a custom pocket, such as a tool's outline from `scan.outline`.

Project box: `clearance` is the gap each side between the lid's lip and the wall. 0.2 mm suits most printers, 0.3 mm for a loose fit. With `screws`, M3 bosses stand in the corners with 2.5 mm pilot holes for self-tapping screws, and the lid has 3.4 mm clearance holes.

`gen.set` sets the values the panel shows; `gen.make` and the others take the values set unless they are given.

Board enclosure (`board_box`): made round a board, which the Boards workspace gives (`pcb.enclosure`, `pcb.plan`). `gen.make { generator: "board_box", board }` takes one directly: `{ outline: [[x, y]…], thickness, above, below, holes: [{ x, y, d }], openings: [{ side, centre, width, z0, z1 }] }`, mm, the board's bottom at z = 0. `standoff` must clear the parts underneath (`below`). The screw size comes from each hole.
