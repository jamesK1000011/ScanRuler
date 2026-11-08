// SPDX-License-Identifier: AGPL-3.0-only
// Mass properties against a box's and a sphere's closed forms, printed
// solid and as walls round infill; parts combined; ballast that lands the
// part on the mass and balance point asked for.
import { describe, expect, test } from 'vitest'
import { ballast, BB_GRAMS, boxInside, closedMesh, combine, eigen, FILLERS, freeName, inside, massOf, pocketSize, readStl, surfaceIntegrals, volumeIntegrals, type V3 } from '../core/mass'
import { massSection } from '../app/projectSection'
import { DEFAULT_MASS, historyOf, setupOf, useMass } from '../state/massStore'

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
    // The walls as the box less the box inside them.
    const shell = 4000 - (40 - 1.68) * (20 - 1.68) * (5 - 1.68)
    expect(Math.abs(hollow / ((1.24 / 1000) * shell) - 1)).toBeLessThan(0.005)
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

/** A cylinder about Z, its base on z = 0, n sides, wound outward. */
function cylinder(r: number, h: number, n = 256): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n, b = (2 * Math.PI * (i + 1)) / n
    const p = [r * Math.cos(a), r * Math.sin(a)], q = [r * Math.cos(b), r * Math.sin(b)]
    out.push(0, 0, 0, q[0], q[1], 0, p[0], p[1], 0, 0, 0, h, p[0], p[1], h, q[0], q[1], h)
    out.push(p[0], p[1], 0, q[0], q[1], 0, q[0], q[1], h, p[0], p[1], 0, q[0], q[1], h, p[0], p[1], h)
  }
  return out
}

/** A UV sphere, wound outward. */
function sphere(r: number, n = 48): number[] {
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
  return tris
}

/** An L-shaped prism h high: 30 × 10 along X and 10 × 30 along Y, wound
 *  outward, the (0, 10) corner a vertex of its own so the mesh closes. */
function lPrism(h: number): number[] {
  const poly: [number, number][] = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30], [0, 10]]
  const caps: [number, number][][] = [
    [[0, 0], [30, 0], [30, 10]],
    [[0, 0], [30, 10], [10, 10]],
    [[0, 0], [10, 10], [0, 10]],
    [[0, 10], [10, 10], [10, 30]],
    [[0, 10], [10, 30], [0, 30]],
  ]
  const out: number[] = []
  for (const [a, b, c] of caps) out.push(a[0], a[1], h, b[0], b[1], h, c[0], c[1], h, a[0], a[1], 0, c[0], c[1], 0, b[0], b[1], 0)
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length]
    out.push(a[0], a[1], 0, b[0], b[1], 0, b[0], b[1], h, a[0], a[1], 0, b[0], b[1], h, a[0], a[1], h)
  })
  return out
}

const solid = { density: 1, infill: 1, wallMm: 0 }
const rel = (a: number, b: number) => Math.abs(a / b - 1)

