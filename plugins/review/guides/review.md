<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Is the part done?

Read with the **model** guide. Two tools take the place of a round of separate checks and of describing the part again after each change.

## 1. End every change with `part_review`

- After each change to the part — a feature added or edited, a hole cut, a part encased — call `part_review { body }` once. It runs, as the build has them, `reverse_body_check` (valid, closed), `reverse_body_clearance` against every other body shown, `dfm_check` on the body (printability, walls read on the CAD), `mass_properties` (encased parts counted), `hw_pauses` and the last `fea_results` when it is of this body and still holds, and says which printer calibration the hole sizes use (`printerFit`).
- `verdict`: **pass** — every check that must run ran and nothing is to put right; **fix** — an error in `findings` (worst first, each with `source`, the command to run alone for its details); **unknown** — `reverse_body_check` or `dfm_check` did not run, or part of the spec could not be judged (`unjudged` says which and why). Unknown is not pass: run what is missing, or say so in the reply.
- `checks` says what each command did: `ran`, `skipped: not in build`, `skipped: page only` (a headless server: run the review in the page mode before the handover), another `skipped:` reason, or `failed:` with the reason. A failed check is a finding of its own; never report the part done over it.
- Warnings do not fail a part, but say each in the reply, or why it stands (a dfm finding waived with `dfm_waive` has a reason kept with the project).
- The answer is small on purpose. For a finding's detail run its command alone (`dfm_check { body }`, `reverse_body_check { body }` …); do not run them all again to see the same verdict.

## 2. A spec to judge against

- When the person gives limits — a least wall, a gap, a weight, a safety factor, the steepest overhang, the number of pauses — keep them with `part_spec { spec }` once (minWall and minClearance in mm, massMin, massMax or massTarget ± massTol in g, minSafety, maxOverhang in degrees, pauses a count). Every review after judges against it, and it is saved with the project.
- `part_review { spec }` judges one review against other limits, over the kept spec, without keeping them — for trying a variant.
- A limit the build cannot judge (no strength solve for minSafety, no other body for minClearance) leaves the verdict unknown, never pass.

## 3. What a change did: `history_diff`

- `history_diff` (since the last change that changed the part) or `history_diff { since: checkpoint }` (since `history_checkpoint`) answers what moved: per body the stamp, volume, area, face count and box; bodies, features and encased parts added, removed or edited; and `recheck`, the review's checks the change moves.
- Use it in place of describing the part again, and in the reply in place of re-describing it from memory: the numbers are the part's.
- An empty diff after a change means the change did nothing to the part — a feature that failed, a value the same as before: look before going on.
- Take a `history_checkpoint` before a run of changes; `history_diff { since }` at its end says what the run did in one answer, and `history_restore` takes it back whole when the review says fix and the way out is not clear.
