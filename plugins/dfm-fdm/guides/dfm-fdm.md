<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Checking a part for FDM printing

`dfm.check` reads the part open as the scan (or the reference part) for
what goes wrong on an FDM printer. Every finding says:

- where it is
- how much, against which limit
- which rule it broke

Every rule says where its number comes from, and which profile set it.
Nothing is a hidden constant.

## Workflow

1. `dfm.settings`: set the nozzle (0.4 by default), the material and the
   printer if the person said them, and `up` if the part isn't printed the
   way it is modelled. Profiles stack: default, then nozzle, then material,
   then printer, then the project's own changes. A printer profile (`h2d`
   for the Bambu Lab H2D) also sets the build volume: a part too big is an
   error, and one wider than both H2D nozzles reach is a warning.
2. `dfm.check`. Read the verdict, then the findings in order: errors, then
   warnings, then notes.
3. For each finding, tell the person what and where in one line, using its
   `says`. If they ask why, use `dfm.explain { id }`: the rule, its
   parameters, which profile set each, and its source.
4. Something done on purpose (a hole drilled after printing, a brim
   planned, a bridge the printer handles)? Use `dfm.waive { id, reason }`.
   The waiver stays with the project, and the next check shows that finding
   as waived.
5. A rule wrong for this printer? Use `dfm.rules { action: "set", rule,
   params }`. Say what you changed and why. Don't change a rule just to make
   a finding go away: waive the finding instead.
6. `dfm.report { format: "md" }` writes it out.

## The rules

| Rule | Reads | Default |
|---|---|---|
| thin-wall | the wall thickness at each point (the Thickness workspace's measure, scan only) | under 0.8 mm (2 × 0.4 mm lines) |
| overhang | faces leaning past the angle from vertical, and flat undersides held up on one side only (a ledge prints in air) | 50° |
| bridge | flat ceilings held on both sides, and how far they span at their narrowest | 10 mm |
| small-hole | upright round holes | under Ø2 mm |
| bed-contact | flat area on the bed over the footprint's area | under 5 % |
| tall-thin | height over the base's least width | over 8× |
| trapped-volume | closed cavities inside the part | over 1 mm³ |
| mesh-health | edges not shared by exactly two triangles | any |

## Reading the findings

- **A flat underside held on one side** is a ledge: it needs support or a
  chamfer. Held on both sides, it is a bridge, and only too long a span is a
  finding.
- **Thin walls come from the scan's thickness map.** On a coarse CAD mesh,
  open the part as the scan, so the map has points to measure.
- **small-hole** reads upright holes only. A sideways hole is an overhang at
  its top.
- **The numbers are rules of thumb** for a typical printer. A tuned printer
  bridges further and prints steeper. Ask before tightening or loosening one.

## Published guides

`dfm_guides` lists design guides from service bureaus, printer makers and a university, each figure with its publisher, page and the date it was read. No guide is a standard, and they disagree: `dfm_guides { action: "compare" }` shows them side by side, with where they differ.

- `dfm_settings { guide: "uzh-amf" }` stacks a guide's numbers over the nozzle, material and printer. `dfm_rules` then says the guide set them.
- A guide of the person's own, or a shop's: `dfm_guides { action: "import", guide: { id, label, publisher, overrides, figures } }`. It is checked against the rules and kept with the project.
- `dfm_guides { action: "export" }` gives the rules in force as a guide, to edit and import elsewhere.
- `dfm_considerations` is the design review beyond the numbers: what each question is, and whether a rule checks it or it is the person's call. Ask the ones no rule checks.
