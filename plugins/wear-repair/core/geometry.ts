// SPDX-License-Identifier: AGPL-3.0-only
// What wear-repair measures with: the nearest point of a surface to a
// point (three-mesh-bvh), signed by the surface's normal there; regions of
// the part as boxes and spheres with a soft edge; a mesh mirrored across a
// plane; and vertex normals and neighbours for smoothing a field over a
// mesh.

import * as THREE from 'three'
import { MeshBVH } from 'three-mesh-bvh'

export interface Mesh {
  positions: Float64Array
  indices: Uint32Array
}

export interface Surface {
  /** The nearest point of the surface, its distance, and the distance
   *  signed by the surface's outward normal there: + outside the material. */
  nearest(x: number, y: number, z: number): { point: [number, number, number]; distance: number; signed: number }
}

export function surface(mesh: Mesh): Surface {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(mesh.positions), 3))
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
  const bvh = new MeshBVH(g)
  const p = new THREE.Vector3()
  const hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 }
  const pos = g.getAttribute('position')
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3()
  return {
    nearest(x, y, z) {
      p.set(x, y, z)
      bvh.closestPointToPoint(p, hit as never)
      const f = hit.faceIndex
      a.fromBufferAttribute(pos, mesh.indices[3 * f])
      b.fromBufferAttribute(pos, mesh.indices[3 * f + 1])
      c.fromBufferAttribute(pos, mesh.indices[3 * f + 2])
      // The triangle's outward normal, (b − a) × (c − a).
      c.sub(a)
      n.subVectors(b, a).cross(c).normalize()
      const s = (x - hit.point.x) * n.x + (y - hit.point.y) * n.y + (z - hit.point.z) * n.z
      return { point: [hit.point.x, hit.point.y, hit.point.z], distance: hit.distance, signed: Math.sign(s || 1) * hit.distance }
    },
  }
}

export type Region = { kind: 'box'; min: [number, number, number]; max: [number, number, number] } | { kind: 'sphere'; center: [number, number, number]; radius: number }

/** How far a point is outside a region, mm: 0 inside. */
export function outside(r: Region, x: number, y: number, z: number): number {
  if (r.kind === 'sphere') return Math.max(0, Math.hypot(x - r.center[0], y - r.center[1], z - r.center[2]) - r.radius)
  const dx = Math.max(r.min[0] - x, 0, x - r.max[0]), dy = Math.max(r.min[1] - y, 0, y - r.max[1]), dz = Math.max(r.min[2] - z, 0, z - r.max[2])
  return Math.hypot(dx, dy, dz)
}

/** A point's weight in a set of regions: 1 inside any, falling to 0 over
 *  `blend` mm outside, 0 beyond — and 0 inside any region kept. */
export function weight(worn: readonly Region[], keep: readonly Region[], blend: number, x: number, y: number, z: number): number {
  if (keep.some((r) => outside(r, x, y, z) === 0)) return 0
  let w = 0
  for (const r of worn) {
    const d = outside(r, x, y, z)
    w = Math.max(w, d === 0 ? 1 : blend > 0 && d < blend ? 1 - d / blend : 0)
  }
  return w
}

/** A mesh mirrored across the plane through `point` with normal `normal`,
 *  its triangles wound back so they still face out. */
export function mirror(mesh: Mesh, point: readonly number[], normal: readonly number[]): Mesh {
  const l = Math.hypot(normal[0], normal[1], normal[2])
  const n = [normal[0] / l, normal[1] / l, normal[2] / l]
  const out = new Float64Array(mesh.positions.length)
  for (let i = 0; i < out.length; i += 3) {
    const d = (mesh.positions[i] - point[0]) * n[0] + (mesh.positions[i + 1] - point[1]) * n[1] + (mesh.positions[i + 2] - point[2]) * n[2]
    out[i] = mesh.positions[i] - 2 * d * n[0]
    out[i + 1] = mesh.positions[i + 1] - 2 * d * n[1]
    out[i + 2] = mesh.positions[i + 2] - 2 * d * n[2]
  }
  const idx = new Uint32Array(mesh.indices.length)
  for (let t = 0; t < idx.length; t += 3) {
    idx[t] = mesh.indices[t]
    idx[t + 1] = mesh.indices[t + 2]
    idx[t + 2] = mesh.indices[t + 1]
  }
  return { positions: out, indices: idx }
}

/** Area-weighted vertex normals and each vertex's neighbours. */
export function topology(mesh: Mesh): { normals: Float64Array; neighbours: number[][] } {
  const n = mesh.positions.length / 3
  const normals = new Float64Array(3 * n)
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set())
  const p = mesh.positions
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t], ib = mesh.indices[t + 1], ic = mesh.indices[t + 2]
    const a = 3 * ia, b = 3 * ib, c = 3 * ic
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const v of [a, b, c]) {
      normals[v] += nx
      normals[v + 1] += ny
      normals[v + 2] += nz
    }
    sets[ia].add(ib).add(ic)
    sets[ib].add(ia).add(ic)
    sets[ic].add(ia).add(ib)
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= l
    normals[i + 1] /= l
    normals[i + 2] /= l
  }
  return { normals, neighbours: sets.map((s) => [...s]) }
}
