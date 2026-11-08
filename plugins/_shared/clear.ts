// SPDX-License-Identifier: AGPL-3.0-only
// Where a new part goes so it doesn't land inside one already there: the
// parts' box against the box round the bodies standing, and, where they
// meet, the way past them in +Y with a gap. Generate and Fits build their
// parts about the origin; without this, a coupon came in through a bin.

export type Box3 = { min: [number, number, number]; max: [number, number, number] }

export function join(a: Box3, b: Box3): Box3 {
  return { min: [0, 1, 2].map((i) => Math.min(a.min[i], b.min[i])) as Box3['min'], max: [0, 1, 2].map((i) => Math.max(a.max[i], b.max[i])) as Box3['max'] }
}

/** The move [0, dy, 0] that puts `parts` clear of `standing` with `gap`
 *  between, or null where their boxes don't meet (within the gap) in plan. */
export function clearOf(parts: Box3[], standing: Box3 | null, gap = 10): [number, number, number] | null {
  if (!standing || !parts.length) return null
  const p = parts.reduce(join)
  const meets = [0, 1].every((i) => p.min[i] < standing.max[i] + gap && p.max[i] > standing.min[i] - gap)
  if (!meets) return null
  return [0, standing.max[1] + gap - p.min[1], 0]
}
