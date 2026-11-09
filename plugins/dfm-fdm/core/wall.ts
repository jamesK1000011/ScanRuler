// SPDX-License-Identifier: AGPL-3.0-only
// Wall thickness on a CAD mesh: the part's surface sampled at a spacing, and
// from each sample a ray straight into the material along the face's normal
// to where it comes out the far side. The scan's thickness map reads at its
// vertices; a CAD body's few long triangles have too few for that — a top
// face of two triangles over a magnet pocket has no vertex above the pocket
// at all — so the samples are laid over the faces, at least one to every
// spacing along each triangle's longest edge.
//
// A hit only counts as the far side if it faces back at the ray within 60°,
// as the scan's measure asks: a ray grazing along a rib, or leaving through a
// rim, would otherwise report the length of the part.
//
// Each sample also keeps how far the far side leans from parallel: a wall
// between parallel faces is as thin a step along as here, but where the faces
// meet at an angle — a lip or a chamfer narrowing to a knife edge — the wall
// thickens by tan(angle) for each step away from the edge. A taper of 26.6°
// or more (tan ½: the limit reached within two limits of the edge, whatever
// the limit) is a sharp edge, which the slicer prints as a single line, not
// a thin wall; a shallower one, or a draft, is thin for long enough to be
// one.

export interface WallSamples {
  /** Each sample's point on the surface, x y z. */
  points: Float64Array
  /** The wall behind it, mm; NaN when nothing within `reach`. */
  thickness: Float32Array
  /** The surface each sample stands for, mm². */
  area: Float32Array
  /** How fast the wall thickens along the surface, mm per mm: the tangent
   *  of the angle between the two faces — 0 between parallel faces; NaN
   *  when nothing within `reach`. */
  taper: Float32Array
  /** The spacing laid out — wider than asked when the part is large. */
  spacing: number
  reach: number
}

/** cos 60°: how squarely the far side must face the ray. */
const FACING = 0.5
const LEAF = 4

interface Bvh {
  /** Per node: box min x y z, max x y z. */
  box: Float64Array
  /** Per node: first child (inner) or first triangle (leaf), and count (0 inner). */
  start: Int32Array
  count: Int32Array
  tris: Int32Array
}

function buildBvh(p: Float64Array, idx: Uint32Array): Bvh {
  const n = idx.length / 3
  const cx = new Float64Array(3 * n), lo = new Float64Array(3 * n), hi = new Float64Array(3 * n)
  for (let t = 0; t < n; t++)
    for (let k = 0; k < 3; k++) {
      const a = p[3 * idx[3 * t] + k], b = p[3 * idx[3 * t + 1] + k], c = p[3 * idx[3 * t + 2] + k]
      lo[3 * t + k] = Math.min(a, b, c)
      hi[3 * t + k] = Math.max(a, b, c)
      cx[3 * t + k] = (a + b + c) / 3
    }
  const tris = new Int32Array(n)
  for (let t = 0; t < n; t++) tris[t] = t
  const most = 2 * n + 1
  const box = new Float64Array(6 * most), start = new Int32Array(most), count = new Int32Array(most)
  let nodes = 1
  const stack: [number, number, number][] = [[0, 0, n]]
  while (stack.length) {
    const [node, from, to] = stack.pop()!
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    const c0 = [Infinity, Infinity, Infinity], c1 = [-Infinity, -Infinity, -Infinity]
    for (let i = from; i < to; i++) {
      const t = tris[i]
      x0 = Math.min(x0, lo[3 * t]); y0 = Math.min(y0, lo[3 * t + 1]); z0 = Math.min(z0, lo[3 * t + 2])
      x1 = Math.max(x1, hi[3 * t]); y1 = Math.max(y1, hi[3 * t + 1]); z1 = Math.max(z1, hi[3 * t + 2])
      for (let k = 0; k < 3; k++) {
        c0[k] = Math.min(c0[k], cx[3 * t + k])
        c1[k] = Math.max(c1[k], cx[3 * t + k])
      }
    }
    box.set([x0, y0, z0, x1, y1, z1], 6 * node)
    const axis = c1[1] - c0[1] > c1[0] - c0[0] ? (c1[2] - c0[2] > c1[1] - c0[1] ? 2 : 1) : c1[2] - c0[2] > c1[0] - c0[0] ? 2 : 0
    if (to - from <= LEAF || c1[axis] - c0[axis] <= 0) {
      start[node] = from
      count[node] = to - from
      continue
    }
    // Split at the middle of the centroids' spread: no sort, and a long
    // thin triangle's neighbours stay together.
    const mid = (c0[axis] + c1[axis]) / 2
    let i = from, j = to - 1
    while (i <= j) {
      if (cx[3 * tris[i] + axis] < mid) i++
      else {
        const s = tris[i]
        tris[i] = tris[j]
        tris[j--] = s
      }
    }
    if (i === from || i === to) i = (from + to) >> 1
    const left = nodes
    nodes += 2
    start[node] = left
    count[node] = 0
    stack.push([left, from, i], [left + 1, i, to])
  }
  return { box, start, count, tris }
}

