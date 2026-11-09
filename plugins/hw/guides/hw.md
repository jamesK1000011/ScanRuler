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
- Inserts also carry their outside diameter (typical), for one dropped in.

## Settings

`hw.set` sets how holes are sized. They are saved with the project.

- `allowance`, by kind. FDM holes print small, so this much is added to every
  diameter and across-flats: screw 0.2, nut 0.2, insert 0 (the table is
  already the hole to model), pilot 0, magnet 0.2, bearing 0.1. These suit a
  printer whose holes print 0.2 small. When the printer is calibrated in Fits
  (`fit.calibrate`, or a scanned print's `fit.measure`), every allowance left
  at its default moves by the calibration's difference from 0.2 (holes 0.3
  small: screw 0.3, insert 0.1), and the answers say which calibration they
  used (`printerFit`). Don't copy the calibration in by hand: an allowance
  you set stays as set, and Fits' figures are written in other signs.
- `printerFit`: on by default; false sizes holes with the allowances as set.
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

## Parts encased in the print

A nut, magnet, bearing, insert, weight, RFID tag or any part of the person's
own can be sealed inside a print: the pocket is printed open, the print
pauses, the part is dropped in, and the layers above close over it.

1. Set the layers the slicer profile prints at: `hw.set { layerHeight,
   firstLayer }` (0.2 and 0.2 by default). Ask the person if you don't know.
2. `hw.embed { kind, size, at }` plans the pocket, as `hw.plan` does, sunk
   under a roof. `kind` is `nut`, `magnet`, `bearing`, `insert` (dropped in
   by its outside diameter, not pressed in hot) or `object` with
   `object: { shape: "box", size: [w, l, h] }` or `{ shape: "cylinder",
   diameter, height }`, `h` and `height` along the hole. `what` names it for
   the printer's screen. `encase: { roof }` or `{ roofLayers }` sets the
   roof; `roofLayers` (3) × `layerHeight` by default. `hw.plan` and
   `hw.apply` take `encase` too.
   - The pocket is the part plus `dropClearance` (0.3) across, and
     `dropHeadroom` (0.2) above it, so it drops in and the nozzle clears it.
   - Drilled down from a top face, the roof is made thicker, and drilled up
     from a bottom face the pocket is made deeper, so its top lands on a
     layer boundary. The notes say so. This needs the body built, so its
     place on the bed is known.
   - Drilled level from a side face, the pocket gets straight sides from
     its middle up to a flat top on a layer boundary, so the part drops in
     from above at the pause; the flat top is bridged. A level box stands
     with its sides upright. A slanted pocket is refused: it would close
     over itself before the print reached its top.
   - A pocket that would break out of the body's box is refused; one close
     to a side is warned.
   - The answer gives each pocket's top (Z, part frame), the roof, the span
     the roof bridges, and the pause layer.
   - It warns about a roof under `roofLayers`, a span wider than `bridgeMax`
     (10), naming the layer that bridges it, and a top off a layer boundary,
     where the layer it falls in may print closed over the pocket.
3. `hw.apply` cuts it and records it: E1, E2… A sealed pocket is a void in
   the body. `reverse.body.check` reports it as one, which is expected here.
4. `hw.record { body, top, what }` records a pocket cut some other way.
   `hw.record { from: "mass" }` takes the ballast pocket the Mass workspace
   planned. Record it before `mass.apply`, which clears the plan.
5. `hw.pauses` lists the pauses: for each, the layer to pause before (from
   1), the height above the bed, the Z the slicer shows for that layer, and
   what goes in. Parts on one layer are merged.
   - The rule: pause before the first layer whose bottom is at or above
     the pocket's top. The layers below are printed, so the pocket stands
     open.
   - Heights are above the bed: each body's lowest point sits on it. Give
     `together: [bodies]` for bodies exported as one STL (they share the
     lowest point).
   - `slicer.pauses` in the answer goes straight to `slicer_slice {
     pauses }`. The slicer side reads the layers from the G-code and puts
     the pause in (see the slicer-loop guide).
   - A part whose cut was removed, or whose body isn't built, is left out
     and named. `hw.unembed { id }` or `{ all: true }` forgets one.
   - `hw.clear` puts away the last plan and check; nothing cut changes.
6. The part's mass: a nut, magnet, bearing or insert counts its own weight
   (the table's size, NdFeB, steel or brass), resting at the pocket's low
   end; `grams` gives what one weighs instead and is needed for an object.
   `hw.masses` lists them; `mass.properties` and `fea.solve` (own weight)
   add them. A pocket recorded without a part is named as not counted.
7. Tell the person, per pause: the layer, what goes in, and which way up (a
   magnet's poles). They press resume on the printer, or through
   `printer_resume`, which asks them.

## Limits

- Encased pockets are placed like holes. The roof is measured only for a
  pocket drilled straight down. Otherwise check the part around it with
  `section.cut`.
- Bodies printed object by object (sequential printing) can't take pauses
  by height.
- The heights assume the part prints as modelled, Z up, standing on its
  lowest point. Turned over in the slicer, or printed on a raft, they are
  wrong. The slicer side refuses a raft.

- A hole is placed square to a flat face, or along a coordinate axis, or
  level. A tilted direction without a face is refused.
- Thread-forming pilots, inserts, magnets and bearing fits vary with material
  and printer. Suggest a test print of one hole before a big part.
- Holes are cut into the one body named, not into others they pass through.
