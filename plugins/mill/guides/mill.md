<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Machining a part on a CNC mill

Basic milling, no toolpaths: whether the part can be machined from the directions the person's machine works in, with the tools they have, and the hand-over to their CAM and machinist. How a part is made is its setup (the **setups** guide): ask, then record it with `setup_add { type: "mill", bodies: [...] }`. The material is the part's (`material_set`).

## 1. Record the setup

`setup_add { type: "mill", bodies: ["Bracket"], settings: { directions: ["+z", "-z"], minTool: 3, reach: 25 } }`. Every setting is optional:

| Setting | What | Unset |
|---|---|---|
| `axes` | `"3"` (each direction a fixturing of its own) or `"3+2"` (indexed) | 3 |
| `directions` | where the tool comes from: `"+z"` (from above), `"-z"` (flipped), … or `[x, y, z]` | `["+z"]` |
| `margin` | stock round the part's box, each side, mm | 2 |
| `stock` | the stock's size `[x, y, z]`, mm, centred on the part | the box and margin |
| `minTool` | the least end mill's diameter, mm | 3 |
| `reach` | how far the longest tool reaches below the part's top, mm | 30 |
| `grade` | the ISO 286 IT grade machined sizes hold (5–14) | 8 |
| `note` | for the machinist, on the setup sheet | — |

## 2. Check

`mill_check { body }` — or `part_review { body }`, which runs it for a part in a mill setup (under `made`). Inputs override the setup for one call.

- **Undercuts** (errors): faces turned away from every direction, or under material along it. Offer another direction (a flip is `-z`; a side `+x` …), a 3+2 machine, or a change of shape — and say which faces. The underside standing on the stock is said, not judged.
- **Inside corners**: a square corner standing along the tool, or an inside round under the least tool's radius, keeps the tool's radius. Suggest rounding to a little over it.
- **Holes**: under the least tool — drill or ream them; deeper than about 4 diameters — drill, or a long-reach tool.
- **Floors**: narrower than the least tool cannot be milled; deeper than about 4 times their width chatter.
- **Reach**: faces deeper than the tool reaches from every direction that reaches them.
- **Stock**: a part bigger than the stock given is an error.
- **Walls**: `dfm.wall` reads the least wall against the material's (metal 0.5, plastic 1, wood 2); a build without it says the wall was not read.

The reading is off the faces' triangles: approximate near the limits. `defaulted` lists the figures not set — when they matter, ask the person for their tools.

## 3. Hand-over

`mill_export { setup: "S3" }` (or `bodies`): a zip of the parts as STEP and a setup sheet (`setup.json`, `setup.md`) — material and cutting data, axes, directions, stock, tool limits, IT grade, wall and findings, the setup's note. No toolpaths: those are made in the person's CAM.

## 4. Fits

A milled part is machined to size, each size within its IT grade's zone. `fit_set { setup: "S3" }` sizes Fits' pairs for it: modelled as drawn, the range from the grade at each size.