/** The triangle the last `shoot` hit. */
let hitTri = -1

/** Distance along the ray to the nearest triangle that faces it, within
 *  (near, far); Infinity when none; the triangle in `hitTri`. */
function shoot(b: Bvh, p: Float64Array, idx: Uint32Array, normal: Float64Array, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, near: number, far: number): number {
  let best = far
  hitTri = -1
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz
  const stack = [0]
  while (stack.length) {
    const node = stack.pop()!
    const o = 6 * node
    let tx0 = (b.box[o] - ox) * ix, tx1 = (b.box[o + 3] - ox) * ix
    if (tx0 > tx1) [tx0, tx1] = [tx1, tx0]
    let ty0 = (b.box[o + 1] - oy) * iy, ty1 = (b.box[o + 4] - oy) * iy
    if (ty0 > ty1) [ty0, ty1] = [ty1, ty0]
    let tz0 = (b.box[o + 2] - oz) * iz, tz1 = (b.box[o + 5] - oz) * iz
    if (tz0 > tz1) [tz0, tz1] = [tz1, tz0]
    const enter = Math.max(tx0, ty0, tz0, 0), exit = Math.min(tx1, ty1, tz1, best)
    // NaN (a ray along a box face) reads as a hit: kept, not lost.
    if (enter > exit) continue
    if (b.count[node] === 0) {
      stack.push(b.start[node], b.start[node] + 1)
      continue
    }
    for (let i = b.start[node]; i < b.start[node] + b.count[node]; i++) {
      const t = b.tris[i]
      if (Math.abs(normal[3 * t] * dx + normal[3 * t + 1] * dy + normal[3 * t + 2] * dz) < FACING) continue
      // Möller–Trumbore, both sides.
      const a = 3 * idx[3 * t], v1 = 3 * idx[3 * t + 1], v2 = 3 * idx[3 * t + 2]
      const e1x = p[v1] - p[a], e1y = p[v1 + 1] - p[a + 1], e1z = p[v1 + 2] - p[a + 2]
      const e2x = p[v2] - p[a], e2y = p[v2 + 1] - p[a + 1], e2z = p[v2 + 2] - p[a + 2]
      const hx = dy * e2z - dz * e2y, hy = dz * e2x - dx * e2z, hz = dx * e2y - dy * e2x
      const det = e1x * hx + e1y * hy + e1z * hz
      if (Math.abs(det) < 1e-15) continue
      const f = 1 / det
      const sx = ox - p[a], sy = oy - p[a + 1], sz = oz - p[a + 2]
      const u = f * (sx * hx + sy * hy + sz * hz)
      if (u < 0 || u > 1) continue
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x
      const v = f * (dx * qx + dy * qy + dz * qz)
      if (v < 0 || u + v > 1) continue
      const d = f * (e2x * qx + e2y * qy + e2z * qz)
      if (d > near && d < best) {
        best = d
        hitTri = t
      }
    }
  }
  return best < far ? best : Infinity
}

/** Lay samples over the surface `spacing` apart (widened until there are no
 *  more than `most`) and read the wall behind each, up to `reach`. */
