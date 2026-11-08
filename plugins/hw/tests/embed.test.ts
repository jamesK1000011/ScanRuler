// SPDX-License-Identifier: AGPL-3.0-only
// Encased parts: the layer the print pauses before — the first whose bottom
// is at or above the pocket's top — with a first layer of its own height, a
// top exactly on a boundary, a hair either side of one, inside the first
// layer, and float steps that do not add up; boundaries up and down; pauses
// on one layer merged, and two bodies on the bed at different heights; the
// pocket for each kind, its roof, clearance and span; how far an outline
// reaches up; and the project file's encased parts read back.
import { describe, expect, test } from 'vitest'
import { boundaryDown, boundaryUp, encasedCut, layerBottom, layerTop, noteOf, pauseLayer, profileReach, schedule, type Layers } from '../core/embed'
import { DEFAULT_SETTINGS, PlanError, type Settings } from '../core/plan'
import { embedsFrom, settingsFrom } from '../app/projectSection'

const S: Settings = { ...DEFAULT_SETTINGS, allowance: { ...DEFAULT_SETTINGS.allowance } }
const L = (height: number, first: number): Layers => ({ height, first })
const throws = (f: () => unknown, re: RegExp) => {
  let err: unknown
  try {
    f()
  } catch (e) {
    err = e
  }
  expect(err instanceof PlanError).toBe(true)
  expect(re.test((err as Error).message)).toBe(true)
}

describe('the pause layer', () => {
  test('layers: the first its own height, then each the same', () => {
    const l = L(0.2, 0.3)
    expect([1, 2, 3, 10].map((n) => layerBottom(n, l))).toEqual([0, 0.3, 0.5, 0.3 + 8 * 0.2])
    expect([1, 2, 3].map((n) => Math.round(layerTop(n, l) * 1000) / 1000)).toEqual([0.3, 0.5, 0.7])
  })

  test('a top exactly on a boundary: the layer starting there', () => {
    // 0.2 throughout: layer n's bottom is 0.2·(n − 1).
    expect(pauseLayer(2, L(0.2, 0.2))).toEqual({ layer: 11, z: 2, printZ: 2.2, onBoundary: true })
    // First 0.3, then 0.2: boundaries 0.3, 0.5, 0.7 …
    expect(pauseLayer(0.7, L(0.2, 0.3))).toEqual({ layer: 4, z: 0.7, printZ: 0.9, onBoundary: true })
    // First layer thinner than the rest.
    expect(pauseLayer(0.12, L(0.28, 0.12))).toEqual({ layer: 2, z: 0.12, printZ: 0.4, onBoundary: true })
    expect(pauseLayer(0.4, L(0.28, 0.12))).toEqual({ layer: 3, z: 0.4, printZ: 0.68, onBoundary: true })
  })

  test('steps that do not add up in floating point still land on the boundary', () => {
    // 0.1 + 0.2 ≠ 0.3, and 0.2 + 29 × 0.1 is 3.0999999…
    const l = L(0.1, 0.2)
    for (let n = 2; n < 400; n++) {
      const z = Math.round((0.2 + (n - 2) * 0.1) * 1e6) / 1e6
      const p = pauseLayer(z, l)
      expect(p.layer).toBe(n)
      expect(p.onBoundary).toBe(true)
    }
    for (let n = 2; n < 200; n++) {
      const z = Math.round((0.24 + (n - 2) * 0.12) * 1e6) / 1e6
      expect(pauseLayer(z, L(0.12, 0.24)).layer).toBe(n)
    }
  })

  test('a top between boundaries: the next one up, and not on a boundary', () => {
    const l = L(0.2, 0.2)
    expect(pauseLayer(2.01, l)).toEqual({ layer: 12, z: 2.2, printZ: 2.4, onBoundary: false })
    expect(pauseLayer(2.19, l).layer).toBe(12)
    // Within 1.5 µm of a boundary is on it, as the pauses put into the
    // G-code read it (Z to 3 places there); two microns off is not.
    expect(pauseLayer(2.00005, l).layer).toBe(11)
    expect(pauseLayer(1.99995, l).layer).toBe(11)
    expect(pauseLayer(2.001, l)).toEqual({ layer: 11, z: 2, printZ: 2.2, onBoundary: true })
    expect(pauseLayer(2.002, l).layer).toBe(12)
    expect(pauseLayer(1.999, l)).toEqual({ layer: 11, z: 2, printZ: 2.2, onBoundary: true })
    expect(pauseLayer(1.998, l)).toEqual({ layer: 11, z: 2, printZ: 2.2, onBoundary: false })
  })

  test('inside the first layer: the second, off its boundary', () => {
    expect(pauseLayer(0.1, L(0.2, 0.3))).toEqual({ layer: 2, z: 0.3, printZ: 0.5, onBoundary: false })
    expect(pauseLayer(0.3, L(0.2, 0.3)).onBoundary).toBe(true)
  })

  test('refused: a top on or under the bed, layers of no height', () => {
    throws(() => pauseLayer(0, L(0.2, 0.2)), /above the first layer/)
    throws(() => pauseLayer(-1, L(0.2, 0.2)), /above the first layer/)
    throws(() => pauseLayer(Number.NaN, L(0.2, 0.2)), /above the first layer/)
    throws(() => pauseLayer(1, L(0, 0.2)), /layerHeight/)
    throws(() => pauseLayer(1, L(0.2, -0.1)), /firstLayer/)
    throws(() => pauseLayer(1, L(Number.POSITIVE_INFINITY, 0.2)), /layerHeight/)
  })

  test('boundaries up and down', () => {
    const l = L(0.2, 0.3)
    expect(boundaryUp(0.75, l)).toBeCloseTo(0.9, 9)
    expect(boundaryUp(0.9, l)).toBeCloseTo(0.9, 9)
    expect(boundaryDown(0.85, l)).toBeCloseTo(0.7, 9)
    expect(boundaryDown(0.9, l)).toBeCloseTo(0.9, 9)
    expect(boundaryDown(0.2, l)).toBe(null)
    expect(boundaryDown(0.3, l)).toBeCloseTo(0.3, 9)
  })
})

