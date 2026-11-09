// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, describe, expect, it } from 'vitest'
import { generatorOf, GENERATORS, matchParts, valuesOf } from '../core/generators'
import { prism } from '../core/kernel'
import type { GenKernel } from '../core/kernel'
import { setupIn } from '../app/projectSection'

type K = GenKernel & { makeCompound(s: unknown[]): unknown; releaseAll(): void; isValid(s: unknown): boolean; common(a: unknown, b: unknown): unknown; makeBox(dx: number, dy: number, dz: number): unknown; mirror(s: unknown, p: { x: number; y: number; z: number }, n: { x: number; y: number; z: number }): unknown }
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

describe('Gridfinity, to the specification', () => {
  const vol = (s: unknown) => k.getVolume(s)
  /** A 0.2 mm cube of the part at a point, as a volume: > 0 where there is material. */
  const at = (s: unknown, x: number, y: number, z: number) => vol(k.common(s, k.translate(k.makeBox(0.2, 0.2, 0.2), x - 0.1, y - 0.1, z - 0.1)))
  it('the lip stands on a 45° support, not a flat overhang', () => {
    const [b] = build('gridfinity_bin', { units: 3, wall: 1.2 })
    const H = 21, edge = 41.5 / 2
    // 0.3 mm under the lip's foot, 2 mm in from the outside: the support.
    expect(at(b.shape, edge - 2, 0, H - 0.3)).toBeGreaterThan(0.007)
    // Below the support, the hollow.
    expect(at(b.shape, edge - 2, 0, H - 2)).toBe(0)
    expect(k.isValid(b.shape)).toBe(true)
  })
  it('a bin stacked on another sits in its lip without touching it', () => {
    const lower = build('gridfinity_bin', { units: 3 })[0].shape
    const upper = k.translate(build('gridfinity_bin', { units: 2, lip: false })[0].shape, 0, 0, 21)
    expect(Math.abs(vol(k.cut(upper, lower)) - vol(upper))).toBeLessThan(0.5)
  })
  it('magnet holes 6.5 × 2.4 mm, four to a cell, 13 mm each way from its centre', () => {
    const plain = vol(build('gridfinity_bin', { x: 2 })[0].shape)
    const holed = build('gridfinity_bin', { x: 2, magnets: true })[0].shape
    const holes = 8 * Math.PI * 3.25 ** 2 * 2.4
    expect(Math.abs(plain - vol(holed) - holes)).toBeLessThan(0.1)
    expect(at(holed, 21 + 13, 13, 1)).toBe(0)
    expect(at(holed, 21 + 13 + 3.4, 13, 1)).toBeGreaterThan(0)
  })
  it('the magnets recorded for their pause sit in their holes: a bin’s closed over at the top given, a baseplate’s on its floor', () => {
    const bin = generatorOf('gridfinity_bin')!
    const v = valuesOf(bin, { x: 2, magnets: true })
    const [e] = bin.embeds!(v)
    const s = bin.build(k, v)[0].shape
    expect(e.centres.length).toBe(8)
    for (const c of e.centres) {
      expect(at(s, c[0], c[1], c[2])).toBe(0)
      expect(at(s, c[0], c[1], e.top - 0.15)).toBe(0)
      expect(at(s, c[0], c[1], e.top + 0.15)).toBeGreaterThan(0)
    }
    const base = generatorOf('gridfinity_baseplate')!
    const w = valuesOf(base, { x: 1, y: 1, magnets: true })
    const [f] = base.embeds!(w)
    const p = base.build(k, w)[0].shape
    for (const c of f.centres) {
      expect(at(p, c[0], c[1], c[2])).toBe(0)
      expect(at(p, c[0], c[1], c[2] - 1.3)).toBeGreaterThan(0)
    }
    expect(bin.embeds!(valuesOf(bin, { magnets: false }))).toEqual([])
  })
  it('the base is 4.75 mm: 0.8 at 45°, 1.8 straight, 2.15 at 45°, from a 35.6 mm foot', () => {
    const b = build('gridfinity_bin', { lip: false, units: 2, wall: 0 })[0].shape
    expect(at(b, 35.6 / 2 - 0.35, 0, 0.1)).toBeGreaterThan(0)
    expect(at(b, 35.6 / 2 + 0.35, 0, 0.1)).toBe(0)
    // At 0.8 mm the foot is 37.2 wide, and stays so to 2.6 mm.
    expect(at(b, 37.2 / 2 - 0.35, 0, 2.5)).toBeGreaterThan(0)
    expect(at(b, 37.2 / 2 + 0.35, 0, 2.5)).toBe(0)
    expect(at(b, 41.5 / 2 - 0.35, 0, 4.9)).toBeGreaterThan(0)
  })
  it('leaves no sliver faces — a bin with its lip, dividers and ledge, and a baseplate', () => {
    // Each face's width as reverse.body.check reads it, 2 × area ÷ perimeter:
    // a cutter overshooting with its inset held flat leaves 0.01 mm ledges.
    type O = { getSubShapes(s: unknown, t: string): unknown[]; getSurfaceArea(s: unknown): number; curveLength(s: unknown): number }
    const o = (k as unknown as { occt?: O }).occt ?? (k as unknown as O)
    const narrowest = (s: unknown) => {
      let least = Infinity
      for (const f of o.getSubShapes(s, 'face')) {
        let p = 0
        for (const e of o.getSubShapes(f, 'edge')) p += o.curveLength(e)
        if (p > 0) least = Math.min(least, (2 * o.getSurfaceArea(f)) / p)
      }
      return least
    }
    const [b] = build('gridfinity_bin', { x: 2, y: 1, units: 4, magnets: true, dividersX: 1, label: 10 })
    expect(narrowest(b.shape)).toBeGreaterThan(0.05)
    expect(narrowest(build('gridfinity_baseplate', { x: 2, y: 2 })[0].shape)).toBeGreaterThan(0.05)
    expect(narrowest(build('gridfinity_baseplate', { x: 2, y: 2, magnets: true })[0].shape)).toBeGreaterThan(0.05)
  })
})

