<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Printability check

On screen: step 1, **Check**, of a print setup on the **Make** tab (Check →
Slice → Send; the tab was Print), laid out as a pre-print check sheet: the
verdict and findings first. Its workspace id is still `dfm`.

Checks the part (open as the scan, the reference part, or a Reverse engineer
body as it stands now) for FDM printing,
from a print setup's Check step or an agent. A body is meshed at each check,
so edits since are read; it is named by `dfm.settings { body }`, else the
one solid body shown. A reference part made with Compare in Deviation
records the bodies it came from: checked after one of them has changed, the
answer says it checked an older copy (`stale`, a warning in the panel and
the report).
The rules come from a pack you can read and change. Every finding gives its
place, its value against the limit, the rule, and where that rule's number
comes from. Profiles stack in this order: the default pack, then a nozzle, a
material, a printer, and finally the project's own changes. Each parameter
says which layer set it.

## Checks

| Rule | Reads |
|---|---|
| thin-wall | the scan's wall thickness map (the worker's thickness measure); on a body or the reference part, rays into the material from samples over the faces (core/wall.ts). Thinner than one extrusion line (`lineMm`: the nozzle, or a profile's line width) is an error; from one line up to the minimum wall (`minMm`, two lines) a warning, as it prints as a single line. Where the far face leans 26.6° or more, a taper to a sharp edge, reported as info |
| overhang | faces leaning past the angle, and the part of a flat underside no bridge reaches across (held on one side, or at a corner only) |
| bridge | flat ceilings: through each place, the shortest straight line in plan from a wall going down to the one opposite; the longest of those is the span |
| small-hole | upright round holes, by circle fit |
| bed-contact | flat area on the bed over the footprint's convex-hull area |
| tall-thin | height over the base's least width |
| trapped-volume | closed shells with negative signed volume (cavities) |
| mesh-health | edges not shared by exactly two triangles |

On a body or the reference part the answer's `wall` gives the thinnest
wall read, where, one line (`line`), the limit and `level` (`under one
line` or `single line`), with the sharp edges apart; a uniformly thin skin
under one line is an error, one of a single line a warning. A rule that can't run on the part says so in
`skipped`. A part that is open but not drawn yet answers `busy` while it
opens and `invalid_state` after; `unavailable` is kept for a session with
no viewport.

A body in a print setup (`setup.of`; plugins/setups) is checked with what
that setup sets of its nozzle, printer and way up, over `dfm.settings`;
the answer's `setup` names it and what it set. A profile the setup names
that Check has not is said in `setup.notes`, and Check's own is used.

## Commands (`dfm.*`)

| Command | Changes | What |
|---|---|---|
| `dfm.settings` | settings | Nozzle, material, printer, up axis, scan, reference or body |
| `dfm.profiles` | nothing | The pack and the profiles there are |
| `dfm.rules` | the project's rules | The rules in force and which layer set each number; set or clear the project's own change |
| `dfm.check` | findings | Runs the checks |
| `dfm.wall` | nothing | The least wall of a body alone, however the part is made — what `part.review` reads for a part not printed |
| `dfm.explain` | nothing | One finding with its rule in full |
| `dfm.waive` | waivers | Accepts a finding with a reason, kept with the project |
| `dfm.report` | nothing | Markdown or JSON |
| `dfm.guides` | imported guides | List, compare side by side, import, export, remove published guides |
| `dfm.considerations` | nothing | The design-review questions no rule measures, each naming the rule that checks it or that it is the person's call |

The agent guide is `guide.read { topic: "dfm-fdm" }`.

## Rules and profiles

- `rules/fdm-default.json` is the pack.
- `rules/nozzles/`, `rules/materials/` and `rules/printers/` hold profiles,
  each a set of overrides by rule id.
- Add a JSON file to any of them for your own.
- The numbers are rules of thumb, and each rule's `source` says so. No
  standard's text is copied.

## Guides

`rules/guides/*.json`: one published design guide each — publisher, url, the date read, the figures it gives, and the ones a check uses as overrides. Stacked last, before the project's own changes. A guide can be imported into a project (`dfm.guides { action: "import" }`), or the rules in force exported as one; `core/rules.ts` `validateGuide` says what it must hold. The panel compares the guides on the stage, topic by topic, with the spread where they disagree — no guide is a standard.

## In the panel

**Check** runs it; the verdict and findings come first, with the thinnest
wall and, when the reference is an older copy of a body, the warning. Click
a finding to turn the view to it, read why, or *Waive…* it with a reason
(*Unwaive* takes it back). *Printed on*: which way stands up, nozzle,
material, printer and guide, and what to check — *The scan*, *The
reference part* or *A body*, picked
in *Body* from the solid bodies shown (the only one by default). Click a rule in *Rules in force* to change its
numbers for this project or switch it off (Reset takes it back). *Guides*:
*Compare on the stage*, *Import JSON…*, *Export rules*, and remove an
imported one. *Design review* — *Show the questions* — lists the review
questions no rule measures, after ISO/ASTM 52910 (named, not reproduced).
*Save the report (.md)* writes it out.
