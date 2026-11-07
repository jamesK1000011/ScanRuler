// SPDX-License-Identifier: AGPL-3.0-only
// The scan read against each feature of the reference, both in the build
// frame:
//  - a flat face: the scan's points over it (inside its footprint, off its
//    edges) and how far they stand out of the material along its normal —
//    the median, and how much they scatter;
//  - a hole or a boss: a circle fitted to the scan's points about it, its
//    centre and radius;
//  - the first layer: the same on the walls that stand on the bed, the band
//    next to it against the wall above.
// Each reading carries its standard error, from the points' scatter and how
// many independent ones there are — neighbouring scan points are not.

import { fitCircle, type Features, type PlaneFeature } from './features'

export interface MeasureOptions {
  /** How far off the nominal surface a point still counts, mm. */
  band: number
  /** The first layer's height, mm: its slab is what the slicer's
   *  elephant-foot setting moves. */
  footBand: number
  /** How far above the band the wall is read for comparison, mm. */
  footAbove: number
}

export const DEFAULT_MEASURE: MeasureOptions = { band: 1, footBand: 0.2, footAbove: 2.5 }

export interface PlaneReading {
  id: string
  axis: 0 | 1 | 2
  sign: 1 | -1
  nominal: number
  /** The material's outward offset from the nominal face, mm: + stands out. */
  offset: number
  se: number
  scatter: number
  points: number
  /** On an upright wall that stands on the bed: the offset in the first
   *  layer's band, and on the wall above it. */
  foot?: { band: number; above: number; se: number; points: number }
}

export interface CircleReading {
  id: string
  kind: 'hole' | 'boss'
  nominal: { center: [number, number]; radius: number }
  center: [number, number]
  radius: number
  seRadius: number
  seCenter: number
  scatter: number
  points: number
  foot?: { radius: number; se: number; points: number }
}

export interface Readings {
  planes: PlaneReading[]
  circles: CircleReading[]
  /** The scan's scatter on flat faces, 1σ, mm: the median of the faces'. */
  noise: number
  /** Features with too few scan points to read. */
  missed: string[]
}

/** The spacing within which scan points are taken as one reading. */
const INDEPENDENT_MM2 = 0.25
const MASK_CELL = 0.5
const MIN_POINTS = 30

/** A uniform grid over the scan's points, for the ones near a box. */
class Grid {
  private cells = new Map<number, number[]>()
  constructor(p: Float64Array, private size: number) {
    for (let i = 0; i < p.length / 3; i++) {
      const k = this.key(Math.floor(p[3 * i] / size), Math.floor(p[3 * i + 1] / size), Math.floor(p[3 * i + 2] / size))
      const c = this.cells.get(k)
      if (c) c.push(i)
      else this.cells.set(k, [i])
    }
  }
  private key(x: number, y: number, z: number) {
    return ((x + 50000) * 100003 + (y + 50000)) * 100019 + (z + 50000)
  }
  *near(min: number[], max: number[]): Generator<number> {
    const s = this.size
    for (let x = Math.floor(min[0] / s); x <= Math.floor(max[0] / s); x++)
      for (let y = Math.floor(min[1] / s); y <= Math.floor(max[1] / s); y++)
        for (let z = Math.floor(min[2] / s); z <= Math.floor(max[2] / s); z++) {
          const c = this.cells.get(this.key(x, y, z))
          if (c) yield* c
        }
  }
}

const median = (xs: number[]) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const mad = (xs: number[], m: number) => 1.4826 * median(xs.map((x) => Math.abs(x - m)))

/** The face's footprint on its own plane: a raster of the cells its
 *  triangles cover, shrunk by `shrink` cells off every edge. */