describe('the pauses for a set of parts', () => {
  const l = L(0.2, 0.2)
  test('on one layer merged; the rest each on its own, lowest first', () => {
    const p = schedule(
      [
        { id: 'E3', body: 'Lid', what: 'an M3 nut', z: 6 },
        { id: 'E1', body: 'Base', what: 'a 6x3 magnet', z: 2 },
        { id: 'E2', body: 'Base', what: 'a 6x3 magnet', z: 2 },
        { id: 'E4', body: 'Base', what: 'a 608 bearing', z: 1.95 },
      ],
      l,
    )
    expect(p.map((x) => [x.layer, x.afterLayer, x.z, x.printZ])).toEqual([[11, 10, 2, 2.2], [31, 30, 6, 6.2]])
    expect(p[0].items.map((i) => i.id)).toEqual(['E1', 'E2', 'E4'])
    expect(p[0].note).toBe('Insert a 6x3 magnet (2), a 608 bearing')
    // One of them off its boundary: the layer's pause says so.
    expect(p[0].onBoundary).toBe(false)
    expect(p[1].onBoundary).toBe(true)
  })

  test('two bodies on the bed: each top above its own lowest point', () => {
    // Base's pocket top at Z 12 in the part frame, its body from Z 10;
    // Lid's at Z 7, from Z 5 (one STL each: each on the bed). Both 2 up.
    const items = [
      { id: 'E1', body: 'Base', what: 'a 6x3 magnet', z: 12 - 10 },
      { id: 'E2', body: 'Lid', what: 'an M3 nut', z: 7 - 5 },
    ]
    expect(schedule(items, l).map((p) => [p.layer, p.items.length])).toEqual([[11, 2]])
    // Exported as one object: the lowest of the two on the bed (Z 5).
    const together = [
      { id: 'E1', body: 'Base', what: 'a 6x3 magnet', z: 12 - 5 },
      { id: 'E2', body: 'Lid', what: 'an M3 nut', z: 7 - 5 },
    ]
    expect(schedule(together, l).map((p) => p.layer)).toEqual([11, 36])
  })

  test('words', () => {
    expect(noteOf(['a 6x3 magnet'])).toBe('Insert a 6x3 magnet')
    expect(noteOf(['x', 'y', 'x', 'x'])).toBe('Insert x (3), y')
  })
})

