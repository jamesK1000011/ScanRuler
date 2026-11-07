// SPDX-License-Identifier: AGPL-3.0-only
// Pre-warping: the target moved against the error a print of it showed, so
// the next print lands on the target. At each target vertex the printed
// surface's distance along the target's normal is the error there; the
// field is smoothed over the mesh (a scan's scatter is not the printer's
// error) and the vertex moved back by gain × the error. Run, print, scan,
// run again: each run's RMS against the last says whether it converges,
// and when to stop.

import { topology, type Mesh, type Surface } from './geometry'

export interface PrewarpResult {
  positions: Float64Array
  /** The error read, before smoothing: RMS and largest, mm. */
  rms: number
  largest: number
  /** Vertices whose printed surface was too far to be the same one. */
  unread: number
}

export function prewarp(target: Mesh, printed: Surface, o: { gain: number; smooth: number; maxMm: number }): PrewarpResult {
  const { normals, neighbours } = topology(target)
  const n = target.positions.length / 3
  let e = new Float64Array(n)
  const known = new Uint8Array(n)
  let ss = 0, largest = 0, count = 0
  for (let v = 0; v < n; v++) {
    const x = target.positions[3 * v], y = target.positions[3 * v + 1], z = target.positions[3 * v + 2]
    const h = printed.nearest(x, y, z)
    if (h.distance > o.maxMm) continue
    // Along the target's normal: + the print stands out of the target.
    const d = (h.point[0] - x) * normals[3 * v] + (h.point[1] - y) * normals[3 * v + 1] + (h.point[2] - z) * normals[3 * v + 2]
    e[v] = d
    known[v] = 1
    ss += d * d
    largest = Math.max(largest, Math.abs(d))
    count++
  }
  for (let k = 0; k < o.smooth; k++) {
    const next = new Float64Array(n)
    for (let v = 0; v < n; v++) {
      if (!known[v]) continue
      let s = e[v], w = 1
      for (const u of neighbours[v])
        if (known[u]) {
          s += e[u]
          w++
        }
      next[v] = s / w
    }
    e = next
  }
  const out = Float64Array.from(target.positions)
  for (let v = 0; v < n; v++) {
    if (!known[v]) continue
    out[3 * v] -= o.gain * e[v] * normals[3 * v]
    out[3 * v + 1] -= o.gain * e[v] * normals[3 * v + 1]
    out[3 * v + 2] -= o.gain * e[v] * normals[3 * v + 2]
  }
  return { positions: out, rms: count ? Math.round(Math.sqrt(ss / count) * 1000) / 1000 : 0, largest: Math.round(largest * 1000) / 1000, unread: n - count }
}

export interface Run {
  n: number
  rms: number
  at: string
}

/** Whether to run again: stop under the tolerance, when a run gains less
 *  than a fifth on the last, or after the runs allowed. */
export function stopRule(runs: readonly Run[], tolerance: number, maxRuns = 3): { stop: boolean; why: string } {
  const last = runs.at(-1)
  if (!last) return { stop: false, why: 'no run yet' }
  if (last.rms <= tolerance) return { stop: true, why: `the print is within ${tolerance} mm RMS of the target` }
  const prev = runs.at(-2)
  if (prev && last.rms > 0.8 * prev.rms) return { stop: true, why: `run ${last.n} gained less than a fifth on run ${prev.n} (${prev.rms} → ${last.rms} mm RMS): what is left is not a shape error a pre-warp undoes — look at the print itself` }
  if (runs.length >= maxRuns) return { stop: true, why: `${maxRuns} runs made` }
  return { stop: false, why: `${last.rms} mm RMS — print the pre-warped model, scan it, and run again` }
}
