<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Printability check

Checks the part (open as the scan, or the reference part) for FDM printing.
The rules come from a pack you can read and change. Every finding gives its
place, its value against the limit, the rule, and where that rule's number
comes from. Profiles stack in this order: the default pack, then a nozzle, a
material, a printer, and finally the project's own changes. Each parameter
says which layer set it.

## Checks

| Rule | Reads |
|---|---|
| thin-wall | the scan's wall thickness map (the worker's thickness measure) |
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
| `dfm.settings` | settings | Nozzle, material, printer, up axis, scan or reference |
| `dfm.profiles` | nothing | The pack and the profiles there are |
| `dfm.rules` | the project's rules | The rules in force and which layer set each number; set or clear the project's own change |
| `dfm.check` | findings | Runs the checks |
| `dfm.explain` | nothing | One finding with its rule in full |
| `dfm.waive` | waivers | Accepts a finding with a reason, kept with the project |
| `dfm.report` | nothing | Markdown or JSON |

The agent guide is `guide.read { id: "dfm-fdm" }`.

## Rules and profiles

- `rules/fdm-default.json` is the pack.
- `rules/nozzles/`, `rules/materials/` and `rules/printers/` hold profiles,
  each a set of overrides by rule id.
- Add a JSON file to any of them for your own.
- The numbers are rules of thumb, and each rule's `source` says so. No
  standard's text is copied.

## Guides

`rules/guides/*.json`: one published design guide each — publisher, url, the date read, the figures it gives, and the ones a check uses as overrides. Stacked last, before the project's own changes. A guide can be imported into a project (`dfm.guides { action: "import" }`); `core/rules.ts` `validateGuide` says what it must hold.
