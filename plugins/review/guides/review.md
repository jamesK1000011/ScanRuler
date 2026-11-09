<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Is the part done?

Read with the **model** guide. Two tools take the place of a round of separate checks and of describing the part again after each change.

## 1. End every change with `part_review`

- After each change to the part — a feature added or edited, a hole cut, a part encased — call `part_review { body }` once. It runs, as the build has them, `reverse_body_check` (valid, closed), `reverse_body_clearance` against every other body shown, `mass_properties` (encased parts counted) and the last `fea_results` when it is of this body and still holds.
- **How the part is made decides the printing checks.** A build mixes processes part by part — printed, laser-cut, machined, a board, a part bought. `process` (or the spec's `processes` for the body) says which: `"fdm"` or `"print"` — `dfm_check` and `hw_pauses` judge the part, under `printing`, with the printer calibration the holes use (`printerFit`); not said — they run where the build has them and their findings come under `ifPrinted`, for information, never moving the verdict; any other word — they are skipped as not printed. Do not assume a part is printed: ask, or keep the process the person gave with `part_spec`.
- `verdict`: **pass** — every check that must run ran and nothing is to put right; **fix** — an error in `findings` (worst first, each with `source`, the command to run alone for its details); **unknown** — `reverse_body_check` (or, for a printed part, `dfm_check`) did not run, or part of the spec could not be judged (`unjudged` says which and why). Unknown is not pass: run what is missing, or say so in the reply.
- `checks` (and the printing group's) says what each command did: `ran`, `skipped: not in build`, `skipped: page only` (a headless server: run the review in the page mode before the handover), `skipped: not printed`, another `skipped:` reason, or `failed:` with the reason. A failed check is a finding of its own; never report the part done over it.
- Warnings do not fail a part, but say each in the reply, or why it stands (a printability finding waived with `dfm_waive` has a reason kept with the project).
- The answer is small on purpose. For a finding's detail run its command alone (`dfm_check { body }`, `reverse_body_check { body }` …); do not run them all again to see the same verdict.

## 2. A spec to judge against

- The spec is what the part must do, however it is made: when the person gives limits — a least wall, a gap, a weight, a safety factor — keep them with `part_spec { spec }` once (minWall and minClearance in mm, massMin, massMax or massTarget ± massTol in g, minSafety), and how each body is made under `processes` (`{ "Grip": "fdm", "Plate": "laser-cut" }`). Every review after judges against it, and it is saved with the project.
- `part_review { spec }` judges one review against other limits, over the kept spec, without keeping them — for trying a variant.
- A limit the build cannot judge (no strength solve for minSafety, no other body for minClearance, no wall reading for a part not printed) leaves the verdict unknown, never pass.

## 3. What a change did: `history_diff`

- `history_diff` (since the last change that changed the part) or `history_diff { since: checkpoint }` (since `history_checkpoint`) answers what moved: per body the stamp, volume, area, face count and box; bodies, features and encased parts added, removed or edited; and `recheck`, the review's checks the change moves.
- Use it in place of describing the part again, and in the reply in place of re-describing it from memory: the numbers are the part's.
- An empty diff after a change means the change did nothing to the part — a feature that failed, a value the same as before: look before going on.
- Take a `history_checkpoint` before a run of changes; `history_diff { since }` at its end says what the run did in one answer, and `history_restore` takes it back whole when the review says fix and the way out is not clear.