function footprint(p: PlaneFeature, shrink: number) {
  const [ua, va] = p.axis === 0 ? [1, 2] : p.axis === 1 ? [0, 2] : [0, 1]
  const u0 = p.min[ua] - MASK_CELL, v0 = p.min[va] - MASK_CELL
  const nu = Math.ceil((p.max[ua] - p.min[ua]) / MASK_CELL) + 3, nv = Math.ceil((p.max[va] - p.min[va]) / MASK_CELL) + 3
  const cells = new Uint8Array(nu * nv)
  const t = p.triangles
  for (let j = 0; j < t.length; j += 9) {
    const ax = t[j + ua], ay = t[j + va], bx = t[j + 3 + ua], by = t[j + 3 + va], cx = t[j + 6 + ua], cy = t[j + 6 + va]
    const iu0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - u0) / MASK_CELL)), iu1 = Math.min(nu - 1, Math.floor((Math.max(ax, bx, cx) - u0) / MASK_CELL))
    const iv0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - v0) / MASK_CELL)), iv1 = Math.min(nv - 1, Math.floor((Math.max(ay, by, cy) - v0) / MASK_CELL))
    const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (d === 0) continue
    for (let iu = iu0; iu <= iu1; iu++)
      for (let iv = iv0; iv <= iv1; iv++) {
        const x = u0 + (iu + 0.5) * MASK_CELL, y = v0 + (iv + 0.5) * MASK_CELL
        const w1 = ((bx - x) * (cy - y) - (by - y) * (cx - x)) / d
        const w2 = ((cx - x) * (ay - y) - (cy - y) * (ax - x)) / d
        const w3 = 1 - w1 - w2
        if (w1 >= -1e-9 && w2 >= -1e-9 && w3 >= -1e-9) cells[iu * nv + iv] = 1
      }
  }
  let mask = cells
  for (let s = 0; s < shrink; s++) {
    const next = new Uint8Array(mask.length)
    for (let iu = 1; iu < nu - 1; iu++)
      for (let iv = 1; iv < nv - 1; iv++)
        if (mask[iu * nv + iv] && mask[(iu - 1) * nv + iv] && mask[(iu + 1) * nv + iv] && mask[iu * nv + iv - 1] && mask[iu * nv + iv + 1]) next[iu * nv + iv] = 1
    mask = next
  }
  return (u: number, v: number) => {
    const iu = Math.floor((u - u0) / MASK_CELL), iv = Math.floor((v - v0) / MASK_CELL)
    return iu >= 0 && iv >= 0 && iu < nu && iv < nv && mask[iu * nv + iv] === 1
  }
}

/** How closely a scan point's normal must face the feature's to count:
 *  keeps the floor's points out of a wall's reading where they meet. */
const FACING = 0.5

