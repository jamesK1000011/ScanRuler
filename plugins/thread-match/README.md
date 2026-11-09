<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Thread match

Names a scanned thread against ISO metric, UNC, UNF, UNEF, NPT, G (BSPP),
R (BSPT), metric trapezoidal, ACME and ScanRuler's 45° print form. It answers
in one of three ways:

- a match, with high or low confidence
- *ambiguous*: the sizes this scan can't tell apart, plus the hand measurement
  that would, and what each candidate would read
- none

It reads through the Reverse Engineer's `reverse.thread.read`, then folds the
scan's points along the helix. The fold gives a sharper pitch, the flank
angle, the taper, the hand and the number of starts.

## In the app

A **Thread** section in the 3D Measure panel (`registerPanelSection`):

- **Cylinder** — a cylinder fitted in the threaded bore or on the boss (the
  last one fitted by default); **Identify** names its thread. A match shows
  the size, its confidence, form, major diameter, pitch (threads per inch
  for inch sizes) and taper; a tie shows the sizes it can't tell apart and
  the measurement that settles it, with what each would read; and either
  way, what the scan reads (diameter, pitch, a left hand, several starts)
  and the sizes set aside by the flank angle, taper or tooth depth.
- **Look up** a size by name (M6x1, 1/4-20 UNC, G 1/2): major diameter,
  pitch, minor diameters for the bolt and the nut, a tap drill, flank
  angle, taper and the standard.
- *Families and settings* — the families tried, the pitch floor (%), and
  **Reset**.

Each control runs the command below.

## Commands (`thread.*`)

| Command | Changes | What |
|---|---|---|
| `thread.identify` | nothing | The verdict, the reads, the tie, the deciding measurement, and the Reverse thread feature when it can be modelled |
| `thread.standards` | nothing | Families and designations |
| `thread.lookup` | nothing | One size's basic dimensions |
| `thread.settings` | settings | Default families; `pitchFloor` (scanner scale error); `reset` |

The agent guide is `guide.read { id: "thread-match" }`.

## Layout

| Path | What |
|---|---|
| `core/tables.ts` | The families' sizes: dimensions only, each family naming its standard |
| `core/shape.ts` | The helix fold: pitch, hand, starts, tooth, flank angle and taper |
| `core/decide.ts` | Scoring, the verdict, ties and deciding measurements |
| `core/identify.ts` | Combines `reverse.thread.read`'s answer with the fold |
| `app/threadCommands.ts` | The commands |
| `tests/` | Synthetic scanned threads for each family, including the close pairs |
| `scripts/e2e-agent-thread.mjs` | Drives it through scanruler-mcp end to end |

It needs the Reverse Engineer plugin for `thread.identify`. To pin an answer or a question on the part, the agent uses `reverse.note.add`.
`thread.standards` and `thread.lookup` work without it.
