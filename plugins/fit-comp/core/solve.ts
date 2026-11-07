// SPDX-License-Identifier: AGPL-3.0-only
// What the print did to the part, as the slicer can undo it: a scale on
// each axis, the outer contours grown or shrunk, the holes closed or opened,
// and the first layer squashed out. One weighted least-squares fit over
// every reading, so a hole's centre (which only scale moves) and its radius
// (which scale and the hole offset both move) pin each other down.
//
//   a wall facing ±X or ±Y at p    reads  s·p + t + c·n       (n its outward sign)
//   a floor or top at z            reads  sz·z + tz
//   a boss of radius r             reads  s̄·r + c
//   a hole of radius r             reads  s̄·r − h
//   a hole or boss centre at x, y  reads  sx·x + tx, sy·y + ty
//
// with s̄ the mean of sx and sy, c the contour offset and h the hole offset
// (material standing into the hole, so + closes it). A wall tagged inner — a
// pocket's — takes h in place of c. Each parameter carries a weak prior
// (scale 1, offsets 0), so one the readings can't separate from another is
// still answered, with its prior's error: determined says which are read.
//
// Readings that sit far off the fit are weighed down (Huber, twice), and
// the fit's χ² per degree of freedom says whether this simple model explains
// the part at all — warping, a curled corner or a bad alignment does not fit
// it, and the answer says so rather than pass it on as offsets.

import type { Readings } from './measure'

export interface Estimate {
  value: number
  se: number
  determined: boolean
}

export interface Solution {
  scale: { x: Estimate; y: Estimate; z: Estimate }
  contour: Estimate
  hole: Estimate
  foot: { value: number; se: number; readings: number } | null
  /** χ² per degree of freedom: about 1 when the model explains the part. */
  fit: number
  dof: number
  outliers: { id: string; residual: number; sigma: number }[]
}

const NAMES = ['sx', 'sy', 'sz', 'tx', 'ty', 'tz', 'contour', 'hole'] as const
const PRIOR = [0.05, 0.05, 0.05, 10, 10, 10, 1, 1]
const PRIOR_MEAN = [1, 1, 1, 0, 0, 0, 0, 0]
const HUBER = 3

interface Row {
  id: string
  a: number[]
  y: number
  sigma: number
}

export function solve(readings: Readings, inner: ReadonlySet<string> = new Set(), floor = 0.003): Solution {
  const rows: Row[] = []
  const row = (id: string, entries: [number, number][], y: number, sigma: number) => {
    const a = new Array(8).fill(0)
    for (const [k, v] of entries) a[k] += v
    // A reading is no surer than the scanner's own calibration.
    rows.push({ id, a, y, sigma: Math.hypot(sigma, floor) })
  }
  for (const p of readings.planes) {
    const measured = p.nominal + p.sign * p.offset
    if (p.axis === 2) row(p.id, [[2, p.nominal], [5, 1]], measured, p.se)
    else row(p.id, [[p.axis, p.nominal], [3 + p.axis, 1], [inner.has(p.id) ? 7 : 6, p.sign]], measured, p.se)
  }
  for (const c of readings.circles) {
    const r = c.nominal.radius
    row(`${c.id} radius`, [[0, r / 2], [1, r / 2], c.kind === 'boss' ? [6, 1] : [7, -1]], c.radius, c.seRadius)
    row(`${c.id} centre x`, [[0, c.nominal.center[0]], [3, 1]], c.center[0], c.seCenter)
    row(`${c.id} centre y`, [[1, c.nominal.center[1]], [4, 1]], c.center[1], c.seCenter)
  }
  const n = NAMES.length
  let weights = rows.map(() => 1)
  let x = [...PRIOR_MEAN], cov: number[][] = []
  for (let pass = 0; pass < 3; pass++) {
    const ata = Array.from({ length: n }, () => new Array(n).fill(0))
    const atb = new Array(n).fill(0)
    rows.forEach((r, i) => {
      const w = weights[i] / (r.sigma * r.sigma)
      for (let a = 0; a < n; a++) {
        if (r.a[a] === 0) continue
        atb[a] += w * r.a[a] * r.y
        for (let b = 0; b < n; b++) ata[a][b] += w * r.a[a] * r.a[b]
      }
    })
    for (let k = 0; k < n; k++) {
      ata[k][k] += 1 / (PRIOR[k] * PRIOR[k])
      atb[k] += PRIOR_MEAN[k] / (PRIOR[k] * PRIOR[k])
    }
    cov = invert(ata)
    x = cov.map((rowv) => rowv.reduce((s, v, b) => s + v * atb[b], 0))
    weights = rows.map((r) => {
      const z = Math.abs(residual(r, x)) / r.sigma
      return z <= HUBER ? 1 : HUBER / z
    })
  }
  const est = (k: number): Estimate => {
    const se = Math.sqrt(Math.max(0, cov[k][k]))
    return { value: x[k], se, determined: se < 0.5 * PRIOR[k] }
  }
  let chi = 0
  const outliers: Solution['outliers'] = []
  for (const r of rows) {
    const res = residual(r, x)
    chi += (res / r.sigma) ** 2
    if (Math.abs(res) > 4 * r.sigma) outliers.push({ id: r.id, residual: round(res, 4), sigma: round(r.sigma, 4) })
  }
  const used = new Set<number>()
  for (const r of rows) r.a.forEach((v, k) => v !== 0 && used.add(k))
  const dof = Math.max(1, rows.length - used.size)
  return {
    scale: { x: est(0), y: est(1), z: est(2) },
    contour: est(6),
    hole: est(7),
    foot: footOf(readings),
    fit: round(chi / dof, 2),
    dof,
    outliers,
  }
}

const residual = (r: Row, x: number[]) => r.y - r.a.reduce((s, v, k) => s + v * x[k], 0)
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

/** How far the first layer stands out past the wall above it, mm: the
 *  walls on the bed, weighed by their errors. */
function footOf(readings: Readings): Solution['foot'] {
  const items: { e: number; se: number }[] = []
  for (const p of readings.planes) if (p.foot) items.push({ e: p.foot.band - p.foot.above, se: p.foot.se })
  for (const c of readings.circles)
    if (c.foot) items.push({ e: c.kind === 'boss' ? c.foot.radius - c.radius : c.radius - c.foot.radius, se: Math.hypot(c.foot.se, c.seRadius) })
  if (items.length === 0) return null
  let w = 0, s = 0
  for (const it of items) {
    const wi = 1 / Math.max(it.se, 1e-3) ** 2
    w += wi
    s += wi * it.e
  }
  return { value: s / w, se: 1 / Math.sqrt(w), readings: items.length }
}

function invert(a: number[][]): number[][] {
  const n = a.length
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r
    ;[m[c], m[p]] = [m[p], m[c]]
    const d = m[c][c] || 1e-300
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = m[r][c]
      if (f) for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j]
    }
  }
  return m.map((row) => row.slice(n))
}
