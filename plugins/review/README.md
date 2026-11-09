<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Part review

One answer to "is this part done?" for an agent: `part.review` runs, on a
Reverse Engineer body, the checks the other workspaces carry — the body's
validity (`reverse.body.check`), its clearance to the other bodies shown
(`reverse.body.clearance`), its printability (`dfm.check` on the body),
its mass (`mass.properties`), the pauses for parts encased in it
(`hw.pauses`) and the last strength solve (`fea.results`, when it is of
this body and still holds) — and comes to one verdict: pass, fix or
unknown, the findings worst first, the key figures, and what each check
did (ran, skipped and why, failed and why). It names the printer
calibration in use (`plugins/_shared/readPrinterFit.ts`).

`part.spec` keeps a design spec with the project (`review` in the project
file): least wall and clearance, mass bounds or a target, least safety
factor, steepest overhang and the number of pauses. Every review after
judges against it; `part.review { spec }` judges one review against other
limits without keeping them.

No workspace. The other plugins are reached only by their commands' names
through the registry, so a build without any of them stands and the review
says the check is not in the build. Run headless, a check whose command
needs the page is reported `page only`.

Its guide (`guide.read { topic: "review" }`) tells an agent to end each
change with `part.review` and to read `history.diff` rather than describe
the part again.