describe('closed forms', () => {
  test('a cube: mass, centre and inertia', () => {
    const p = massOf(box([0, 0, 0], [10, 10, 10]), solid)
    near(p.mass, 1)
    p.com.forEach((c) => near(c, 5))
    near(p.inertia[0][0], (1 * 200) / 12)
  })
  test('a cylinder: mass, about its axis and across it', () => {
    const p = massOf(cylinder(5, 20), solid)
    const m = (Math.PI * 25 * 20) / 1000
    expect(rel(p.mass, m)).toBeLessThan(1e-3)
    expect(rel(p.com[2], 10)).toBeLessThan(1e-9)
    expect(rel(p.inertia[2][2], (m * 25) / 2)).toBeLessThan(1e-3)
    expect(rel(p.inertia[0][0], (m * (3 * 25 + 400)) / 12)).toBeLessThan(1e-3)
    expect(p.closed).toBe(true)
  })
  test('a box turned about Z: principal moments and the long axis', () => {
    const c = Math.cos(0.5), s = Math.sin(0.5)
    const t = box([-20, -5, -2], [20, 5, 2])
    for (let i = 0; i < t.length; i += 3) {
      const x = t[i], y = t[i + 1]
      t[i] = c * x - s * y
      t[i + 1] = s * x + c * y
    }
    const p = massOf(t, solid)
    const m = 1.6
    ;[(100 + 16) / 12, (1600 + 16) / 12, (1600 + 100) / 12].forEach((x, i) => near(p.principal.moments[i] / m, x, 1e-9))
    near(Math.abs(p.principal.axes[0][0]), c, 1e-9)
    near(Math.abs(p.principal.axes[0][1]), s, 1e-9)
  })
  test('eigen of a coupled pair', () => {
    const e = eigen([
      [2, 1, 0],
      [1, 2, 0],
      [0, 0, 5],
    ])
    e.moments.forEach((x, i) => near(x, [1, 3, 5][i], 1e-12))
  })
  test('a hollow cube: the walls’ mass and inertia against the exact shell', () => {
    const p = massOf(box([-15, -15, -15], [15, 15, 15]), { density: 1000, infill: 0, wallMm: 2 })
    const m = 30 ** 3 - 26 ** 3
    const I = (30 ** 5 - 26 ** 5) / 6
    expect(rel(p.mass, m)).toBeLessThan(0.01)
    expect(rel(p.inertia[0][0], I)).toBeLessThan(0.01)
    p.com.forEach((x) => near(x, 0, 1e-9))
  })
  test('a hollow sphere against its exact shell', () => {
    const R = 10, t = 1
    const p = massOf(sphere(R, 96), { density: 1000, infill: 0, wallMm: t })
    const m = (4 / 3) * Math.PI * (R ** 3 - (R - t) ** 3)
    expect(rel(p.mass, m)).toBeLessThan(0.01)
    expect(rel(p.inertia[2][2], (2 / 5) * (4 / 3) * Math.PI * (R ** 5 - (R - t) ** 5))).toBeLessThan(0.015)
  })
  test('walls inside a concave part: an L', () => {
    const p = massOf(lPrism(10), { density: 1000, infill: 0, wallMm: 1 })
    // The L less the L 1 mm inside it: 1..29 × 1..9 and 1..9 × 9..29, 1..9 high.
    const shell = (30 * 10 + 10 * 20) * 10 - (28 * 8 + 8 * 20) * 8
    expect(rel(p.mass, shell)).toBeLessThan(0.01)
    expect(p.closed).toBe(true)
  })
})

describe('meshes', () => {
  test('a hole, a face wound the wrong way and a sliver', () => {
    const b = box([0, 0, 0], [10, 10, 10])
    expect(closedMesh(b.slice(18))).toBe(false)
    const flipped = [...b.slice(0, 3), ...b.slice(6, 9), ...b.slice(3, 6), ...b.slice(9)]
    expect(closedMesh(flipped)).toBe(false)
    expect(closedMesh([...b, 0, 0, 0, 0, 0, 0, 10, 10, 10])).toBe(true)
  })
  test('a binary STL that begins "solid", padded at the end', () => {
    const t = box([0, 0, 0], [1, 2, 3])
    const n = t.length / 9
    const b = new Uint8Array(84 + n * 50 + 2)
    new TextEncoder().encodeInto('solid made by a CAD program', b)
    const dv = new DataView(b.buffer)
    dv.setUint32(80, n, true)
    for (let i = 0; i < n; i++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + i * 50 + 12 + k * 4, t[i * 9 + k], true)
    near(volumeIntegrals(readStl(b)).v, 6, 1e-6)
  })
  test('an STL with a corner that is not a number, and none at all', () => {
    const bad = 'solid x\nfacet normal 0 0 0\nouter loop\nvertex nan 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid'
    expect(() => readStl(new TextEncoder().encode(bad))).toThrow(/not a number/)
    expect(() => readStl(new Uint8Array(0))).toThrow(/Not an STL/)
  })
})