export function probeWalls(p: Float64Array, idx: Uint32Array, opts: { spacing: number; reach: number; most?: number }): WallSamples {
  const n = idx.length / 3
  const most = opts.most ?? 150_000
  const normal = new Float64Array(3 * n)
  const sides = new Float64Array(3 * n), area = new Float64Array(n)
  let volume = 0
  for (let t = 0; t < n; t++) {
    const a = 3 * idx[3 * t], b = 3 * idx[3 * t + 1], c = 3 * idx[3 * t + 2]
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz)
    area[t] = l / 2
    if (l > 0) normal.set([nx / l, ny / l, nz / l], 3 * t)
    sides.set([Math.hypot(ux, uy, uz), Math.hypot(p[c] - p[b], p[c + 1] - p[b + 1], p[c + 2] - p[b + 2]), Math.hypot(vx, vy, vz)], 3 * t)
    volume += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6
  }
  // Into the material is against the outward normal: a mesh wound inside
  // out (negative volume) is read the other way round.
  const inward = volume < 0 ? 1 : -1
  // How many pieces halving each triangle's longest edge until it is
  // under s makes, counted without making them.
  const pieces = (s: number) => {
    let k = 0
    const count = (a: number, b: number, c: number, depth: number): number => {
      const m = Math.max(a, b, c)
      if (m <= s || depth > 24) return 1
      // The halves of the longest edge, and the median the cut makes:
      // the other two sides by Apollonius.
      const [l, o1, o2] = m === a ? [a, b, c] : m === b ? [b, c, a] : [c, a, b]
      const med = Math.sqrt(Math.max(0, (2 * o1 * o1 + 2 * o2 * o2 - l * l) / 4))
      return count(l / 2, med, o2, depth + 1) + count(l / 2, o1, med, depth + 1)
    }
    for (let t = 0; t < n; t++) if (area[t] > 0) k += count(sides[3 * t], sides[3 * t + 1], sides[3 * t + 2], 0)
    return k
  }
  // A piece comes out at about an eighth of s² — the start, so a large part
  // is not counted out at a spacing it will never be laid at.
  let total = 0
  for (let t = 0; t < n; t++) total += area[t]
  let s = Math.max(opts.spacing, Math.sqrt((8 * total) / most))
  while (pieces(s) > most) s *= 1.1
  const pts: number[] = [], areas: number[] = [], from: number[] = []
  const split = (t: number, a: number[], b: number[], c: number[], depth: number) => {
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), bc = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]), ca = Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2])
    const m = Math.max(ab, bc, ca)
    if (m <= s || depth > 24) {
      pts.push((a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3)
      const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2]
      areas.push(Math.hypot(ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx) / 2)
      from.push(t)
      return
    }
    const mid = (u: number[], v: number[]) => [(u[0] + v[0]) / 2, (u[1] + v[1]) / 2, (u[2] + v[2]) / 2]
    if (m === ab) {
      const h = mid(a, b)
      split(t, a, h, c, depth + 1)
      split(t, h, b, c, depth + 1)
    } else if (m === bc) {
      const h = mid(b, c)
      split(t, a, b, h, depth + 1)
      split(t, a, h, c, depth + 1)
    } else {
      const h = mid(c, a)
      split(t, a, b, h, depth + 1)
      split(t, h, b, c, depth + 1)
    }
  }
  const corner = (v: number) => [p[3 * v], p[3 * v + 1], p[3 * v + 2]]
  for (let t = 0; t < n; t++) if (area[t] > 0) split(t, corner(idx[3 * t]), corner(idx[3 * t + 1]), corner(idx[3 * t + 2]), 0)

  const bvh = buildBvh(p, idx)
  const count = areas.length
  const thickness = new Float32Array(count), taper = new Float32Array(count)
  // Nothing nearer than this counts: the face the ray starts on, or a
  // coincident copy of it.
  const near = 1e-4 * Math.max(1, opts.reach)
  for (let i = 0; i < count; i++) {
    const t = from[i]
    const dx = inward * normal[3 * t], dy = inward * normal[3 * t + 1], dz = inward * normal[3 * t + 2]
    const d = shoot(bvh, p, idx, normal, pts[3 * i], pts[3 * i + 1], pts[3 * i + 2], dx, dy, dz, near, opts.reach)
    thickness[i] = d === Infinity ? NaN : d
    if (d === Infinity) taper[i] = NaN
    else {
      const h = hitTri
      const c = Math.min(1, Math.abs(normal[3 * t] * normal[3 * h] + normal[3 * t + 1] * normal[3 * h + 1] + normal[3 * t + 2] * normal[3 * h + 2]))
      taper[i] = Math.sqrt(1 - c * c) / c
    }
  }
  return { points: Float64Array.from(pts), thickness, area: Float32Array.from(areas), taper, spacing: s, reach: opts.reach }
}

/** A wall that thickens by half a step or more for each step along: from
 *  its edge it reaches any limit within two limits, so what is under the
 *  limit is the taper to a sharp edge, not a thin wall. Taken from the
 *  taper alone, not the thickness, so one wedge is all edge or all wall. */
const TAPERED = 0.5
const atEdge = (w: WallSamples, i: number) => w.taper[i] >= TAPERED