describe('Project box', () => {
  const vol = (s: unknown) => k.getVolume(s)
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
  it('corner bosses stay inside however round the corners', () => {
    for (const corner of [0, 4, 10, 20, 29]) {
      const [box] = build('project_box', { width: 80, depth: 60, height: 30, corner, screws: true })
      expect(vol(k.cut(box.shape, prism(k, 0, 0, 80, 60, corner, -1, 31)))).toBeLessThan(0.01)
      expect(k.isValid(box.shape)).toBe(true)
    }
  })
  it('refuses walls that leave no inside, and a lip with no room', () => {
    const box = generatorOf('project_box')!
    expect(() => valuesOf(box, { width: 20, depth: 20, wall: 10, screws: false, corner: 2 })).toThrow(/wall/)
    expect(() => valuesOf(box, { width: 20, depth: 20, wall: 6.5, clearance: 1, screws: false, corner: 2, lip: 3 })).toThrow(/lip/)
    expect(() => valuesOf(box, { width: 20, depth: 20, wall: 6.5, clearance: 1, screws: false, corner: 2, lip: 0 })).not.toThrow()
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
  it('keeps a value that needs another first, in whatever order saved', () => {
    // A 30 mm lip needs the 60 mm height saved after it; a 40 mm corner the width and depth.
    const saved = { project_box: { lip: 30, corner: 40, height: 60, width: 100, depth: 100 } }
    expect(setupIn({ values: saved }).values).toEqual(saved)
  })
})

describe('making', () => {
  it('names each body after the part that stands where it does', () => {
    const part = (name: string, x: number) => ({ name, volume: 1, box: { min: [x, 0, 0] as [number, number, number], max: [x + 10, 10, 10] as [number, number, number] } })
    const parts = [part('Box', 0), part('Lid', 90)]
    const named = matchParts(parts, [{ bounds: { min: [90, 0, 0], max: [100, 10, 10] } }, { bounds: { min: [0, 0, 0], max: [10, 10, 10] } }])
    expect(named.map((p) => p?.name)).toEqual(['Lid', 'Box'])
    expect(matchParts(parts, [{ bounds: null }, { bounds: null }]).map((p) => p?.name)).toEqual(['Box', 'Lid'])
  })
})
