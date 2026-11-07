// SPDX-License-Identifier: AGPL-3.0-only
// The reference part made so the print comes out true: scaled by the
// inverse of what the print did on each axis, then its upright walls moved
// back by the contour offset (its holes' by the hole offset), and the first
// layer's walls drawn in by the elephant foot, fading out over the layer
// above. In the build frame; the caller turns it back.
//
// A wall vertex moves so each upright wall meeting at it moves by the offset
// along its own normal — a corner of two walls moves along both — and a top
// face's edge follows its wall; a vertex only floors and tops meet moves
// with the scale alone.

import type { Features } from './features'

export interface Compensation {
  sx: number
  sy: number
  sz: number
  /** The contour offset read, mm: walls are moved in by it. */
  contour: number
  /** The hole offset read, mm: holes are opened by it. */
  hole: number
  /** The elephant foot read, mm, and the height it fades out over. */
  foot: number
  footFade: number
}

const UPRIGHT = 0.3
/** Walls whose directions agree this closely are one wall at a vertex. */
const SAME_WALL = Math.cos((10 * Math.PI) / 180)

export function compensate(positions: Float64Array, indices: ArrayLike<number>, features: Features, c: Compensation): Float64Array {
  const n = positions.length / 3
  // Each vertex's upright walls, by direction: a corner where two walls meet
  // has two, a facet of a round wall one (its neighbours lie within a few
  // degrees and merge).
  const walls: [number, number][][] = Array.from({ length: n }, () => [])
  const hole = new Uint8Array(n)
  for (let t = 0; t < indices.length; t += 3) {
    const a = 3 * indices[t], b = 3 * indices[t + 1], d = 3 * indices[t + 2]
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[d] - positions[a], vy = positions[d + 1] - positions[a + 1], vz = positions[d + 2] - positions[a + 2]
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
    const l = Math.hypot(cx, cy, cz)
    if (l === 0 || Math.abs(cz / l) > UPRIGHT) continue
    const h = Math.hypot(cx, cy)
    const wx = cx / h, wy = cy / h
    for (const v of [indices[t], indices[t + 1], indices[t + 2]]) {
      const list = walls[v]
      const same = list.find((w) => w[0] * wx + w[1] * wy > SAME_WALL)
      if (same) {
        const sx = same[0] + wx, sy = same[1] + wy, sl = Math.hypot(sx, sy)
        same[0] = sx / sl
        same[1] = sy / sl
      } else list.push([wx, wy])
    }
  }
  const holes = features.circles.filter((h) => h.kind === 'hole')
  for (let i = 0; i < n; i++) {
    const x = positions[3 * i], y = positions[3 * i + 1], z = positions[3 * i + 2]
    for (const h of holes) if (z >= h.zMin - 1e-6 && z <= h.zMax + 1e-6 && Math.abs(Math.hypot(x - h.center[0], y - h.center[1]) - h.radius) < 0.02 + 0.01 * h.radius) hole[i] = 1
  }
  const bed = features.zMin
  const out = new Float64Array(positions.length)
  for (let i = 0; i < n; i++) {
    // The printer offsets the paths, then the material shrinks the whole:
    // printed = (model + offset) × scale. So the model is the part divided
    // by the scale, less the offset.
    let x = positions[3 * i] / c.sx, y = positions[3 * i + 1] / c.sy
    const z = positions[3 * i + 2]
    const list = walls[i]
    if (list.length > 0) {
      // + moves the surface out of the material along its normal.
      let move = -(hole[i] ? c.hole : c.contour)
      const h = z - bed
      if (c.foot > 0 && h < c.footFade) move -= c.foot * (1 - h / c.footFade)
      // The shift that moves every wall at the vertex by `move` along its
      // own normal: least squares over them (exact for one or two).
      let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0
      for (const [wx, wy] of list) {
        a11 += wx * wx
        a12 += wx * wy
        a22 += wy * wy
        b1 += wx * move
        b2 += wy * move
      }
      const det = a11 * a22 - a12 * a12
      if (Math.abs(det) > 1e-6) {
        x += (a22 * b1 - a12 * b2) / det
        y += (a11 * b2 - a12 * b1) / det
      } else {
        x += move * list[0][0]
        y += move * list[0][1]
      }
    }
    out[3 * i] = x
    out[3 * i + 1] = y
    out[3 * i + 2] = bed + (z - bed) / c.sz
  }
  return out
}

/** A binary STL of a mesh. */
export function stlBytes(positions: Float64Array, indices: ArrayLike<number>, header = 'fit-comp compensated'): Uint8Array {
  const tris = indices.length / 3
  const buf = new ArrayBuffer(84 + 50 * tris)
  const view = new DataView(buf)
  const head = new TextEncoder().encode(header.slice(0, 80))
  new Uint8Array(buf, 0, head.length).set(head)
  view.setUint32(80, tris, true)
  for (let t = 0; t < tris; t++) {
    const o = 84 + 50 * t
    const p = [0, 1, 2].map((k) => 3 * indices[3 * t + k])
    const ux = positions[p[1]] - positions[p[0]], uy = positions[p[1] + 1] - positions[p[0] + 1], uz = positions[p[1] + 2] - positions[p[0] + 2]
    const vx = positions[p[2]] - positions[p[0]], vy = positions[p[2] + 1] - positions[p[0] + 1], vz = positions[p[2] + 2] - positions[p[0] + 2]
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx
    const l = Math.hypot(cx, cy, cz) || 1
    view.setFloat32(o, cx / l, true)
    view.setFloat32(o + 4, cy / l, true)
    view.setFloat32(o + 8, cz / l, true)
    for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) view.setFloat32(o + 12 + 12 * k + 4 * a, positions[p[k] + a], true)
  }
  return new Uint8Array(buf)
}
