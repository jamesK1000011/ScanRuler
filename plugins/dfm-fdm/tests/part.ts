// SPDX-License-Identifier: AGPL-3.0-only
// Test parts made in Manifold, each with what a check must find:
// a plate with a thin fin, a tunnel whose ceiling bridges 16 mm, a ledge
// held up on one side, a Ø1.5 and a Ø4 hole, and a closed cavity; a tall
// pin; a sphere on the bed.

import Module from 'manifold-3d'

let wasm: Awaited<ReturnType<typeof Module>> | null = null
async function M() {
  if (!wasm) {
    wasm = await Module()
    wasm.setup()
  }
  return wasm.Manifold
}

export function meshOf(m: { getMesh(): { vertProperties: Float32Array; numProp: number; triVerts: Uint32Array } }) {
  const g = m.getMesh()
  const n = g.vertProperties.length / g.numProp
  const positions = new Float64Array(3 * n)
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) positions[3 * i + k] = g.vertProperties[i * g.numProp + k]
  return { positions, indices: Uint32Array.from(g.triVerts) }
}

export async function plate(refine?: number) {
  const Manifold = await M()
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])
  let m = box(0, 0, 0, 60, 40, 4)
  m = m.add(box(30, 20, 4, 30.5, 30, 12))
  m = m.add(box(2, 14, 4, 22, 34, 12)).subtract(box(0, 16, 4, 24, 32, 10))
  m = m.add(box(40, 5, 4, 46, 11, 14)).add(box(40, 5, 14, 54, 11, 16))
  m = m.subtract(Manifold.cylinder(10, 0.75, 0.75, 48).translate([55, 35, -2]))
  m = m.subtract(Manifold.cylinder(10, 2, 2, 48).translate([50, 30, -2]))
  m = m.subtract(box(10, 3, 1, 14, 7, 3))
  return meshOf(refine ? m.refineToLength(refine) : m)
}

export async function pin() {
  const Manifold = await M()
  return meshOf(Manifold.cylinder(40, 2, 2, 48))
}

export async function ball() {
  const Manifold = await M()
  return meshOf(Manifold.sphere(10, 64).translate([0, 0, 10]))
}
