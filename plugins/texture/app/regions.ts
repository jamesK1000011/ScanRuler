// SPDX-License-Identifier: AGPL-3.0-only
// Which scan vertices a region names — the shapes Mesh Tools takes (marked,
// box, sphere, vertices, narrowed by facing) and BumpMesh's fill: grow from
// the face nearest a point across every edge gentler than spreadDeg, the
// way its bucket fills one smooth surface and stops at a crease. Worked on
// the welded scan (SceneManager.scanMesh), whose vertex numbers are the ones
// scan.segment, mesh.mark and the brush count.

import type { Vec3 } from '../../../src/core/types'

export interface ScanSurface {
  positions: Float32Array
  indices: Uint32Array
  normals: Float32Array
}

export type RegionShape = {
  box?: { min: Vec3; max: Vec3 }
  sphere?: { center: Vec3; radius: number }
  vertices?: number[]
  near?: Vec3
  spreadDeg?: number
  facing?: Vec3
  angleDeg?: number
}

export const DEFAULT_FACING_DEG = 30
export const DEFAULT_SPREAD_DEG = 20

/** Vertex numbers a shape holds, sorted. */
export function shapeVertices(mesh: ScanSurface, shape: RegionShape): Uint32Array {
  const { positions: p, normals: n } = mesh
  const count = p.length / 3
  const given = (['box', 'sphere', 'vertices', 'near'] as const).filter((k) => shape[k] !== undefined)
  if (given.length !== 1) throw new Error('Name the region one way: box, sphere, vertices or near — with facing and angleDeg to narrow it.')
  let picked: Uint8Array
  if (shape.near) {
    picked = grownFrom(mesh, shape.near, shape.spreadDeg ?? DEFAULT_SPREAD_DEG)
  } else {
    picked = new Uint8Array(count)
    if (shape.box) {
      const { min, max } = shape.box
      for (let v = 0; v < count; v++) {
        const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2]
        if (x >= min[0] && y >= min[1] && z >= min[2] && x <= max[0] && y <= max[1] && z <= max[2]) picked[v] = 1
      }
    } else if (shape.sphere) {
      const { center: c, radius } = shape.sphere
      const r2 = radius * radius
      for (let v = 0; v < count; v++) {
        const dx = p[v * 3] - c[0], dy = p[v * 3 + 1] - c[1], dz = p[v * 3 + 2] - c[2]
        if (dx * dx + dy * dy + dz * dz <= r2) picked[v] = 1
      }
    } else if (shape.vertices) {
      for (const v of shape.vertices) {
        if (!Number.isInteger(v) || v < 0 || v >= count) throw new Error(`Vertex ${v} is not one of the scan's ${count}.`)
        picked[v] = 1
      }
    }
  }
  if (shape.facing) {
    const f = unit(shape.facing)
    const cos = Math.cos(((shape.angleDeg ?? DEFAULT_FACING_DEG) * Math.PI) / 180)
    for (let v = 0; v < count; v++) {
      if (!picked[v]) continue
      const d = n[v * 3] * f[0] + n[v * 3 + 1] * f[1] + n[v * 3 + 2] * f[2]
      if (d < cos) picked[v] = 0
    }
  }
  return listOf(picked)
}

/** Every vertex of the faces reached from the face nearest `point`, across
 *  edges whose faces turn less than `spreadDeg` from each other. */
function grownFrom(mesh: ScanSurface, point: Vec3, spreadDeg: number): Uint8Array {
  const { positions: p, indices: ix } = mesh
  const faces = ix.length / 3
  const faceN = faceNormals(p, ix)
  // The seed: the face whose surface comes nearest the point, as BumpMesh's
  // bucket starts from the face under the cursor. Not the nearest centre: on
  // a coarse CAD mesh a wall's two long triangles have their centres far
  // off, and a small face in a pocket behind the wall won.
  let seed = -1
  let best = Infinity
  for (let f = 0; f < faces; f++) {
    const d = distanceToTriangle(p, ix[f * 3], ix[f * 3 + 1], ix[f * 3 + 2], point)
    if (d < best) { best = d; seed = f }
  }
  const picked = new Uint8Array(p.length / 3)
  if (seed < 0) return picked
  const adj = edgeNeighbours(ix, p.length / 3)
  const cos = Math.cos((spreadDeg * Math.PI) / 180)
  const seen = new Uint8Array(faces)
  const queue = [seed]
  seen[seed] = 1
  while (queue.length) {
    const f = queue.pop()!
    for (let k = 0; k < 3; k++) picked[ix[f * 3 + k]] = 1
    for (const g of adj(f)) {
      if (seen[g]) continue
      const d = faceN[f * 3] * faceN[g * 3] + faceN[f * 3 + 1] * faceN[g * 3 + 1] + faceN[f * 3 + 2] * faceN[g * 3 + 2]
      if (d < cos) continue
      seen[g] = 1
      queue.push(g)
    }
  }
  return picked
}

/** Squared distance from a point to a triangle's surface (closest point on
 *  the triangle, Ericson, Real-Time Collision Detection 5.1.5). */