describe('the pocket', () => {
  const at = (kind: 'nut' | 'magnet' | 'bearing' | 'insert', size: string, extra = {}) => encasedCut({ kind, size, roof: 0.6, ...extra }, S, false)
  test('a magnet: clearance over the allowance, headroom above, under its roof', () => {
    const c = at('magnet', '6x3')
    expect(c.steps).toEqual([{ role: 'pocket', profile: 'circle', diameter: 6.3, from: 0.6, to: 3.8 }])
    expect(c.what).toBe('a 6x3 magnet')
    expect(c.span).toBe(6.3)
    expect(c.height).toBe(3.2)
  })
  test('a nut: a hex under the roof, the screw through it', () => {
    const c = at('nut', 'M3')
    expect(c.steps[0]).toEqual({ role: 'nut', profile: 'hex', diameter: 5.8, from: 0.6, to: 3.2 })
    expect(c.steps[1]).toMatchObject({ role: 'shaft', diameter: 3.6, from: -0.5, to: null })
    expect(at('nut', 'M3', { shaft: false }).steps.length).toBe(1)
    expect(c.span).toBe(5.8)
  })
  test('a bearing drops in, no press fit and no relief', () => {
    const c = at('bearing', '608')
    expect(c.steps).toEqual([{ role: 'pocket', profile: 'circle', diameter: 22.3, from: 0.6, to: 7.8 }])
  })
  test('an insert by its outside, not its heat-set hole', () => {
    const c = at('insert', 'M3')
    expect(c.steps[0]).toMatchObject({ diameter: 4.9, from: 0.6, to: 7.3 })
  })
  test('an object: a box turned on the sheet, a cylinder; what it is', () => {
    const b = encasedCut({ kind: 'object', object: { shape: 'box', size: [20, 8, 4], angleDeg: 30 }, roof: 1, what: 'an RFID tag', count: 2 }, S, false)
    expect(b.steps[0]).toEqual({ role: 'pocket', profile: 'rect', diameter: 20.3, length: 8.3, angleDeg: 30, from: 1, to: 5.2 })
    expect(b.span).toBe(8.3)
    expect(b.what).toBe('an RFID tag ×2')
    const c = encasedCut({ kind: 'object', object: { shape: 'cylinder', diameter: 12, height: 10 }, roof: 1, clearance: 0.5 }, S, true)
    expect(c.steps[0]).toMatchObject({ profile: 'circle', diameter: 12.5, from: 1, to: 11.2, riser: 6.25 })
    expect(c.steps[0].teardrop).toBe(undefined)
  })
  test('a depth given, if the part fits under it', () => {
    expect(at('magnet', '6x3', { depth: 4 }).steps[0].to).toBe(4.6)
    throws(() => at('magnet', '6x3', { depth: 2 }), /stand proud/)
  })
  test('refused: a screw, a size not in the table, no roof, an object without its shape', () => {
    throws(() => encasedCut({ kind: 'screw' as never, size: 'M3', roof: 1 }, S, false), /not dropped in/)
    throws(() => at('magnet', '7x7'), /no magnet "7x7"/)
    throws(() => encasedCut({ kind: 'magnet', size: '6x3', roof: 0 }, S, false), /roof/)
    throws(() => encasedCut({ kind: 'object', roof: 1 }, S, false), /object:/)
    throws(() => encasedCut({ kind: 'object', object: { shape: 'box', size: [1, 2] as never }, roof: 1 }, S, false), /object.size/)
    throws(() => encasedCut({ kind: 'object', object: { shape: 'cylinder', diameter: -1, height: 2 }, roof: 1 }, S, false), /diameter and height/)
    throws(() => encasedCut({ kind: 'magnet', size: '6x3', roof: 1, what: ' ' }, S, false), /what/)
    throws(() => encasedCut({ kind: 'magnet', size: '6x3', roof: 1, clearance: 9 }, S, false), /clearance/)
    // A negative allowance never makes it narrower than the part.
    expect(encasedCut({ kind: 'magnet', size: '6x3', roof: 1, clearance: 0, allowance: -0.5 }, S, false).steps[0].diameter).toBe(6)
  })
})

