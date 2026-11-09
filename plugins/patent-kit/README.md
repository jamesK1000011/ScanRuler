<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Patent kit

A starting draft to take to a patent attorney, from the bodies in Reverse
Engineer: black-and-white line drawings with reference numerals, laid out
to 37 CFR 1.84, and a draft description tied to the same numerals.

- **Drawings.** Hidden lines are removed by OCCT (HLRBRep, through
  occt-wasm) in a worker of its own. Views come named or from any
  direction, plus exploded views and sections hatched by part with the cut
  line shown. Lead lines are placed round each figure so they don't cross.
  Sheets are letter or A4 within the 1.84(g) margins.
- **Numerals.** Each body, or a point on one, gets a numeral, the same in
  every figure and paragraph. A body renamed in Reverse Engineer takes its
  numeral with it.
- **Draft.** Sections from field to abstract. Numerals are written as
  tokens, so a rename rewrites the text. Every section is marked a draft
  for attorney review.
- **Checklist.** 37 CFR 1.84, as a target, not a guarantee. The
  shortest-edge check (1.84(k)(1), legible at a 2/3 reduction) joins the
  pieces of an edge the hidden-line pass split and ignores kernel scraps
  under 0.1 mm, so it no longer reports 0.00 mm.
- **Specification.** The draft laid out as 37 CFR 1.52 and 1.77 ask —
  margins, 1½ spacing, paragraphs numbered [0001], claims and abstract on
  new pages — as a PDF.
- **Stays here.** No network requests, and a test checks the source. The
  only output is the file `patent.save` writes.

## Commands (`patent.*`)

| Command | Changes | What |
|---|---|---|
| `patent.settings` | settings | Paper, hidden lines, text heights, figures per sheet, numbering, title |
| `patent.figures` | figures | Plan, add, update, remove, move |
| `patent.numerals` | numerals | Number bodies, set points, remove, renumber |
| `patent.render` | nothing | One sheet as PNG, SVG or PDF |
| `patent.check` | nothing | The 37 CFR 1.84 checklist |
| `patent.draft` | draft | Read and write sections; the brief description; a scaffold |
| `patent.save` | nothing | A zip, the drawings PDF, the specification PDF or the Markdown, to save locally |

The agent guide is `guide.read { topic: "patent-kit" }`.

## Layout

| Path | What |
|---|---|
| `../_shared/lineart/` | Views, HLR to polylines, sheets as SVG, PDF and PNG; shared with assembly-manual |
| `../_shared/zip.ts` | A stored zip |
| `core/drawings.ts` | Figures from STEP: HLR, sections, explode, where lead lines end, the shortest edge |
| `core/layout.ts` | Sheets: margins, scale, numerals, lead lines, hatching, cut lines |
| `core/rules.ts` | The 37 CFR 1.84 checklist |
| `core/draft.ts` | Numeral tokens, the brief description, Markdown |
| `core/hlrWorker.ts` | The OCCT worker |
| `tests/` | HLR edge counts, a section's hatching, a full layout, renames, no network |