export function measure(features: Features, scan: Float64Array, opts: MeasureOptions = DEFAULT_MEASURE, normals?: Float64Array): Readings {
  const grid = new Grid(scan, 2)
  const { band, footBand, footAbove } = opts
  const bed = features.zMin
  const planes: PlaneReading[] = []
  const missed: string[] = []
  for (const p of features.planes) {
    const [ua, va] = p.axis === 0 ? [1, 2] : p.axis === 1 ? [0, 2] : [0, 1]
    const inside = footprint(p, 1)
    const lo = [...p.min], hi = [...p.max]
    lo[p.axis] -= band
    hi[p.axis] += band
    const upright = p.axis !== 2
    const onBed = upright && p.min[2] - bed < 0.05
    const main: number[] = [], low: number[] = [], above: number[] = []
    for (const i of grid.near(lo, hi)) {
      const d = p.sign * (scan[3 * i + p.axis] - p.offset)
      if (Math.abs(d) > band) continue
      if (normals && p.sign * normals[3 * i + p.axis] < FACING) continue
      const u = scan[3 * i + ua], v = scan[3 * i + va]
      const z = scan[3 * i + 2] - bed
      if (onBed && z < footBand + 0.05 && z > 0.02 && inside(u, Math.max(v, bed + MASK_CELL * 2))) low.push(d)
      if (!inside(u, v)) continue
      if (upright && z < footBand + 0.5) continue
      main.push(d)
      if (onBed && z >= footBand + 0.5 && z < footBand + footAbove) above.push(d)
    }
    if (main.length < MIN_POINTS) {
      missed.push(p.id)
      continue
    }
    const m = median(main), s = mad(main, m)
    const nEff = Math.max(1, Math.min(main.length, p.area / INDEPENDENT_MM2))
    const reading: PlaneReading = { id: p.id, axis: p.axis, sign: p.sign, nominal: p.offset, offset: r4(m), se: r4(Math.max(1.2533 * s / Math.sqrt(nEff), 1e-4)), scatter: r4(s), points: main.length }
    if (onBed && low.length >= MIN_POINTS / 2 && above.length >= MIN_POINTS / 2) {
      const ml = median(low), ma = median(above)
      const se = Math.hypot(1.2533 * mad(low, ml) / Math.sqrt(low.length), 1.2533 * mad(above, ma) / Math.sqrt(above.length))
      reading.foot = { band: r4(ml), above: r4(ma), se: r4(Math.max(se, 1e-4)), points: low.length }
    }
    planes.push(reading)
  }

  const circles: CircleReading[] = []
  for (const c of features.circles) {
    const reach = c.radius + band
    const lo = [c.center[0] - reach, c.center[1] - reach, c.zMin], hi = [c.center[0] + reach, c.center[1] + reach, c.zMax]
    const onBed = c.zMin - bed < 0.05
    const xs: number[] = [], ys: number[] = [], fx: number[] = [], fy: number[] = []
    for (const i of grid.near(lo, hi)) {
      const x = scan[3 * i], y = scan[3 * i + 1], z = scan[3 * i + 2]
      const r = Math.hypot(x - c.center[0], y - c.center[1])
      if (Math.abs(r - c.radius) > band) continue
      if (normals && r > 0) {
        const radial = (normals[3 * i] * (x - c.center[0]) + normals[3 * i + 1] * (y - c.center[1])) / r
        if ((c.kind === 'boss' ? radial : -radial) < FACING) continue
      }
      if (onBed && z - bed > 0.02 && z - bed < footBand + 0.05) {
        fx.push(x)
        fy.push(y)
        continue
      }
      if (z < c.zMin + 0.3 || z > c.zMax - 0.3) continue
      if (onBed && z - bed < footBand + 0.5) continue
      xs.push(x)
      ys.push(y)
    }
    if (xs.length < MIN_POINTS) {
      missed.push(c.id)
      continue
    }
    const fit = fitCircle(xs, ys)
    if (!fit) {
      missed.push(c.id)
      continue
    }
    const res = xs.map((x, i) => Math.hypot(x - fit.cx, ys[i] - fit.cy) - fit.radius)
    const s = mad(res, median(res))
    const wall = 2 * Math.PI * c.radius * (c.zMax - c.zMin)
    const nEff = Math.max(1, Math.min(xs.length, wall / INDEPENDENT_MM2))
    const reading: CircleReading = {
      id: c.id,
      kind: c.kind,
      nominal: { center: c.center, radius: c.radius },
      center: [r4(fit.cx), r4(fit.cy)],
      radius: r4(fit.radius),
      seRadius: r4(Math.max((1.2533 * s) / Math.sqrt(nEff), 1e-4)),
      seCenter: r4(Math.max((1.2533 * s * Math.SQRT2) / Math.sqrt(nEff), 1e-4)),
      scatter: r4(s),
      points: xs.length,
    }
    if (onBed && fx.length >= MIN_POINTS / 2) {
      // The band's radius about the wall's own centre.
      const rs = fx.map((x, i) => Math.hypot(x - fit.cx, fy[i] - fit.cy))
      const mr = median(rs)
      reading.foot = { radius: r4(mr), se: r4(Math.max((1.2533 * mad(rs, mr)) / Math.sqrt(fx.length), 1e-4)), points: fx.length }
    }
    circles.push(reading)
  }
  const flatScatter = planes.map((p) => p.scatter).filter((s) => s > 0)
  return { planes, circles, noise: r4(median(flatScatter)), missed }
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4
