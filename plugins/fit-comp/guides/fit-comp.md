<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Making prints fit: from a scanned print to slicer settings

fit-comp reads a scanned print against the CAD it was printed from. It fits
what the printer did as numbers the slicer can undo:

- **scale** on X, Y and Z
- **contour offset**: outer walls too far out
- **hole offset**: holes too small
- **elephant foot**: the first layer squashed out

The result can be slicer settings or a pre-compensated model.

## Workflow

1. Open the print and its CAD: `scan.open` (the print), then
   `deviation.open_reference` (the CAD: STEP or STL), then `deviation.align`.
   Check the alignment's RMS. A bad alignment reads as offsets.
2. `fit.settings`: set `up` if the part wasn't printed CAD-Z-up. Set
   `printer`, `material` and `nozzle` if the person said them. Set `slicer`
   (`orcaslicer`, `bambustudio` or `prusaslicer`). Set `current` to the slicer
   values it was printed with, if any are non-zero. Ask the person when you
   don't know, because corrections add to what was in use.
3. `fit.features`: see which walls, floors, holes and bosses will be read. Tag
   pocket and slot walls `inner` (the slicer treats them as holes). Tag
   anything deliberately loose, trimmed or known-warped `ignore`.
4. `fit.measure`. Read it before passing anything on:
   - `fit` near 1 or under: the model explains the part. Over about 4: it
     doesn't (warping, a lifted corner, a bad alignment). Say so, show the
     `outliers` and the deviation map, and **don't** suggest offsets.
   - `determined: false`: this part can't separate that quantity. A single
     hole size with no spread of hole centres can't separate scale from the
     hole offset. Say what feature would.
5. `fit.suggest`: each quantity, whether it's worth changing and why, and
   the new slicer values added to the current ones. Give the person the
   `changes`. `fit.export { format: "ini" }` gives them a file.
6. Close the loop. After they reprint with the new settings, measure again
   and run `fit.runs { compare: true }`. An offset that doesn't shrink after
   it was corrected is not an offset: look for warping or a cooling issue.
   `fit.profiles { action: "save", name }` keeps a working set per printer
   and material.

## Settings or model?

- **Slicer settings** (`fit.suggest`) apply to every part on that printer and
  filament. Use them for a calibration part or a repeated material.
- **A compensated model** (`fit.compensated_mesh`) fixes this one part. Use it
  when the slicer can't, for example holes in PrusaSlicer, which has no hole
  compensation. Use it too when the person wants only this part changed.
  Print it with the slicer values the run was printed with, not with the
  suggested ones too. The exception is elephant foot, which stays a slicer
  setting: the answer's `footMm` says how much to add.

## Signs

| Quantity | + means | Corrects as |
|---|---|---|
| scale | over 1: too big (0.995 is 0.5 % small) | Orca `filament_shrink` = current % × scale; Prusa shrinkage % = 100 × (1 − scale × (1 − current/100)); Bambu: scale the object by 100/scale % |
| contour offset | walls stand out (part too big) | contour/size compensation − offset |
| hole offset | material stands into holes (holes too small) | hole compensation + offset |
| elephant foot | first layer wider than the wall | elephant foot compensation + foot |

## Limits

- Only faces square to an axis and upright round walls are read. Drafted
  walls, sloped faces and freeform surfaces are not.
- Scale needs features far apart. Hole centres are the best: only scale
  moves them.
- The scanner's own scale error sits under everything. A 0.1 % scale reading
  on a scanner calibrated to 0.1 % is not a finding.
- A print can't be corrected tighter than it repeats. Before chasing
  0.02 mm, measure the same print twice, or two prints, to see the spread.
