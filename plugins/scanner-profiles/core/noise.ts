// SPDX-License-Identifier: AGPL-3.0-only
// A scan's point spacing: the median distance between neighbouring
// vertices. The noise itself is the scan check's (scan.qa: the median
// scatter of small plane fits), the figure upstream's scan-to-CAD rule is
// written against; that check gives a spacing only for a CAD tessellation,
// so a scanner's resolution, kept in its profile beside its noise, is read
// here.

export interface MeshIn {
  positions: ArrayLike<number>
  indices: ArrayLike<number>
}

/** Median edge length, mm, over at most about `maxEdges` edges; NaN for a
 *  mesh with none. */
export function pointSpacing(m: MeshIn, maxEdges = 60000): number {
  const tris = Math.floor(m.indices.length / 3)
  const step = Math.max(1, Math.floor((3 * tris) / maxEdges))
  const P = m.positions
  const d: number[] = []
  const len = (a: number, b: number) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2])
  for (let t = 0; t < tris; t += step) {
    const a = m.indices[3 * t], b = m.indices[3 * t + 1], c = m.indices[3 * t + 2]
    d.push(len(a, b), len(b, c), len(c, a))
  }
  if (!d.length) return NaN
  d.sort((x, y) => x - y)
  return d[Math.floor(d.length / 2)]
}
