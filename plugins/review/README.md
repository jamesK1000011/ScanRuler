<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# Part review

One answer to "is this part done?" for an agent: `part.review` runs, on a
Reverse Engineer body, the checks the other workspaces carry — the body's
validity (`reverse.body.check`), its clearance to the other bodies shown
(`reverse.body.clearance`), its mass (`mass.properties`) and the last
strength solve (`fea.results`, when it is of this body and still holds) —
and comes to one verdict: pass, fix or unknown, the findings worst first,
the key figures, and what each check did (ran, skipped and why, failed and
why).

A build mixes processes part by part, so the checks for 3D printing —
printability (`dfm.check` on the body) and the pauses and roofs for parts
encased mid-print (`hw.pauses`), with the printer calibration in use
(`plugins/_shared/readPrinterFit.ts`) — are a group of their own. They
judge a part whose process is `fdm` or `print`; for a part whose process
is not said they run and inform (`ifPrinted`) without moving the verdict;
for any other process they are skipped as not printed.

`part.spec` keeps a design spec with the project (`review` in the project
file), in what the part must do: least wall and clearance, mass bounds or
a target, least safety factor — and how each body is made (`processes`).
Every review after judges against it; `part.review { spec }` judges one
review against other limits without keeping them.

No workspace. The other plugins are reached only by their commands' names
through the registry, so a build without any of them stands and the review
says the check is not in the build. Run headless, a check whose command
needs the page is reported `page only`.

Its guide (`guide.read { topic: "review" }`) tells an agent to end each
change with `part.review` and to read `history.diff` rather than describe
the part again.