describe('the pocket', () => {
  test('clear of the surface: inside an E, not across its gaps', () => {
    // An E of boxes touching: a back 50 × 10 and three teeth 10 wide, 20 long.
    const E = [...box([0, 0, 0], [50, 10, 10]), ...[0, 20, 40].flatMap((x) => box([x, 10, 0], [x + 10, 30, 10]))]
    expect(boxInside(E, [2, 2, 2], [48, 8, 8])).toBe(true)
    // Its corners and its middle are all in the E, but it spans the gaps.
    const lo: V3 = [2, 2, 2], hi: V3 = [48, 28, 8]
    const corners = [lo[0], hi[0]].flatMap((x) => [lo[1], hi[1]].flatMap((y) => [lo[2], hi[2]].map((z) => [x, y, z] as V3)))
    expect(corners.every((c) => inside(E, c)) && inside(E, [25, 15, 5])).toBe(true)
    expect(boxInside(E, lo, hi)).toBe(false)
    expect(boxInside(E, [2, 2, 2], [8, 8, 11])).toBe(false)
    expect(boxInside(E, [60, 2, 2], [65, 8, 8])).toBe(false)
  })
  test('its size: a cube, a width, a depth, both', () => {
    expect(pocketSize(1000)).toEqual([10, 10, 10])
    expect(pocketSize(1000, 10)).toEqual([10, 10, 10])
    expect(pocketSize(1000, undefined, 10)).toEqual([10, 10, 10])
    expect(pocketSize(1000, 20, 10)).toEqual([20, 10, 5])
  })
  test('walls round it are counted, and the balance point still lands', () => {
    const part = { mass: 50, com: [0, 0, 0] as V3 }
    const walls = { density: 1.24 * 0.85, t: 0.84, area: (v: number) => 6 * Math.cbrt(v) ** 2, edge: (v: number) => 12 * Math.cbrt(v) }
    const r = ballast(part, { mass: 80, com: [10, 0, 0] }, { density: 4.87 }, 0.25, walls)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.wallMass).toBeGreaterThan(0)
    const m = part.mass - r.removedMass + r.fillerMass + r.wallMass
    near(m, 80, 1e-6)
    near((r.fillerMass - r.removedMass + r.wallMass) * r.at[0] / m, 10, 1e-6)
  })
  test('a balance point alone asks for the mass', () => {
    const r = ballast({ mass: 50, com: [0, 0, 0] }, { com: [5, 0, 0] }, { density: 4.87 }, 0.25)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.why).toContain('give the mass wanted')
  })
  test('a BB weighs what its size says', () => {
    near(BB_GRAMS, 0.3745, 1e-3)
    expect(FILLERS['steel-bb'].note).toContain('0.37 g')
  })
  test('names not taken', () => {
    expect(freeName('Ballast', ['Box'])).toBe('Ballast')
    expect(freeName('Ballast', ['ballast', 'Ballast 2 pocket'], ['', ' pocket'])).toBe('Ballast 3')
  })
})

describe('saved with the project', () => {
  test('the setup comes back as it was', () => {
    useMass.getState().reset()
    useMass.getState().set({ material: 'petg', density: 1.3, infill: 40, walls: 3, lineMm: 0.45, scale: 1.08, target: { com: [1, 2, 3] }, filler: 'lead-shot' })
    const saved = JSON.parse(JSON.stringify(massSection.collect({} as never)))
    const was = setupOf(useMass.getState())
    useMass.getState().reset()
    massSection.prepare(saved, {} as never)()
    expect(setupOf(useMass.getState())).toEqual(was)
    massSection.prepare(undefined, {} as never)()
    expect(setupOf(useMass.getState())).toEqual(setupOf(DEFAULT_MASS))
  })
  test('a project saved with tpu opens as tpu-95a', () => {
    massSection.prepare({ version: 1, setup: { material: 'tpu' } }, {} as never)()
    expect(useMass.getState().material).toBe('tpu-95a')
  })
  test('the history keeps no density as null, so a step back clears one', () => {
    useMass.getState().reset()
    expect(historyOf(useMass.getState()).density).toBeNull()
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
