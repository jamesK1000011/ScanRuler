// SPDX-License-Identifier: AGPL-3.0-only
// A test plate and a print of it: a 60 × 40 × 6 mm plate with a Ø5 and a
// Ø10 hole through it and a Ø8 boss standing 9 mm on top, made in Manifold;
// then "printed" — scaled on each axis, its outer contours grown, its holes
// closed, its first layer squashed out — and "scanned", with scatter.

import Module from 'manifold-3d'

export interface Distortion {
  sx: number
  sy: number
  sz: number
  /** Outer contours outward, mm. */
  contour: number
  /** Material into the holes, mm (+ closes them). */
  hole: number
  /** The first layer's extra squash, mm, over its height footBand. */
  foot: number
  footBand?: number
  noise: number
  seed?: number
}

export const HOLES = [
  { c: [15, 20], r: 2.5 },
  { c: [40, 20], r: 5 },
]
export const BOSS = { c: [28, 31], r: 4, z0: 6, z1: 15 }

let wasm: Awaited<ReturnType<typeof Module>> | null = null
async function manifold() {
  if (!wasm) {
    wasm = await Module()
    wasm.setup()
  }
  return wasm
}

export async function plate() {
  const { Manifold } = await manifold()
  let m = Manifold.cube([60, 40, 6])
  for (const h of HOLES) m = m.subtract(Manifold.cylinder(10, h.r, h.r, 96).translate([h.c[0], h.c[1], -2]))
  m = m.add(Manifold.cylinder(BOSS.z1 - 5, BOSS.r, BOSS.r, 96).translate([BOSS.c[0], BOSS.c[1], 5]))
  return m
}

export async function cad(): Promise<{ positions: Float64Array; indices: Uint32Array }> {
  const mesh = (await plate()).getMesh()
  const n = mesh.vertProperties.length / mesh.numProp
  const positions = new Float64Array(3 * n)
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) positions[3 * i + k] = mesh.vertProperties[i * mesh.numProp + k]
  return { positions, indices: Uint32Array.from(mesh.triVerts) }
}

function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

/** The printed and scanned plate, as its welded vertices (the scan's points)
 *  and its triangles. */
export async function printed(d: Distortion): Promise<{ positions: Float64Array; indices: Uint32Array; normals: Float64Array }> {
  const mesh = (await plate()).refineToLength(0.15).getMesh()
  const n = mesh.vertProperties.length / mesh.numProp
  const rand = rng(d.seed ?? 5)
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand())
  const band = d.footBand ?? 0.5
  const out = new Float64Array(3 * n)
  for (let i = 0; i < n; i++) {
    let x = mesh.vertProperties[i * mesh.numProp], y = mesh.vertProperties[i * mesh.numProp + 1]
    const z = mesh.vertProperties[i * mesh.numProp + 2]
    const foot = z < band ? d.foot : 0
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-3
    // Outer walls.
    if (near(x, 0) && z <= 6) x -= d.contour + foot
    if (near(x, 60) && z <= 6) x += d.contour + foot
    if (near(y, 0) && z <= 6) y -= d.contour + foot
    if (near(y, 40) && z <= 6) y += d.contour + foot
    for (const h of HOLES) {
      const r = Math.hypot(x - h.c[0], y - h.c[1])
      if (Math.abs(r - h.r) < 0.01 && z <= 6) {
        const k = (h.r - d.hole - foot) / r
        x = h.c[0] + (x - h.c[0]) * k
        y = h.c[1] + (y - h.c[1]) * k
      }
    }
    const rb = Math.hypot(x - BOSS.c[0], y - BOSS.c[1])
    if (Math.abs(rb - BOSS.r) < 0.01 && z >= 6 - 1e-6) {
      const k = (BOSS.r + d.contour) / rb
      x = BOSS.c[0] + (x - BOSS.c[0]) * k
      y = BOSS.c[1] + (y - BOSS.c[1]) * k
    }
    out[3 * i] = x * d.sx + gauss() * d.noise
    out[3 * i + 1] = y * d.sy + gauss() * d.noise
    out[3 * i + 2] = z * d.sz + gauss() * d.noise
  }
  const indices = Uint32Array.from(mesh.triVerts)
  return { positions: out, indices, normals: vertexNormals(out, indices) }
}

export function vertexNormals(p: Float64Array, idx: Uint32Array): Float64Array {
  const nrm = new Float64Array(p.length)
  for (let t = 0; t < idx.length; t += 3) {
    const a = 3 * idx[t], b = 3 * idx[t + 1], c = 3 * idx[t + 2]
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const v of [a, b, c]) {
      nrm[v] += nx
      nrm[v + 1] += ny
      nrm[v + 2] += nz
    }
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1
    nrm[i] /= l
    nrm[i + 1] /= l
    nrm[i + 2] /= l
  }
  return nrm
}
