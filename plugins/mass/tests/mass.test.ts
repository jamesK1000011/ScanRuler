// SPDX-License-Identifier: AGPL-3.0-only
// Mass properties against a box's and a sphere's closed forms, printed
// solid and as walls round infill; parts combined; ballast that lands the
// part on the mass and balance point asked for.
import { describe, expect, test } from 'vitest'
import { ballast, closedMesh, combine, eigen, inside, massOf, readStl, surfaceIntegrals, volumeIntegrals, type V3 } from '../core/mass'

/** A box's twelve triangles, wound outward. */
function box(min: V3, max: V3): number[] {
  const [x0, y0, z0] = min
  const [x1, y1, z1] = max
  const q = (a: V3, b: V3, c: V3, d: V3) => [...a, ...b, ...c, ...a, ...c, ...d]
  return [
    ...q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]),
    ...q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]),
    ...q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]),
    ...q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]),
    ...q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]),
    ...q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]),
  ]
}

const near = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)))

describe('a box', () => {
  const t = box([10, 20, 30], [50, 40, 35])
  test('volume, area and centre', () => {
    const V = volumeIntegrals(t)
    near(V.v, 40 * 20 * 5)
    const S = surfaceIntegrals(t)
    near(S.a, 2 * (40 * 20 + 40 * 5 + 20 * 5))
    expect(closedMesh(t)).toBe(true)
  })
  test('solid PLA: mass, centre and inertia about it', () => {
    const p = massOf(t, { density: 1.24, infill: 1, wallMm: 0 })
    const m = (4000 * 1.24) / 1000
    near(p.mass, m)
    p.com.forEach((c, i) => near(c, [30, 30, 32.5][i]))
    near(p.inertia[0][0], (m * (20 ** 2 + 5 ** 2)) / 12, 1e-9)
    near(p.inertia[1][1], (m * (40 ** 2 + 5 ** 2)) / 12, 1e-9)
    near(p.inertia[2][2], (m * (40 ** 2 + 20 ** 2)) / 12, 1e-9)
    near(p.inertia[0][1], 0, 1e-9)
    near(p.principal.moments[0], (m * (20 ** 2 + 5 ** 2)) / 12, 1e-9)
  })
  test('walls and infill: between the walls alone and solid', () => {
    const solid = massOf(t, { density: 1.24, infill: 1, wallMm: 0 }).mass
    const hollow = massOf(t, { density: 1.24, infill: 0, wallMm: 0.84 }).mass
    const half = massOf(t, { density: 1.24, infill: 0.2, wallMm: 0.84 }).mass
    near(hollow, (1.24 / 1000) * 0.84 * 2 * (40 * 20 + 40 * 5 + 20 * 5))
    expect(half).toBeGreaterThan(hollow)
    expect(half).toBeLessThan(solid)
    // Walls thicker than the part can hold: solid.
    near(massOf(t, { density: 1.24, infill: 0, wallMm: 50 }).mass, solid)
  })
  test('inside out is the same part', () => {
    const flipped: number[] = []
    for (let i = 0; i < t.length; i += 9) flipped.push(...t.slice(i, i + 3), ...t.slice(i + 6, i + 9), ...t.slice(i + 3, i + 6))
    near(massOf(flipped, { density: 1, infill: 1, wallMm: 0 }).mass, massOf(t, { density: 1, infill: 1, wallMm: 0 }).mass)
  })
  test('a point inside and outside', () => {
    expect(inside(t, [30, 30, 32])).toBe(true)
    expect(inside(t, [60, 30, 32])).toBe(false)
  })
})

describe('a sphere', () => {
  test('within its tessellation of the closed form', () => {
    const r = 10
    const n = 48
    const tris: number[] = []
    const P = (i: number, j: number): V3 => {
      const th = (Math.PI * i) / n
      const ph = (2 * Math.PI * j) / n
      return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)]
    }
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1)
        if (i > 0) tris.push(...a, ...b, ...d)
        if (i < n - 1) tris.push(...b, ...c, ...d)
      }
    const p = massOf(tris, { density: 1, infill: 1, wallMm: 0 })
    const m = ((4 / 3) * Math.PI * r ** 3) / 1000
    expect(Math.abs(p.mass / m - 1)).toBeLessThan(0.01)
    expect(Math.abs(p.inertia[2][2] / ((2 / 5) * m * r * r) - 1)).toBeLessThan(0.02)
  })
})

describe('together and balanced', () => {
  test('two parts: the common centre and the parallel-axis inertia', () => {
    const a = massOf(box([0, 0, 0], [10, 10, 10]), { density: 1, infill: 1, wallMm: 0 })
    const b = massOf(box([20, 0, 0], [30, 10, 10]), { density: 1, infill: 1, wallMm: 0 })
    const c = combine([a, b])
    near(c.mass, 2)
    near(c.com[0], 15)
    near(c.inertia[2][2], a.inertia[2][2] * 2 + 2 * 1 * 100)
  })
  test('ballast puts the part on the mass and balance point asked for', () => {
    const part = { mass: 50, com: [0, 0, 0] as V3 }
    const r = ballast(part, { mass: 80, com: [10, 0, 0] }, { density: 4.87 }, 0.25)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Check: the part, less what the pocket took, plus the filler.
    const m = part.mass - r.removedMass + r.fillerMass
    near(m, 80, 1e-9)
    const x = (part.mass * 0 - r.removedMass * r.at[0] + r.fillerMass * r.at[0]) / m
    near(x, 10, 1e-9)
    expect(ballast(part, { mass: 40 }, { density: 4.87 }, 0.25).ok).toBe(false)
  })
  test('eigen of a diagonal', () => {
    const e = eigen([
      [3, 0, 0],
      [0, 1, 0],
      [0, 0, 2],
    ])
    expect(e.moments).toEqual([1, 2, 3])
  })
})

describe('reading an STL', () => {
  test('binary', () => {
    const t = box([0, 0, 0], [1, 2, 3])
    const n = t.length / 9
    const b = new Uint8Array(84 + n * 50)
    const dv = new DataView(b.buffer)
    dv.setUint32(80, n, true)
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + i * 50 + 12 + k * 4, t[i * 9 + k], true)
    near(volumeIntegrals(readStl(b)).v, 6, 1e-6)
  })
})
