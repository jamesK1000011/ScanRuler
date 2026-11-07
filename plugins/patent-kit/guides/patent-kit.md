# Patent drawings and a draft for an attorney

patent-kit makes a starting draft for a patent attorney: black-and-white
line drawings with reference numerals, laid out to 37 CFR 1.84, and a draft
description tied to the same numerals. It is a draft, not a filing. Say so
to the user, and never present it as ready to file.

**Everything stays here.** The plugin makes no network request. Don't
paste the draft, the drawings or what the invention is into any other
tool, search, site or service. Not even to check prior art. The only
output is a file `patent.save` writes on this computer.

## Steps

1. **The part.** The figures are drawn from the solid bodies in Reverse
   Engineer (`reverse.*`). A scan-only part is modelled there first. A
   STEP of the user's own goes in through `reverse.import.step`. Name the
   bodies the way the patent will (`reverse.body.set`): "Housing", "Lid".
2. **Settings.** `patent.settings`: letter or A4 (ask which office), and
   `title`, what the text calls the thing ("the clamp").
3. **Figures.** `patent.figures { plan: "standard" }` gives perspective,
   front, top and right views, plus an exploded view for two or more
   bodies. Add sections where the inside matters:
   `{ kind: "section", section: { axis, offset, keep, from } }`. `from`
   is a view that looks across the cut (for a cut on y, the top view);
   the cut line is drawn there.
4. **Numerals.** `patent.numerals { assign: "bodies" }` numbers each body.
   For a feature (a hole, a rib, a face), `set: [{ label, at: [x, y, z],
   body }]` with a point on its surface. `reverse.body.describe` gives
   faces and edges to pick from. One numeral per part, the same in every
   figure.
5. **Look.** `patent.render { sheet }` returns the sheet as a picture.
   Look at it: lead lines end on the right part, nothing is crowded, the
   section reads. `notShown` says which numerals a figure couldn't show.
6. **Check.** `patent.check` lists what may miss 37 CFR 1.84. Fix what you
   can: settings, another view, a point target nearer the edge. Report
   the rest. It is a checklist for the attorney, not a guarantee.
7. **The draft.** `patent.draft { scaffold: true }` says what the detailed
   description should cover, and what only the inventor can say. Ask the
   user for those, and write only what they tell you plus what the geometry
   shows. Write numerals as `[[10]]` ("housing 10") or `[[10#]]` (10).
   `generate: "drawings"` writes the brief description of the drawings.
   Mark any claim language as a suggestion.
8. **Save.** `patent.save { path }` writes a zip: every sheet as SVG, one
   PDF, the draft as Markdown, the numerals as CSV and the checklist.

## What to tell the user

- The text is a draft for attorney review. Claims are suggested language.
- What geometry can't tell: function, materials, alternatives, what is new.
- Inventorship is a human question. The USPTO's November 2025 guidance on
  AI-assisted inventions is at 90 FR 54636; point them there and to their
  attorney.
- Drawings follow 37 CFR 1.84 as a target. The attorney or a draftsperson
  judges them.
