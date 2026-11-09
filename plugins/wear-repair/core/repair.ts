// SPDX-License-Identifier: AGPL-3.0-only
// The wear read and repaired against a reference surface — the part's own
// other half mirrored, a twin, or its CAD — over the regions tagged worn:
//  - diff: how far the scan stands in from the reference (material lost)
//    or out from it (material added), region by region;
//  - rebuild: each worn vertex moved onto the reference, weighed down to
//    nothing over a blend band outside the region so the repair meets the
//    part without a step. Only where the reference is near (within maxMm):
//    farther is not the same surface. By default only lost material comes
//    back (add); with both, what stands proud is trimmed too.
// The mesh keeps its triangles: a worn or dented surface comes back; a
// piece broken off, with no scan surface left to move, does not.

import { weight, type Mesh, type Region, type Surface } from './geometry'

export interface RegionStats {
  name: string
  points: number
  /** Signed distance to the reference, mm: − material lost, + added. */
  lost: number
  added: number
  mean: number
  rms: number
  /** Points more than the tolerance in, and out. */
  pointsLost: number
  pointsAdded: number
}

export function diff(scan: Mesh, ref: Surface, regions: readonly { name: string; region: Region }[], tolerance: number, maxMm: number): RegionStats[] {
  return regions.map(({ name, region }) => {
    const ds: number[] = []
    for (let i = 0; i < scan.positions.length; i += 3) {
      const x = scan.positions[i], y = scan.positions[i + 1], z = scan.positions[i + 2]
      if (weight([region], [], 0, x, y, z) < 1) continue
      const h = ref.nearest(x, y, z)
      if (h.distance > maxMm) continue
      ds.push(h.signed)
    }
    const r = (v: number) => Math.round(v * 1000) / 1000
    if (!ds.length) return { name, points: 0, lost: 0, added: 0, mean: 0, rms: 0, pointsLost: 0, pointsAdded: 0 }
    const mean = ds.reduce((s, v) => s + v, 0) / ds.length
    return {
      name,
      points: ds.length,
      lost: r(Math.min(0, ...ds)),
      added: r(Math.max(0, ...ds)),
      mean: r(mean),
      rms: r(Math.sqrt(ds.reduce((s, v) => s + v * v, 0) / ds.length)),
      pointsLost: ds.filter((d) => d < -tolerance).length,
      pointsAdded: ds.filter((d) => d > tolerance).length,
    }
  })
}

/** The scan's own scatter against the reference where it is not worn: the
 *  robust spread (1.4826 × the median absolute deviation) of the signed
 *  distance over points outside every worn region and near the reference.
 *  A tolerance under about twice this counts scatter as wear. Null when
 *  fewer than 50 such points are near. Reads at most about 20 000 points. */
export function scatter(scan: Mesh, ref: Surface, worn: readonly Region[], maxMm: number): { mm: number; points: number } | null {
  const n = scan.positions.length / 3
  const stride = Math.max(1, Math.floor(n / 20000))
  const ds: number[] = []
  for (let v = 0; v < n; v += stride) {
    const i = 3 * v
    const x = scan.positions[i], y = scan.positions[i + 1], z = scan.positions[i + 2]
    if (worn.length && weight(worn, [], 0, x, y, z) > 0) continue
    const h = ref.nearest(x, y, z)
    if (h.distance > maxMm) continue
    ds.push(h.signed)
  }
  if (ds.length < 50) return null
  const mid = (a: number[]) => {
    const b = [...a].sort((p, q) => p - q)
    return b[b.length >> 1]
  }
  const m = mid(ds)
  return { mm: Math.round(1.4826 * mid(ds.map((d) => Math.abs(d - m))) * 10000) / 10000, points: ds.length }
}

/** The least tolerance this scan supports, and what sets it: twice its
 *  scatter off the worn regions, or three times the scan noise to plan with
 *  (Scanner noise's, when the build has it: the scanner's usual noise is a
 *  floor a scan that reads clean against the reference does not lift) —
 *  the larger. Null with neither. */
export function toleranceFloor(s: { mm: number } | null, noise?: { sigmaMm: number } | null): { mm: number; by: 'scatter' | 'noise' } | null {
  const byScatter = s ? 2 * s.mm : 0
  const byNoise = noise ? 3 * noise.sigmaMm : 0
  if (!(byScatter > 0) && !(byNoise > 0)) return null
  return byNoise > byScatter ? { mm: Math.round(byNoise * 10000) / 10000, by: 'noise' } : { mm: Math.round(byScatter * 10000) / 10000, by: 'scatter' }
}

/** What the scatter and the scan noise mean for the tolerance, in a line,
 *  or null when the tolerance clears both. */
export function scatterNote(s: { mm: number } | null, tolerance: number, noise?: { sigmaMm: number; from: string } | null): string | null {
  const floor = toleranceFloor(s, noise)
  if (!floor || tolerance >= floor.mm) return null
  const raise = Math.ceil(floor.mm * 100 - 1e-9) / 100
  // units-ok: the reply to the agent, in the millimetres the settings take
  if (floor.by === 'scatter') return `the tolerance (${tolerance} mm) is under twice the scan's scatter off the worn regions (${s!.mm} mm): points past it may be scatter, not wear — raise it to about ${raise} mm, or rescan finer`
  // units-ok: the reply to the agent, in the millimetres the settings take
  return `the tolerance (${tolerance} mm) is under three times the scan noise (${noise!.sigmaMm} mm, ${noise!.from}): nothing finer is trustworthy on this scan, so points past it may be noise, not wear — raise it to about ${raise} mm, or rescan finer`
}

export interface RebuildOptions {
  worn: Region[]
  keep: Region[]
  blendMm: number
  maxMm: number
  mode: 'add' | 'both'
}

export function rebuild(scan: Mesh, ref: Surface, o: RebuildOptions): { positions: Float64Array; moved: number; largest: number } {
  const out = Float64Array.from(scan.positions)
  let moved = 0, largest = 0
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i], y = out[i + 1], z = out[i + 2]
    const w = weight(o.worn, o.keep, o.blendMm, x, y, z)
    if (w === 0) continue
    const h = ref.nearest(x, y, z)
    if (h.distance > o.maxMm || h.distance < 1e-6) continue
    if (o.mode === 'add' && h.signed > 0) continue
    out[i] = x + w * (h.point[0] - x)
    out[i + 1] = y + w * (h.point[1] - y)
    out[i + 2] = z + w * (h.point[2] - z)
    moved++
    largest = Math.max(largest, w * h.distance)
  }
  return { positions: out, moved, largest: Math.round(largest * 1000) / 1000 }
}
