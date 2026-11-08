// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, describe, expect, it } from 'vitest'
import { generatorOf, GENERATORS, valuesOf } from '../core/generators'
import type { GenKernel } from '../core/kernel'
import { setupIn } from '../app/projectSection'

type K = GenKernel & { makeCompound(s: unknown[]): unknown; releaseAll(): void; mirror(s: unknown, p: { x: number; y: number; z: number }, n: { x: number; y: number; z: number }): unknown }
let k: K
beforeAll(async () => {
  k = (await (await import('occt-wasm')).OcctKernel.init()) as unknown as K
})

const size = (s: unknown) => {
  const b = k.getBoundingBox(s)
  return [b.xmax - b.xmin, b.ymax - b.ymin, b.zmax - b.zmin].map((x) => Math.round(x * 100) / 100)
}
const build = (id: string, given: Record<string, unknown> = {}) => {
  const g = generatorOf(id)!
  return g.build(k, valuesOf(g, given))
}

describe('values', () => {
  const bin = generatorOf('gridfinity_bin')!
  it('takes the defaults, then what is given', () => {
    expect(valuesOf(bin, { x: 2 })).toMatchObject({ x: 2, y: 1, units: 3, lip: true })
  })
  it('refuses an unknown key, a wrong kind, a fraction and a value out of range', () => {
    expect(() => valuesOf(bin, { width: 2 })).toThrow(/no parameter "width"/)
    expect(() => valuesOf(bin, { x: '2' })).toThrow(/is a number/)
    expect(() => valuesOf(bin, { x: 1.5 })).toThrow(/whole number/)
    expect(() => valuesOf(bin, { x: 11 })).toThrow(/1 to 10/)
    expect(() => valuesOf(bin, { lip: 1 })).toThrow(/true or false/)
    expect(() => valuesOf(bin, { units: Number.NaN })).toThrow(/is a number/)
  })
  it('checks the whole: a wall too thin, a floor taller than the bin', () => {
    expect(() => valuesOf(bin, { wall: 0.3 })).toThrow(/wall/)
    expect(() => valuesOf(bin, { units: 2, floor: 10 })).toThrow(/floor/)
    const box = generatorOf('project_box')!
    expect(() => valuesOf(box, { width: 20, depth: 20, screws: true })).toThrow(/bosses/)
    expect(() => valuesOf(box, { height: 10, floor: 2, lip: 9 })).toThrow(/lip/)
  })
  it('every generator builds from its defaults', () => {
    for (const g of GENERATORS) for (const p of g.params) expect(p.key in g.defaults).toBe(true)
  })
})

describe('Gridfinity', () => {
  it('a 1×1×3 bin is 41.5 mm square and 21 mm plus the 4.4 mm lip', () => {
    const [b] = build('gridfinity_bin')
    expect(size(b.shape)).toEqual([41.5, 41.5, 25.4])
    expect(b.name).toBe('Gridfinity bin 1x1x3')
  })
  it('a bin without its lip stops at 7 mm a unit', () => {
    expect(size(build('gridfinity_bin', { units: 2, lip: false })[0].shape)[2]).toBe(14)
  })
  it('hollow weighs less than solid; holes and dividers change it', () => {
    const v = (g: Record<string, unknown>) => k.getVolume(build('gridfinity_bin', g)[0].shape)
    const solid = v({ wall: 0 })
    const hollow = v({})
    expect(hollow).toBeLessThan(solid * 0.6)
    expect(v({ magnets: true })).toBeLessThan(hollow)
    expect(v({ dividersX: 2 })).toBeGreaterThan(hollow)
    expect(v({ label: 10 })).toBeGreaterThan(hollow)
  })
  it('a 2×1 bin spans two cells less the half-millimetre', () => {
    expect(size(build('gridfinity_bin', { x: 2 })[0].shape).slice(0, 2)).toEqual([83.5, 41.5])
  })
  it('a baseplate is the grid itself, 4.65 mm tall; 3 mm more with magnets', () => {
    expect(size(build('gridfinity_baseplate', { x: 3, y: 2 })[0].shape)).toEqual([126, 84, 4.65])
    expect(size(build('gridfinity_baseplate', { x: 2, y: 2, magnets: true })[0].shape)).toEqual([84, 84, 7.65])
  })
  it('a bin’s feet drop into a baseplate’s pocket without touching it', () => {
    const b = build('gridfinity_bin', { lip: false, units: 2, wall: 0 })[0].shape
    const p = build('gridfinity_baseplate', { x: 1, y: 1 })[0].shape
    // The plate takes nothing away from the bin standing in it.
    expect(Math.abs(k.getVolume(k.cut(b, p)) - k.getVolume(b))).toBeLessThan(0.5)
  })
})

describe('Project box', () => {
  it('box and lid, the lid laid beside', () => {
    const [box, lid] = build('project_box', { width: 80, depth: 60, height: 30 })
    expect(box.name).toBe('Box')
    expect(lid.name).toBe('Lid')
    expect(size(box.shape)).toEqual([80, 60, 30])
    const lb = k.getBoundingBox(lid.shape)
    expect(lb.xmin).toBeGreaterThan(40)
    expect(Math.round((lb.zmax - lb.zmin) * 100) / 100).toBe(5)
  })
  it('the lid, turned over onto the box, sits on it without touching inside', () => {
    for (const screws of [false, true]) {
      const p = { width: 70, depth: 50, height: 25, screws, clearance: 0.2, lid: 2, lip: 3 }
      const [box, lid] = build('project_box', p)
      // Mirror the lid in z = lid's top (upside down), then move it over the box.
      const over = k.translate(k.mirror(lid.shape, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), -(p.width + 10), 0, p.height + p.lid)
      const lb = k.getBoundingBox(over)
      expect(lb.zmin).toBeCloseTo(p.height - p.lip, 3)
      expect(Math.abs(k.getVolume(k.cut(box.shape, over)) - k.getVolume(box.shape))).toBeLessThan(0.5)
    }
  })
  it('a flat lid has no lip', () => {
    const [, lid] = build('project_box', { lip: 0, screws: false, lid: 2 })
    expect(size(lid.shape)[2]).toBe(2)
  })
})

describe('project section', () => {
  it('keeps what checks, drops what does not', () => {
    const s = setupIn({ generator: 'gridfinity_bin', values: { gridfinity_bin: { x: 2, bogus: 1, units: 99 }, nope: { a: 1 }, __proto__: { x: 1 } } })
    expect(s.generator).toBe('gridfinity_bin')
    expect(s.values).toEqual({ gridfinity_bin: { x: 2 } })
    expect(setupIn({ generator: 'nope' }).generator).toBe(GENERATORS[0].id)
    expect(setupIn(null).values).toEqual({})
  })
})
