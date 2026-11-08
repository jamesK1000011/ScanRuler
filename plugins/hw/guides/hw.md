<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Holes for hardware

The Hardware workspace (`hw.*`) puts holes in a Reverse Engineer body for the
hardware a printed part takes. Each hole is sized from the standards, with a
printing allowance added, and cut as named sketch and extrude-cut features
that stay editable in Reverse Engineer.

## What it knows

`hw.list` gives the table, in mm:

- **Screws M2–M8.** ISO 273 clearance (fine, medium, coarse) and three heads:
  ISO 4762 socket cap, ISO 7380 button (M3 up) and ISO 10642 countersunk,
  90° (M3 up).
- **Nuts.** ISO 4032 hex nuts, across flats and thickness.
- **Heat-set inserts** M2–M5 (typical figures; check the insert maker's sheet).
- **Pilots** for thread-forming screws in plastic (typical).
- **Disc magnets**, given as "6x3" (diameter × thickness).
- **Bearings.** 623, 624, 625, 688, 608 and 6800–6806.

## Settings

`hw.set` sets how holes are sized. They are saved with the project.

- `allowance`, by kind. FDM holes print small, so this much is added to every
  diameter and across-flats: screw 0.2, nut 0.2, insert 0 (the table is
  already the hole to model), pilot 0, magnet 0.2, bearing 0.1. If the user
  has measured their printer (the `fit-comp` workspace, or a test print), set
  it from that.
- `fit`: the ISO 273 class, medium by default.
- `headMargin`: the counterbore over the head, 0.4.
- `headSink`: how far the head sits below the surface, 0.2.
- `teardrop`: on by default. Level clearance and pilot holes are drawn as a
  teardrop, point up, so the roof prints without support.
- `bridgeLayer`: off by default (0). A sacrificial layer, say 0.2, left at
  each step of an upright hole: the counterbore's floor then bridges over it,
  and the user pushes it through after printing. Use it when the head side
  prints face down.
- `insertExtra` (1) and `magnetExtra` (0.2): depth past the insert or magnet.

## Plan, then cut

1. Find the face. `reverse.body.describe { body, where: { kind: "plane" } }`
   lists flat faces with their normals; pick the one the hole goes into.
2. `hw.plan { kind, size, at: { body, face } }` drills square into the face at
   its centre. Add `point` to place it elsewhere. Without a face, give
   `at: { body, point, direction }`, where `direction` is the way the hole
   goes in: along a coordinate axis, or level. It changes nothing and returns:
   - each step: profile, diameter (across flats for a hex), and the depths it
     runs between (from the surface; `through`);
   - the entry point, direction and sketch frame;
   - notes on how the hardware sits;
   - the exact `reverse.feature.add` features.
3. Read it back to the user, then `hw.apply` (no input) cuts what was planned.
   It plans afresh from the body as it stands, and refuses if the face's index
   now names another face. It is one undo step, and if any feature fails to
   build none is kept.
4. A face's centre moves once a hole is cut in it, so give `point` for each
   hole after the first (or plan them together as a pattern).

Kinds and their own fields:

- **screw**: `head` (socket, button, countersunk, none), `fit`, `depth` (null
  through, the default). A blind screw hole: `depth` about the screw's length
  less what goes into the other part.
- **nut**: `sunk` (0 opens at the surface; more buries it), `slot { length,
  toward? }` to slide it in from the side (length from the nut's centre to the
  part's side), and `shaft` (the screw's clearance through, on by default). A
  buried nut with no slot needs a pause in the print: the notes give the
  height.
- **insert**: depth defaults to the insert's length plus `insertExtra`. Leave
  the wall the notes give round it.
- **pilot**: depth defaults to 2d + 1.
- **magnet**: a pocket of the magnet's thickness plus `magnetExtra`.
- **bearing**: a pocket of the bearing's width, and a relief through behind it
  clear of the inner race (`relief: false` for none).

`allowance` and `teardrop` on a call override the settings for that hole.

## Patterns

`hw.pattern` is `hw.plan` with a `pattern`, laid about the point on the sketch
sheet. `frame` in the answer says which way u and v run.

- `{ kind: "circle", count, diameter, startDeg? }` makes a bolt circle.
- `{ kind: "rectangle", width, height }` puts four holes at the corners.
- `{ kind: "grid", countU, countV, stepU, stepV }` makes a grid.

It's refused if two holes would run into each other. `hw.apply` cuts every
hole in one sketch per step.

## What a hole fits

`hw.check { body, face }` takes a round face from `reverse.body.describe`,
or `{ diameter, depth? }`. It lists every size within 0.5 mm of the hole
`hw.plan` would cut for it, nearest first:

- `off`: this hole less that one, mm.
- `gap`: the hole as it should print, less the hardware. Negative is
  interference.
- A fit in words: binds, fine, loose, press fit, slip fit, and so on.
- `shallow`, where the hole is too shallow for it.

Use it on a scanned or imported part to say what screw a hole was made for, or
whether a modelled bore will take a bearing.

## Limits

- A hole is placed square to a flat face, or along a coordinate axis, or
  level. A tilted direction without a face is refused.
- Thread-forming pilots, inserts, magnets and bearing fits vary with material
  and printer. Suggest a test print of one hole before a big part.
- Holes are cut into the one body named, not into others they pass through.