/** The samples picked joined into runs where they lie within `link` of each
 *  other, each with its least wall, where that is, and the surface it covers. */
function runsOf(w: WallSamples, pick: number[], link: number): { least: number; at: [number, number, number]; area: number; samples: number; members: number[] }[] {
  if (!pick.length) return []
  const key = (x: number, y: number, z: number) => `${Math.floor(x / link)},${Math.floor(y / link)},${Math.floor(z / link)}`
  const grid = new Map<string, number[]>()
  for (const i of pick) {
    const k = key(w.points[3 * i], w.points[3 * i + 1], w.points[3 * i + 2])
    const cell = grid.get(k)
    if (cell) cell.push(i)
    else grid.set(k, [i])
  }
  const seen = new Set<number>()
  const out: { least: number; at: [number, number, number]; area: number; samples: number; members: number[] }[] = []
  for (const i0 of pick) {
    if (seen.has(i0)) continue
    seen.add(i0)
    const stack = [i0], members: number[] = []
    let least = Infinity, at = i0, area = 0
    while (stack.length) {
      const i = stack.pop()!
      members.push(i)
      area += w.area[i]
      if (w.thickness[i] < least) {
        least = w.thickness[i]
        at = i
      }
      const x = w.points[3 * i], y = w.points[3 * i + 1], z = w.points[3 * i + 2]
      const gx = Math.floor(x / link), gy = Math.floor(y / link), gz = Math.floor(z / link)
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (let c = -1; c <= 1; c++)
            for (const j of grid.get(`${gx + a},${gy + b},${gz + c}`) ?? []) {
              if (seen.has(j)) continue
              if (Math.hypot(w.points[3 * j] - x, w.points[3 * j + 1] - y, w.points[3 * j + 2] - z) > link) continue
              seen.add(j)
              stack.push(j)
            }
    }
    out.push({ least, at: [w.points[3 * at], w.points[3 * at + 1], w.points[3 * at + 2]], area, samples: members.length, members })
  }
  return out.sort((a, b) => a.least - b.least)
}

/** The thin places: samples under `limit`, not at a sharp edge, joined into
 *  runs where they lie within `link` of each other — both faces of one thin
 *  wall are one run — each with its least wall, where that is, and the
 *  surface it covers. */
export function thinRuns(w: WallSamples, limit: number, link: number): { least: number; at: [number, number, number]; area: number; samples: number }[] {
  const thin: number[] = []
  for (let i = 0; i < w.thickness.length; i++) if (w.thickness[i] < limit && !atEdge(w, i)) thin.push(i)
  return runsOf(w, thin, link).map(({ members: _, ...run }) => run)
}

/** The sharp edges: samples under `limit` on a taper (TAPERED), joined into runs like thinRuns, each with its tip, the surface
 *  under the limit, and about how long the edge is. */
export function sharpEdges(w: WallSamples, limit: number, link: number): { at: [number, number, number]; length: number; area: number; samples: number }[] {
  const edge: number[] = []
  for (let i = 0; i < w.thickness.length; i++) if (w.thickness[i] < limit && atEdge(w, i)) edge.push(i)
  // Each face of a wedge is under the limit for limit / taper back from
  // the edge, so a sample covers area × taper / limit of edge — half of
  // that, the other face covering the rest.
  return runsOf(w, edge, link).map((run) => {
    let length = 0
    for (const i of run.members) length += (w.area[i] * w.taper[i]) / (2 * limit)
    return { at: run.at, length, area: run.area, samples: run.samples }
  })
}

/** The least wall read anywhere, and where; null when every wall is past
 *  the reach. With `edges: false`, a taper (TAPERED) is not a wall — a
 *  knife edge reads as nothing at its tip — and is passed over, unless
 *  there is nothing else. */
export function leastWall(w: WallSamples, opts: { edges?: boolean } = {}): { least: number; at: [number, number, number] } | null {
  const pick = (skip: (i: number) => boolean) => {
    let best = -1
    for (let i = 0; i < w.thickness.length; i++) if (w.thickness[i] === w.thickness[i] && !skip(i) && (best < 0 || w.thickness[i] < w.thickness[best])) best = i
    return best
  }
  let best = opts.edges === false ? pick((i) => atEdge(w, i)) : -1
  if (best < 0) best = pick(() => false)
  return best < 0 ? null : { least: w.thickness[best], at: [w.points[3 * best], w.points[3 * best + 1], w.points[3 * best + 2]] }
}
