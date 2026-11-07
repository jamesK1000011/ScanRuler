// SPDX-License-Identifier: AGPL-3.0-only
// The features of the reference part a print's size is read on, found on
// its triangles in the build frame:
//  - flat faces square to an axis (walls facing ±X and ±Y, floors and tops
//    facing ±Z), each with the triangles it covers;
//  - round walls standing upright — holes and bosses — each a circle fitted
//    to a connected run of upright triangles that goes most of the way round.
// A part's other faces (drafts, curves, fillets) are left out: what is read
// here has to have a size the slicer's settings move.

export interface PlaneFeature {
  id: string
  kind: 'plane'
  /** The axis the face is square to, 0 X, 1 Y, 2 Z, and which way it faces
   *  out of the material. */
  axis: 0 | 1 | 2
  sign: 1 | -1
  /** Where it lies along the axis, mm. */
  offset: number
  area: number
  /** Its triangles in the build frame, x y z × 3 each. */
  triangles: Float64Array
  /** Its extent in the build frame. */
  min: [number, number, number]
  max: [number, number, number]
}

export interface CircleFeature {
  id: string
  kind: 'hole' | 'boss'
  center: [number, number]
  radius: number
  zMin: number
  zMax: number
  /** How far round the triangles go, degrees. */
  coverage: number
  /** RMS of the triangles' corners off the fitted circle, mm. */
  fit: number
}

export interface Features {
  planes: PlaneFeature[]
  circles: CircleFeature[]
  /** The bed: the lowest point of the part. */
  zMin: number
  zMax: number
}

const AXIS_COS = Math.cos((2 * Math.PI) / 180)
const UPRIGHT = 0.1
const PLANE_BIN = 0.02
const MIN_PLANE_AREA = 4
const MIN_COVERAGE = 270

