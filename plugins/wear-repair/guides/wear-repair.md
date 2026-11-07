<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Repairing a worn part and pre-warping a print

## Repairing wear

1. **Choose what the part should be.** Use `wear.reference`:
   - **mirror**: the part's own other half, when it is symmetric and only one
     side is worn. Run `align.symmetry` first, so the symmetry plane is a
     frame plane, then `wear.reference { source: "mirror", plane: "x" }`.
   - **deviation**: a reference opened and aligned in the Deviation
     workspace. That can be the CAD, a scan of an unworn twin (the matching
     left or right part), or a catalog download. Run
     `deviation.open_reference`, then `deviation.align`, then
     `wear.reference { source: "deviation" }`.
2. **Tag the regions.** Use `wear.tag { name, kind: "worn", region }` for
   each worn or damaged area, as a box or a sphere. Find where with
   `scan.query`, sections and element fits, or the deviation map's hotspots
   against the reference. Tag `keep` for anything that must not move: a fit
   face, a datum, or a feature meant to differ from the other half.
3. **Read it.** `wear.diff` gives, per region, how deep the loss is
   (`lost`, negative) and how much stands proud (`added`). Tell the person
   in one line per region.
4. **Repair.** `wear.rebuild { path }` writes the repaired STL: each worn
   vertex moved onto the reference, faded out over `blendMm`. `mode: add`
   (the default) only brings lost material back; `both` trims what stands
   proud too. The answer's `before` and `after` show the change.
5. **A piece broken off** has no scan surface left to move. Say so, and
   model it instead: open the reference as the part, or rebuild with
   Reverse features, keeping the repair a feature of its own.

## Pre-warping a print

Use this when a print keeps coming out distorted in a way slicer offsets
don't fix (fit-comp's `fit` well over 4 is the sign: warping, a curled
corner, a sagging span).

1. Open the target (the CAD, or the repaired part) as the reference, the
   print's scan as the scan, and align them.
2. `wear.prewarp { path }` writes the target moved back by the error the
   print shows, smoothed. Print it, scan it, and run again against the same
   target.
3. Read `stop` and `why` after each run. Stop when the print is within the
   tolerance, when a run is less than a fifth better than the last (what's
   left isn't a shape error: look at cooling, adhesion or the print itself),
   or after three runs.

## Limits

- Regions are boxes and spheres in the current frame. Tag generously and
  protect what matters with `keep`.
- The mirror needs the part to really be symmetric where it is worn. Check
  `wear.diff` on a region that isn't worn first: it should read near zero.
- Pre-warp moves the target along its own normals. It can't fix a twist
  larger than the part's walls.
