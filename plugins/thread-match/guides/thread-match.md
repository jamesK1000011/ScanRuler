<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Identifying a scanned thread

`thread.identify` names a thread on a bore or boss. It goes further than
`reverse.thread.read` in three ways:

- It reads the thread along the helix, which sharpens the pitch and reads the
  flank angle, the taper, the hand and the number of starts.
- It tries every family: ISO metric, UNC, UNF, UNEF, NPT, G (BSPP), R (BSPT),
  metric trapezoidal Tr, ACME, and the 3D-print 45° form.
- It says when the scan **can't tell** two sizes apart, and which measurement
  would.

## Workflow

1. Find the axis, as for `reverse.thread.read`. Use a cylinder element
   (`element.fit` on the bore or boss), a round face of a Reverse body, or a
   line.
2. Run `thread.identify { axis }`. Check `families` first if the person has
   said what the part is: an American plumbing fitting means
   `["npt","unc","unf"]`, a European one `["bspp","bspt","metric"]`.
3. Act on the `verdict`:
   - **match / high**: name it. If `ruledOut` is present, say what else fits
     by pitch and diameter and why it was set aside, in one line.
   - **match / low**: name it as the nearest fit, and say the thread reads
     off-standard (worn, printed, or a less common size). Offer
     `deciding`-style checks only if it matters.
   - **ambiguous**: don't pick. Give the person the first item of `deciding`,
     with what each candidate would read. If they aren't at the part right
     now, pin the question on it with `reverse.note.add { text, at }`, at
     the axis origin from the answer. When they answer, call
     `thread.identify { axis, families }` narrowed to the family that fits, or
     state the answer outright.
   - **none**: say it repeats but matches no size. Try `detail: "full"` and
     other families, or treat it as custom and model it from the reads.
4. To model it, add `feature` with `reverse.feature.add` when present.
   `canModel` is false for pipe, trapezoidal and ACME threads, because the
   Thread feature can't cut them. Say so, and model a plain bore or boss at
   the right diameter instead.

## Reading the answer

| Field | What it tells you |
|---|---|
| `reads.pitch`, `pitchSigma` | Pitch from the helix fold, and its 1σ. Usually much tighter than the window read. |
| `reads.flankAngle`, `flankConfidence` | Included angle. Only trusted (`high`) on pitches ≥ 0.9 mm; finer threads blur on any scanner. |
| `reads.taper` | `tapered` (1:16 pipe), `parallel` or `unclear` (too short or too noisy to say). |
| `reads.starts`, `lead` | Multi-start threads, e.g. a printer lead screw Tr8×8 = 4 starts at pitch 2. |
| `reads.depthShare` | Tooth depth over pitch. A scan reads shallower than the real thread, never deeper. |
| `tolerance` | The pitch and diameter shares a size had to fall within. `thread.settings { pitchFloor }` raises it for a scanner whose scale you trust less. |

## Pitfalls

- **Close pairs are real.** M5×0.8 vs #10-32, M4×0.7 vs #8-36, G 1/2 vs R 1/2,
  and 1/2 NPT vs R 1/2 all differ by less than many scans resolve. An
  `ambiguous` answer is the right one, not a failure.
- **Diameters read a little small** on a boss (rounded crests) and a little
  large on a bore. The tolerance allows for it.
- **A printed thread** often reads `match / low`: the printer's own error
  sits on top of the scan's.
- **Don't quote standard text.** Name the standard (`source`) and give
  dimensions from `thread.lookup`.