export function findFeatures(positions: Float64Array, indices: ArrayLike<number> | null): Features {
  const tri = (t: number, k: number) => (indices ? indices[3 * t + k] : 3 * t + k)
  const triCount = indices ? indices.length / 3 : positions.length / 9
  let zMin = Infinity, zMax = -Infinity
  for (let i = 2; i < positions.length; i += 3) {
    zMin = Math.min(zMin, positions[i])
    zMax = Math.max(zMax, positions[i])
  }
  const normal = new Float64Array(3 * triCount), area = new Float64Array(triCount)
  for (let t = 0; t < triCount; t++) {
    const a = 3 * tri(t, 0), b = 3 * tri(t, 1), c = 3 * tri(t, 2)
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz)
    area[t] = l / 2
    if (l > 0) normal.set([nx / l, ny / l, nz / l], 3 * t)
  }

  // ---- upright round walls -----------------------------------------------------------------
  const key = (i: number) => `${Math.round(positions[3 * i] * 1e4)},${Math.round(positions[3 * i + 1] * 1e4)},${Math.round(positions[3 * i + 2] * 1e4)}`
  const weld = new Map<string, number>()
  const vid = (i: number) => {
    const k = key(i)
    let v = weld.get(k)
    if (v === undefined) weld.set(k, (v = weld.size))
    return v
  }
  const upright: number[] = []
  for (let t = 0; t < triCount; t++) if (area[t] > 0 && Math.abs(normal[3 * t + 2]) < UPRIGHT) upright.push(t)
  const parent = new Map<number, number>()
  const find = (x: number): number => {
    let r = x
    while (parent.get(r)! !== r) r = parent.get(r)!
    let y = x
    while (parent.get(y)! !== r) {
      const n = parent.get(y)!
      parent.set(y, r)
      y = n
    }
    return r
  }
  const owner = new Map<number, number>()
  for (const t of upright) {
    parent.set(t, t)
    for (let k = 0; k < 3; k++) {
      const v = vid(tri(t, k))
      const o = owner.get(v)
      if (o === undefined) owner.set(v, t)
      else {
        const a = find(o), b = find(t)
        if (a !== b) parent.set(a, b)
      }
    }
  }
  const groups = new Map<number, number[]>()
  for (const t of upright) {
    const r = find(t)
    const g = groups.get(r)
    if (g) g.push(t)
    else groups.set(r, [t])
  }
  const used = new Set<number>()
  const circles: CircleFeature[] = []
  for (const g of groups.values()) {
    if (g.length < 8) continue
    const xs: number[] = [], ys: number[] = []
    let z0 = Infinity, z1 = -Infinity
    for (const t of g)
      for (let k = 0; k < 3; k++) {
        const i = 3 * tri(t, k)
        xs.push(positions[i])
        ys.push(positions[i + 1])
        z0 = Math.min(z0, positions[i + 2])
        z1 = Math.max(z1, positions[i + 2])
      }
    const c = fitCircle(xs, ys)
    if (!c || c.radius < 0.5 || c.radius > 150) continue
    if (c.rms > 0.01 + 0.02 * c.radius) continue
    const coverage = angularCoverage(xs, ys, c.cx, c.cy)
    if (coverage < MIN_COVERAGE) continue
    // Which way the walls face: toward the axis, a hole; away, a boss.
    let out = 0
    for (const t of g) {
      const i = 3 * tri(t, 0)
      out += area[t] * (normal[3 * t] * (positions[i] - c.cx) + normal[3 * t + 1] * (positions[i + 1] - c.cy))
    }
    circles.push({ id: '', kind: out < 0 ? 'hole' : 'boss', center: [r4(c.cx), r4(c.cy)], radius: r4(c.radius), zMin: r4(z0), zMax: r4(z1), coverage: Math.round(coverage), fit: r4(c.rms) })
    for (const t of g) used.add(t)
  }
  circles.sort((a, b) => a.kind.localeCompare(b.kind) || a.radius - b.radius || a.center[0] - b.center[0])
  circles.forEach((c, i) => (c.id = `${c.kind === 'hole' ? 'H' : 'B'}${i + 1}`))

  // ---- flat faces square to an axis ---------------------------------------------------------
  const bins = new Map<string, number[]>()
  for (let t = 0; t < triCount; t++) {
    if (used.has(t) || area[t] <= 0) continue
    for (let axis = 0; axis < 3; axis++) {
      const n = normal[3 * t + axis]
      if (Math.abs(n) < AXIS_COS) continue
      const i = 3 * tri(t, 0)
      const k = `${axis},${n > 0 ? 1 : -1},${Math.round(positions[i + axis] / PLANE_BIN)}`
      const list = bins.get(k)
      if (list) list.push(t)
      else bins.set(k, [t])
    }
  }
  // Neighbouring bins are one face, split by rounding.
  const merged = new Map<string, number[]>()
  for (const [k, list] of [...bins.entries()].sort()) {
    const [axis, sign, b] = k.split(',').map(Number)
    const near = [`${axis},${sign},${b - 1}`, `${axis},${sign},${b + 1}`].find((n) => merged.has(n))
    if (near) merged.get(near)!.push(...list)
    else merged.set(k, [...list])
  }
  const planes: PlaneFeature[] = []
  for (const [k, list] of merged) {
    const [axis, sign] = k.split(',').map(Number) as [0 | 1 | 2, 1 | -1]
    const total = list.reduce((s, t) => s + area[t], 0)
    if (total < MIN_PLANE_AREA) continue
    const tris = new Float64Array(list.length * 9)
    const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    let off = 0
    list.forEach((t, j) => {
      for (let v = 0; v < 3; v++) {
        const i = 3 * tri(t, v)
        for (let a = 0; a < 3; a++) {
          tris[9 * j + 3 * v + a] = positions[i + a]
          min[a] = Math.min(min[a], positions[i + a])
          max[a] = Math.max(max[a], positions[i + a])
        }
        off += (area[t] * positions[i + axis]) / 3
      }
    })
    planes.push({ id: '', kind: 'plane', axis, sign, offset: r4(off / total), area: Math.round(total * 10) / 10, triangles: tris, min, max })
  }
  planes.sort((a, b) => a.axis - b.axis || a.offset - b.offset || a.sign - b.sign)
  const axisName = ['X', 'Y', 'Z']
  const count: Record<string, number> = {}
  for (const p of planes) {
    const base = `${p.sign > 0 ? '+' : '-'}${axisName[p.axis]}`
    count[base] = (count[base] ?? 0) + 1
    p.id = `${base}${count[base]}`
  }
  return { planes, circles, zMin, zMax }
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4

