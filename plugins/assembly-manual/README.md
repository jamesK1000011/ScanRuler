<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Assembly manual

Step-by-step build instructions from parts modelled in their assembled
places in Reverse Engineer.

- **Steps.** Each step lists the parts it puts in and the way each moves
  into its place. `asm.check` sweeps each part in along that move with
  OCCT, in a worker, against the parts already there. It says where one
  runs into another and how far short of its place, and which parts
  overlap where they sit. A body over 5,000 faces (a mesh brought in as a
  body) is left out of the sweep and named as not checked.
- **Parts.** `asm.parts { fromBodies: true }` adds every solid body not yet
  a part. A body still called "Solid n" is named after the feature that
  made it ("Lid"), and `body` takes that feature name too.
- **Sub-assemblies.** A step with `sub` builds one apart, drawn framed and
  numbered A1, A2…; a later step places it whole by its name.
- **Drawings.** Hidden lines are removed through the line art shared with
  patent-kit (`plugins/_shared/lineart/`). Parts already in place are
  grey; the step's own parts are black, pulled back along their moves,
  with path lines and arrows to their places and a balloon per
  bill-of-materials item. The view is chosen to show the moves, or set per
  step. A part whose body is over 5,000 faces is refused with what to do
  (rebuild it from features, or take it out of the parts) rather than
  drawn.
- **Words.** Each step's instructions are linted to a style: `ste100` (the
  default), `plain`, or `custom` from your own Markdown file, plus a
  project word list. ASD-STE100 is named, not reproduced. The linter's
  rules are its own.
- **Look.** Themes (Workshop, Picture first, Technical, Shop floor, Brick
  kit, or your own `.json` theme file with CSS) set type, colours and
  layout, with your accent colour over them. Presets (Standard, Brick kit,
  Flat-pack, Technical order) set layout, words, the parts box and a 1:1
  hardware page in one go.
- **Output.** A self-contained HTML manual, a PDF, or a zip of both with
  every page as SVG. The cover carries the bill of materials with
  designations and sources. Local only: no network requests.
- **Review.** `asm.review` holds the manual against what IEC/IEEE 82079-1
  asks instructions for use to carry, in the plugin's own words — a
  checklist, not a certificate.

## Commands (`asm.*`)

| Command | Changes | What |
|---|---|---|
| `asm.settings` | settings | Title, paper, orientation, explode, theme, layout, words, parts box |
| `asm.parts` | parts | From the bodies (or the feature that made them); designation, source, qty |
| `asm.step` | steps | Add, update, remove, move a step |
| `asm.steps` | nothing | The steps, the bill of materials, what's missing |
| `asm.check` | nothing | The sweep: hits and clashes, heavy bodies skipped, and the lint per step |
| `asm.text` | steps | Write a step's instructions, and lint them |
| `asm.style` | style | ste100, plain or custom; the word list |
| `asm.render` | nothing | A page as PNG, SVG or PDF |
| `asm.save` | nothing | HTML, PDF or a zip |
| `asm.theme` | settings | Theme files: list, import, export, remove |
| `asm.review` | nothing | The IEC/IEEE 82079-1 checklist |

The agent guide is `guide.read { id: "assembly-manual" }`.

## Layout

| Path | What |
|---|---|
| `core/assembly.ts` | Bill of materials, missing and doubled parts, the view a step is best seen from |
| `core/geometry.ts` | The sweep, and each step drawn with its lines by part |
| `core/lint.ts` | The linter and the style file |
| `core/manual.ts` | Cover, step pages, HTML |
| `core/themes.ts`, `core/themeFile.ts` | Shipped themes and presets; reading a theme file |
| `core/asmWorker.ts` | The OCCT worker |
| `tests/` | A box, a lid and four screws in the right order and the wrong one, the linter, the pages |
