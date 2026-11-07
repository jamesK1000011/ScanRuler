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