/** Least-squares circle (Kåsa), then a few Gauss–Newton steps on the
 *  geometric distance. */
export function fitCircle(xs: ArrayLike<number>, ys: ArrayLike<number>): { cx: number; cy: number; radius: number; rms: number } | null {
  const n = xs.length
  if (n < 3) return null
  let mx = 0, my = 0
  for (let i = 0; i < n; i++) {
    mx += xs[i]
    my += ys[i]
  }
  mx /= n
  my /= n
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0
  for (let i = 0; i < n; i++) {
    const u = xs[i] - mx, v = ys[i] - my
    suu += u * u
    svv += v * v
    suv += u * v
    suuu += u * u * u
    svvv += v * v * v
    suvv += u * v * v
    svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  if (Math.abs(det) < 1e-12) return null
  const b1 = (suuu + suvv) / 2, b2 = (svvv + svuu) / 2
  let cx = mx + (b1 * svv - b2 * suv) / det
  let cy = my + (b2 * suu - b1 * suv) / det
  let r = 0
  for (let i = 0; i < n; i++) r += Math.hypot(xs[i] - cx, ys[i] - cy)
  r /= n
  for (let it = 0; it < 5; it++) {
    let a11 = 0, a12 = 0, a13 = 0, a22 = 0, a23 = 0, a33 = 0, g1 = 0, g2 = 0, g3 = 0
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - cx, dy = ys[i] - cy
      const d = Math.hypot(dx, dy) || 1e-12
      const res = d - r
      const j1 = -dx / d, j2 = -dy / d, j3 = -1
      a11 += j1 * j1; a12 += j1 * j2; a13 += j1 * j3; a22 += j2 * j2; a23 += j2 * j3; a33 += j3 * j3
      g1 += j1 * res; g2 += j2 * res; g3 += j3 * res
    }
    const m = [[a11, a12, a13], [a12, a22, a23], [a13, a23, a33]]
    const step = solve3(m, [-g1, -g2, -g3])
    if (!step) break
    cx += step[0]
    cy += step[1]
    r += step[2]
    if (Math.hypot(...step) < 1e-9) break
  }
  let ss = 0
  for (let i = 0; i < n; i++) ss += (Math.hypot(xs[i] - cx, ys[i] - cy) - r) ** 2
  return { cx, cy, radius: r, rms: Math.sqrt(ss / n) }
}

function solve3(m: number[][], b: number[]): number[] | null {
  const a = m.map((row, i) => [...row, b[i]])
  for (let c = 0; c < 3; c++) {
    let p = c
    for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r
    if (Math.abs(a[p][c]) < 1e-14) return null
    ;[a[c], a[p]] = [a[p], a[c]]
    for (let r = 0; r < 3; r++) {
      if (r === c) continue
      const f = a[r][c] / a[c][c]
      for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k]
    }
  }
  return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]]
}

/** Degrees of the circle the points cover, from the largest gap between them. */
function angularCoverage(xs: number[], ys: number[], cx: number, cy: number): number {
  const angles = xs.map((x, i) => Math.atan2(ys[i] - cy, x - cx)).sort((a, b) => a - b)
  let gap = angles[0] + 2 * Math.PI - angles[angles.length - 1]
  for (let i = 1; i < angles.length; i++) gap = Math.max(gap, angles[i] - angles[i - 1])
  return 360 - (gap * 180) / Math.PI
}
