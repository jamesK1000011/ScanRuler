<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Printability check

On screen: step 1, **Check**, of the **Print** tab (Check → Slice → Send),
laid out as a pre-print check sheet: the verdict and findings first. Its
workspace id is still `dfm`.

Checks the part (open as the scan, the reference part, or a Reverse engineer
body as it stands now) for FDM printing,
from the Print tab's Check step or an agent.
The rules come from a pack you can read and change. Every finding gives its
place, its value against the limit, the rule, and where that rule's number
comes from. Profiles stack in this order: the default pack, then a nozzle, a
material, a printer, and finally the project's own changes. Each parameter
says which layer set it.

## Checks

| Rule | Reads |
|---|---|
| thin-wall | the scan's wall thickness map (the worker's thickness measure); on a body or the reference part, rays into the material from samples over the faces (core/wall.ts) — where the far face leans 26.6° or more, a taper to a sharp edge, reported as info |
| overhang | faces leaning past the angle, and flat undersides held up on one side only |
| bridge | flat ceilings held on both sides, by their narrowest span (convex-hull width) |
| small-hole | upright round holes, by circle fit |
| bed-contact | flat area on the bed over the footprint's convex-hull area |
| tall-thin | height over the base's least width |
| trapped-volume | closed shells with negative signed volume (cavities) |
| mesh-health | edges not shared by exactly two triangles |

## Commands (`dfm.*`)

| Command | Changes | What |
|---|---|---|
| `dfm.settings` | settings | Nozzle, material, printer, up axis, scan, reference or body |
| `dfm.profiles` | nothing | The pack and the profiles there are |
| `dfm.rules` | the project's rules | The rules in force and which layer set each number; set or clear the project's own change |
| `dfm.check` | findings | Runs the checks |
| `dfm.explain` | nothing | One finding with its rule in full |
| `dfm.waive` | waivers | Accepts a finding with a reason, kept with the project |
| `dfm.report` | nothing | Markdown or JSON |
| `dfm.guides` | imported guides | List, compare side by side, import, export, remove published guides |
| `dfm.considerations` | nothing | The design-review questions no rule measures, each naming the rule that checks it or that it is the person's call |

The agent guide is `guide.read { id: "dfm-fdm" }`.

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

Pick nozzle, material, printer and guide; click a rule to change its
numbers for this project or switch it off (Reset takes it back); click a
finding to turn the view to it, or waive it with a reason. *Beyond the
numbers* lists the review questions, after ISO/ASTM 52910 (named, not
reproduced).
