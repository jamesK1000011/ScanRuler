<!-- SPDX-License-Identifier: AGPL-3.0-only -->
# What each part is made of

A material belongs to a part (a Reverse Engineer body); how the part is
made — printed, cut, milled, a board, bought — is its setup. Weight and
strength follow both.

1. Ask what the part will be made of, or propose one and say why: the
   person decides. A printed part is a filament (`pla`, `petg`, `abs`,
   `asa`, `petg-cf`, `pa6-cf`, `tpu-95a`); a cut plate acrylic
   (`acrylic-glass-generic`), polycarbonate (`pc`), HDPE (`hdpe`), POM
   (`pom`) or a sheet metal; a machined part a metal (`aluminum-6061-t6`,
   `steel-s235jr`, `steel-x5crni18-10` for 304 stainless); a bought insert
   `brass`.
2. `material.list { q, category }` finds one — words like "stainless",
   "6061", "acrylic". `material.get { material }` gives it whole, with
   where the data comes from.
3. `material.set { body, material }` — several bodies at once with an
   array. Their own figures from a supplier's data sheet:
   `material: { name, base, density, youngsMPa, yieldMPa }`.
4. Then weigh (`mass.properties`) and solve (`fea.solve`): each body in its
   own material. A body is weighed and solved as printed only while it is
   in a print setup; otherwise as the solid material.

Traps:

- A body with no material is weighed and solved as before — the Mass or
  Strength setup's filament, as printed — and the answer's note says so.
  Set one before trusting a figure for a part that is not printed.
- Some library entries lack a figure (glass fibre and the wood Machining
  cards have no stiffness; 6061-T6 no yield, so Strength judges it against
  its ultimate and says so): the command asks for what it needs; give it
  as a material of your own over that one (`base`).
- Library figures are typical. For a part that must not fail, use the
  supplier's.