export function distanceToTriangle(p: ArrayLike<number>, ia: number, ib: number, ic: number, q: Vec3): number {
  const ax = p[ia * 3], ay = p[ia * 3 + 1], az = p[ia * 3 + 2]
  const abx = p[ib * 3] - ax, aby = p[ib * 3 + 1] - ay, abz = p[ib * 3 + 2] - az
  const acx = p[ic * 3] - ax, acy = p[ic * 3 + 1] - ay, acz = p[ic * 3 + 2] - az
  const apx = q[0] - ax, apy = q[1] - ay, apz = q[2] - az
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz
  const at = (u: number, v: number) => {
    const x = ax + abx * u + acx * v - q[0], y = ay + aby * u + acy * v - q[1], z = az + abz * u + acz * v - q[2]
    return x * x + y * y + z * z
  }
  if (d1 <= 0 && d2 <= 0) return at(0, 0)
  const bpx = q[0] - p[ib * 3], bpy = q[1] - p[ib * 3 + 1], bpz = q[2] - p[ib * 3 + 2]
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return at(1, 0)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(d1 / (d1 - d3), 0)
  const cpx = q[0] - p[ic * 3], cpy = q[1] - p[ic * 3 + 1], cpz = q[2] - p[ic * 3 + 2]
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return at(0, 1)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(0, d2 / (d2 - d6))
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return at(1 - w, w)
  }
  const den = 1 / (va + vb + vc)
  return at(vb * den, vc * den)
}

function faceNormals(p: Float32Array, ix: Uint32Array): Float32Array {
  const out = new Float32Array(ix.length)
  for (let f = 0; f < ix.length / 3; f++) {
    const a = ix[f * 3] * 3, b = ix[f * 3 + 1] * 3, c = ix[f * 3 + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    out[f * 3] = nx / l; out[f * 3 + 1] = ny / l; out[f * 3 + 2] = nz / l
  }
  return out
}

/** The faces sharing an edge with a face, through a vertex → faces table. */
function edgeNeighbours(ix: Uint32Array, vertexCount: number): (f: number) => number[] {
  const start = new Uint32Array(vertexCount + 1)
  for (let i = 0; i < ix.length; i++) start[ix[i] + 1]++
  for (let v = 0; v < vertexCount; v++) start[v + 1] += start[v]
  const at = start.slice(0, vertexCount)
  const faceOf = new Uint32Array(ix.length)
  for (let i = 0; i < ix.length; i++) faceOf[at[ix[i]]++] = (i / 3) | 0
  return (f) => {
    const out: number[] = []
    for (let k = 0; k < 3; k++) {
      const a = ix[f * 3 + k], b = ix[f * 3 + ((k + 1) % 3)]
      for (let j = start[a]; j < start[a + 1]; j++) {
        const g = faceOf[j]
        if (g === f) continue
        const g0 = ix[g * 3], g1 = ix[g * 3 + 1], g2 = ix[g * 3 + 2]
        if (g0 === b || g1 === b || g2 === b) out.push(g)
      }
    }
    return out
  }
}

const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2])
  if (!(l > 0)) throw new Error('facing must be a direction, not zero.')
  return [v[0] / l, v[1] / l, v[2] / l]
}

export function listOf(flags: Uint8Array): Uint32Array {
  let n = 0
  for (let i = 0; i < flags.length; i++) n += flags[i]
  const out = new Uint32Array(n)
  for (let i = 0, k = 0; i < flags.length; i++) if (flags[i]) out[k++] = i
  return out
}

/** Sorted union, difference of vertex lists. */
export function combine(a: Uint32Array | null, b: Uint32Array, op: 'add' | 'remove', count: number): Uint32Array {
  const flags = new Uint8Array(count)
  if (a) for (const v of a) if (v < count) flags[v] = 1
  for (const v of b) if (v < count) flags[v] = op === 'add' ? 1 : 0
  return listOf(flags)
}

/** Box of a vertex list, and the area of the faces wholly inside it. */
export function regionStats(mesh: ScanSurface, vertices: Uint32Array | null): { vertices: number; faces: number; areaMm2: number; box: { min: Vec3; max: Vec3 } | null } {
  if (!vertices || !vertices.length) return { vertices: 0, faces: 0, areaMm2: 0, box: null }
  const { positions: p, indices: ix } = mesh
  const on = new Uint8Array(p.length / 3)
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const v of vertices) {
    on[v] = 1
    for (let k = 0; k < 3; k++) { const x = p[v * 3 + k]; if (x < min[k]) min[k] = x; if (x > max[k]) max[k] = x }
  }
  let faces = 0
  let area = 0
  for (let f = 0; f < ix.length / 3; f++) {
    const a = ix[f * 3], b = ix[f * 3 + 1], c = ix[f * 3 + 2]
    if (!(on[a] && on[b] && on[c])) continue
    faces++
    area += triArea(p, a, b, c)
  }
  const r = (x: number) => Math.round(x * 1000) / 1000
  return { vertices: vertices.length, faces, areaMm2: Math.round(area * 10) / 10, box: { min: min.map(r) as Vec3, max: max.map(r) as Vec3 } }
}

export function triArea(p: ArrayLike<number>, a: number, b: number, c: number): number {
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2]
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2]
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
}