describe('how far an outline reaches up', () => {
  test('upright: nothing; level: the radius, a teardrop’s point, a box’s corner, a hex’s corner', () => {
    const circle = { role: 'pocket' as const, profile: 'circle' as const, diameter: 10, from: 0, to: 1 }
    expect(profileReach(circle, [0, 0])).toBe(0)
    expect(profileReach(circle, [0, 1])).toBeCloseTo(5, 9)
    expect(profileReach({ ...circle, teardrop: true }, [0, 1])).toBeCloseTo(5 * Math.SQRT2, 9)
    expect(profileReach({ ...circle, profile: 'rect', diameter: 10, length: 4 }, [0, 1])).toBeCloseTo(2, 9)
    expect(profileReach({ ...circle, profile: 'rect', diameter: 10, length: 4, angleDeg: 90 }, [0, 1])).toBeCloseTo(5, 9)
    expect(profileReach({ ...circle, profile: 'hex', diameter: 10 }, [0, 1])).toBeCloseTo(5 / Math.cos(Math.PI / 6), 9)
    // A riser's flat top, over the circle's or the hex's own.
    expect(profileReach({ ...circle, riser: 5.4 }, [0, 1])).toBeCloseTo(5.4, 9)
    expect(profileReach({ ...circle, profile: 'hex', diameter: 10, riser: 6 }, [0, 1])).toBeCloseTo(6, 9)
    // Tilted 60° from level: the reach scales with the sheet's slope.
    expect(profileReach(circle, [0, 0.5])).toBeCloseTo(2.5, 9)
  })
})

describe('the project file', () => {
  test('encased parts read back whole, the rest left out', () => {
    const good = { id: 'E1', body: 'Base', kind: 'magnet', label: '6x3 magnet', what: 'a 6x3 magnet', top: 8.4, roof: 0.6, minRoof: 0.6, span: 6.3, count: 1, features: ['6x3 magnet 1 pocket sketch', '6x3 magnet 1 pocket'] }
    const out = embedsFrom([good, { ...good, id: 'E1' }, { ...good, id: 'E2', top: 'high' }, { ...good, id: 'E3', count: 0 }, { ...good, id: 'E4', roof: null, source: 'mass' }, null, 7])
    expect(out.map((e) => e.id)).toEqual(['E1', 'E4'])
    expect(out[1].roof).toBe(null)
    expect(out[1].source).toBe('mass')
    expect(embedsFrom('nope')).toEqual([])
  })
  test('the new settings in range, or the default', () => {
    const s = settingsFrom({ roofLayers: 4, layerHeight: 0.12, firstLayer: 0.3, bridgeMax: 15, dropClearance: 0.5, dropHeadroom: 9 })
    expect([s.roofLayers, s.layerHeight, s.firstLayer, s.bridgeMax, s.dropClearance, s.dropHeadroom]).toEqual([4, 0.12, 0.3, 15, 0.5, DEFAULT_SETTINGS.dropHeadroom])
    expect(settingsFrom({ roofLayers: 2.5 }).roofLayers).toBe(DEFAULT_SETTINGS.roofLayers)
  })
})
