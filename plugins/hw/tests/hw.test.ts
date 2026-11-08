// SPDX-License-Identifier: AGPL-3.0-only
// The hardware table against the standards' figures; each kind's hole as
// steps, with the allowance, the depths and the refusals; teardrops, hex
// slots, extents and the feature list as Reverse Engineer takes it; patterns;
// fit checks; the project file read back; and the tool solids in OCCT
// against their closed forms.
import { describe, expect, test } from 'vitest'
import { fitsOf } from '../core/check'
import { extentOf, featuresOf, hexSlotOutline, overlapping, patternOffsets, shapesOf, teardropLines, type Placement, type V2 } from '../core/features'
import { bearingOf, headsOf, insertOf, magnetOf, METRIC, metricOf, sizesOf, table } from '../core/hardware'
import { DEFAULT_SETTINGS, LEAD, planCut, PlanError, type Settings, type Step } from '../core/plan'
import { settingsFrom } from '../app/projectSection'

const S: Settings = { ...DEFAULT_SETTINGS, allowance: { ...DEFAULT_SETTINGS.allowance } }
const near = (a: number, b: number, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol + 1e-12)
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

/** A plane placement on the XY plane, its normal +Z, drilled down −Z. */
const flat = (centres: V2[] = [[0, 0]], up: V2 | null = null): Placement => ({ planeAt: (t) => ({ kind: 'world', axis: 'z', offset: -t }), sign: -1, centres, up, body: 'Solid 1' })

/** A polygon's area by the shoelace. */
const area = (p: V2[]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0)) / 2

describe('the table', () => {
  test('ISO 273, 4762, 7380, 10642 and 4032 figures', () => {
    const m3 = metricOf('M3')!
    expect(m3.clearance).toEqual({ fine: 3.2, medium: 3.4, coarse: 3.6 })
    expect(m3.socket).toEqual({ dk: 5.5, k: 3 })
    expect(m3.button).toEqual({ dk: 5.7, k: 1.65 })
    expect(m3.countersunk).toEqual({ dk: 6.72, k: 1.86 })
    expect(m3.nut).toEqual({ s: 5.5, m: 2.4 })
    expect(metricOf('m8')!.clearance.coarse).toBe(10)
    expect(metricOf('M5')!.nut).toEqual({ s: 8, m: 4.7 })
    // Clearances widen and every head is wider than its clearance.
    for (const m of METRIC) {
      expect(m.clearance.fine).toBeGreaterThan(m.d)
      expect(m.clearance.medium).toBeGreaterThan(m.clearance.fine)
      expect(m.clearance.coarse).toBeGreaterThan(m.clearance.medium)
      expect(m.socket.dk).toBeGreaterThan(m.clearance.coarse)
      expect(m.pilot).toBeLessThan(m.d)
    }
    expect(headsOf(metricOf('M2')!)).toEqual(['socket', 'none'])
    expect(headsOf(metricOf('M4')!)).toEqual(['socket', 'button', 'countersunk', 'none'])
  })
  test('lookups by name', () => {
    expect(bearingOf('608ZZ')!.od).toBe(22)
    expect(bearingOf('608-2RS')!.width).toBe(7)
    expect(bearingOf('6800')!.bore).toBe(10)
    expect(magnetOf('6 x 3')!.d).toBe(6)
    expect(magnetOf('10×5')!.t).toBe(5)
    expect(insertOf('m3 short')!.length).toBe(3)
    expect(sizesOf('bearing')).toEqual(BEARING_SIZES)
    expect(table().metric[2].nut.e).toBe(6.35)
  })
})

const BEARING_SIZES = ['623', '624', '625', '688', '608', '6800', '6801', '6802', '6803', '6804', '6805', '6806']

describe('holes as steps', () => {
  test('a socket cap screw through: counterbore and clearance, with the allowance', () => {
    const c = planCut({ kind: 'screw', size: 'M3' }, S, false)
    expect(c.label).toBe('M3 cap screw')
    expect(c.steps).toEqual([
      { role: 'head', profile: 'circle', diameter: 6.1, from: -LEAD, to: 3.2 },
      { role: 'shaft', profile: 'circle', diameter: 3.6, from: -LEAD, to: null },
    ])
  })
  test('a button head, fine fit, blind', () => {
    const c = planCut({ kind: 'screw', size: 'M4', head: 'button', fit: 'fine', depth: 12 }, S, false)
    near(c.steps[0].diameter, 7.6 + 0.6)
    near(c.steps[0].to!, 2.4)
    near(c.steps[1].diameter, 4.5)
    expect(c.steps[1].to).toBe(12)
  })
  test('a countersink: 45° sides from the head down to the clearance', () => {
    const c = planCut({ kind: 'screw', size: 'M5', head: 'countersunk' }, { ...S, headSink: 0 }, false)
    const cs = c.steps.find((s) => s.role === 'countersink')!
    near(cs.diameter, 11.4)
    expect(cs.draftDeg).toBe(45)
    expect(cs.sketchAt).toBe(0)
    // At 45° the radius shrinks one for one with depth: down to the shaft's.
    const shaft = c.steps.find((s) => s.role === 'shaft')!
    near(cs.diameter / 2 - cs.to!, shaft.diameter / 2, 1e-3)
    expect(c.steps.some((s) => s.role === 'head')).toBe(false)
    // Sunk: a cylinder of the head's diameter above the cone.
    const sunk = planCut({ kind: 'screw', size: 'M5', head: 'countersunk' }, S, false)
    expect(sunk.steps[0]).toMatchObject({ role: 'head', to: 0.2 })
    expect(sunk.steps[1]).toMatchObject({ role: 'countersink', sketchAt: 0.2 })
  })
  test('refusals', () => {
    throws(() => planCut({ kind: 'screw', size: 'M7' }, S, false), /no screw "M7".*M2, M2.5/)
    throws(() => planCut({ kind: 'screw', size: 'M2', head: 'button' }, S, false), /not in the standard/)
    throws(() => planCut({ kind: 'screw', size: 'M3', depth: 2 }, S, false), /within the head/)
    throws(() => planCut({ kind: 'screw', size: 'M3', depth: -1 }, S, false), /more than 0/)
    throws(() => planCut({ kind: 'insert', size: 'M3', depth: 4 }, S, false), /shorter than/)
    throws(() => planCut({ kind: 'nut', size: 'M3', slot: { length: 2, angleDeg: 0 } }, S, false), /slot.length/)
    throws(() => planCut({ kind: 'magnet', size: '6x3', depth: null }, S, false), /has a floor/)
    throws(() => planCut({ kind: 'nut', size: 'M3', depth: 1 }, S, false), /short of the nut/)
  })
  test('a nut trap at the surface, and buried with a slot', () => {
    const c = planCut({ kind: 'nut', size: 'M3' }, S, false)
    expect(c.steps[0]).toEqual({ role: 'nut', profile: 'hex', diameter: 5.7, from: -LEAD, to: 2.6 })
    expect(c.steps[1]).toMatchObject({ role: 'shaft', diameter: 3.6, to: null })
    const b = planCut({ kind: 'nut', size: 'M4', sunk: 5, slot: { length: 12, angleDeg: 90 } }, S, false)
    expect(b.steps[0]).toMatchObject({ profile: 'hexSlot', from: 5, to: 8.4, slot: { length: 12, angleDeg: 90 } })
    const buried = planCut({ kind: 'nut', size: 'M4', sunk: 5 }, S, false)
    expect(buried.notes.some((n) => /pause the print/.test(n))).toBe(true)
    expect(planCut({ kind: 'nut', size: 'M3', shaft: false }, S, false).steps.length).toBe(1)
  })
  test('insert, pilot, magnet and bearing defaults', () => {
    expect(planCut({ kind: 'insert', size: 'M3' }, S, false).steps).toEqual([{ role: 'bore', profile: 'circle', diameter: 4, from: -LEAD, to: 6.7 }])
    expect(planCut({ kind: 'pilot', size: 'M3' }, S, false).steps[0]).toMatchObject({ diameter: 2.5, to: 7 })
    expect(planCut({ kind: 'magnet', size: '6x3' }, S, false).steps[0]).toMatchObject({ diameter: 6.2, to: 3.2 })
    const b = planCut({ kind: 'bearing', size: '608' }, S, false)
    expect(b.steps).toEqual([
      { role: 'pocket', profile: 'circle', diameter: 22.1, from: -LEAD, to: 7 },
      { role: 'relief', profile: 'circle', diameter: 15, from: -LEAD, to: null },
    ])
    expect(planCut({ kind: 'bearing', size: '625', relief: false }, S, false).steps.length).toBe(1)
    expect(planCut({ kind: 'insert', size: 'M3', allowance: 0.1 }, S, false).steps[0].diameter).toBe(4.1)
  })
  test('an allowance that takes a hole under its hardware is warned of', () => {
    const c = planCut({ kind: 'screw', size: 'M3', allowance: -0.5 }, { ...S, headMargin: 0 }, false)
    expect(c.notes.filter((n) => /^Warning/.test(n)).length).toBe(2)
    expect(planCut({ kind: 'bearing', size: '608', allowance: -0.3 }, S, false).notes.some((n) => /too tight to press/.test(n))).toBe(true)
    expect(planCut({ kind: 'screw', size: 'M3' }, S, false).notes.some((n) => /^Warning/.test(n))).toBe(false)
  })
  test('a bridge layer under each step of an upright hole, none when level', () => {
    const b = { ...S, bridgeLayer: 0.2 }
    const up = planCut({ kind: 'screw', size: 'M3' }, b, false)
    near(up.steps[1].from, 3.4)
    expect(up.notes.some((n) => /push it through/.test(n))).toBe(true)
    expect(planCut({ kind: 'screw', size: 'M3' }, b, true).steps[1].from).toBe(-LEAD)
    near(planCut({ kind: 'bearing', size: '608' }, b, false).steps[1].from, 7.2)
  })
  test('teardrops: level clearance holes by the setting', () => {
    const level = planCut({ kind: 'screw', size: 'M3' }, S, true)
    expect(level.steps.every((s) => s.teardrop)).toBe(true)
    expect(planCut({ kind: 'screw', size: 'M3' }, S, false).steps.some((s) => s.teardrop)).toBe(false)
    expect(planCut({ kind: 'insert', size: 'M3' }, S, true).steps[0].teardrop).toBe(undefined)
    expect(planCut({ kind: 'insert', size: 'M3', teardrop: true }, S, true).steps[0].teardrop).toBe(true)
    expect(planCut({ kind: 'screw', size: 'M3', teardrop: false }, S, true).steps.some((s) => s.teardrop)).toBe(false)
    const cs = planCut({ kind: 'screw', size: 'M4', head: 'countersunk' }, S, true)
    expect(cs.steps.find((s) => s.role === 'countersink')!.teardrop).toBe(undefined)
  })
})

describe('profiles on the sheet', () => {
  test('a teardrop’s lines leave the circle tangent and meet r√2 above', () => {
    const c: V2 = [3, -2]
    const r = 1.8
    const up: V2 = [Math.SQRT1_2, Math.SQRT1_2]
    const [a, apex, b] = teardropLines(c, r, up)
    for (const p of [a, b]) {
      near(Math.hypot(p[0] - c[0], p[1] - c[1]), r, 2e-6)
      // Tangent: the radius to the point is square to the line.
      near((p[0] - c[0]) * (apex[0] - p[0]) + (p[1] - c[1]) * (apex[1] - p[1]), 0, 1e-5)
    }
    near(Math.hypot(apex[0] - c[0], apex[1] - c[1]), r * Math.SQRT2, 2e-6)
    near(((apex[0] - c[0]) / (r * Math.SQRT2)) * up[0] + ((apex[1] - c[1]) / (r * Math.SQRT2)) * up[1], 1, 1e-6)
  })
  test('a hex run out into a slot: the hex less its far corner, and the slot', () => {
    const s = 8
    const L = 15
    const p = hexSlotOutline([0, 0], s, 0, L)
    expect(p.length).toBe(7)
    const R = s / 2 / Math.cos(Math.PI / 6)
    // The hex's area, less the triangle beyond x = R/2, plus the slot from R/2 to L.
    const hex = (3 * Math.sqrt(3) * R * R) / 2
    const corner = (R / 2) * s / 2
    near(area(p), hex - corner + (L - R / 2) * s, 1e-4)
    // Every point within the slot's width.
    for (const q of p) expect(Math.abs(q[1])).toBeLessThan(s / 2 + 1e-6)
  })
  test('shapes: circles, teardrops, hexes stood on a corner when level', () => {
    const step: Step = { role: 'shaft', profile: 'circle', diameter: 3.4, from: -0.5, to: null, teardrop: true }
    expect(shapesOf(step, flat([[1, 2]]))).toEqual([{ kind: 'circle', center: [1, 2], radius: 1.7, fixed: true }])
    const level = shapesOf(step, flat([[1, 2]], [0, 1]))
    expect(level.length).toBe(2)
    expect(level[1]).toMatchObject({ kind: 'polyline', fixed: true })
    const hex = shapesOf({ role: 'nut', profile: 'hex', diameter: 5.7, from: 0, to: 2.6 }, flat([[0, 0]], [0, 1]))
    expect(hex[0]).toMatchObject({ kind: 'polygon', sides: 6, fit: 'circumscribed', radius: 2.85, angleDeg: 120 })
  })
  test('extents along the normal, either way, and through', () => {
    const s: Step = { role: 'head', profile: 'circle', diameter: 6, from: -0.5, to: 3.2 }
    expect(extentOf(s, -1)).toEqual({ kind: 'distance', from: 0.5, to: -3.2 })
    expect(extentOf(s, 1)).toEqual({ kind: 'distance', from: -0.5, to: 3.2 })
    expect(extentOf({ ...s, to: null }, -1)).toEqual({ kind: 'toLast', from: 0.5, reverse: true })
    expect(extentOf({ ...s, to: null }, 1)).toEqual({ kind: 'toLast', from: -0.5 })
    // A countersink's extent counts from its own sketch plane.
    expect(extentOf({ ...s, sketchAt: 0.2, from: -0.3, to: 1.8 }, -1)).toEqual({ kind: 'distance', from: 0.5, to: -1.6 })
  })
  test('features: every sketch first, then the cuts into the body alone, named', () => {
    const c = planCut({ kind: 'screw', size: 'M3', head: 'countersunk' }, S, false)
    const { features, names } = featuresOf(c, flat([[0, 0], [10, 0]]), 'M3 countersunk screw 1')
    expect(names).toEqual([
      'M3 countersunk screw 1 head sketch',
      'M3 countersunk screw 1 countersink sketch',
      'M3 countersunk screw 1 shaft sketch',
      'M3 countersunk screw 1 head',
      'M3 countersunk screw 1 countersink',
      'M3 countersunk screw 1 shaft',
    ])
    expect(features.slice(0, 3).every((f) => f.kind === 'sketch')).toBe(true)
    expect(features[1].plane).toEqual({ kind: 'world', axis: 'z', offset: -0.2 })
    expect(((features[2].sketch as { shapes: unknown[] }).shapes).length).toBe(2)
    expect(features[4]).toMatchObject({ kind: 'extrude', sketchId: 'M3 countersunk screw 1 countersink sketch', regions: 'all', op: 'cut', target: 'Solid 1', draftDeg: 45 })
    expect(features[5].draftDeg).toBe(undefined)
  })
})

describe('patterns', () => {
  test('a bolt circle, a rectangle and a grid about the point', () => {
    const c = patternOffsets({ kind: 'circle', count: 4, diameter: 20, startDeg: 45 })
    expect(c.length).toBe(4)
    for (const p of c) near(Math.hypot(...p), 10, 1e-6)
    near(c[0][0], 10 * Math.SQRT1_2, 1e-6)
    expect(patternOffsets({ kind: 'rectangle', width: 30, height: 20 })).toEqual([[-15, -10], [15, -10], [15, 10], [-15, 10]])
    const g = patternOffsets({ kind: 'grid', countU: 3, countV: 2, stepU: 10, stepV: 8 })
    expect(g).toEqual([[-10, -4], [0, -4], [10, -4], [-10, 4], [0, 4], [10, 4]])
    expect(patternOffsets(undefined)).toEqual([[0, 0]])
  })
  test('copies that run into each other are found', () => {
    const c = planCut({ kind: 'screw', size: 'M3' }, S, false)
    expect(overlapping(c, patternOffsets({ kind: 'rectangle', width: 5, height: 20 }))).toBe(5)
    expect(overlapping(c, patternOffsets({ kind: 'rectangle', width: 10, height: 20 }))).toBe(null)
  })
})

describe('what a hole fits', () => {
  test('a Ø3.6 hole: M3 medium clearance, nearest', () => {
    const m = fitsOf(3.6, S)
    expect(m[0]).toMatchObject({ kind: 'screw', size: 'M3', off: 0, fit: 'ISO medium' })
  })
  test('a Ø4 hole takes an M3 insert, right size; too shallow says so', () => {
    const m = fitsOf(4, S, 3).find((x) => x.kind === 'insert' && x.size === 'M3')!
    expect(m).toMatchObject({ off: 0, gap: 0, fit: 'right size' })
    expect(m.shallow).toBe('3 deep; the insert is 5.7 long')
  })
  test('a 608 seat: press, slip, tight', () => {
    const at = (d: number) => fitsOf(d, S).find((x) => x.kind === 'bearing' && x.size === '608')!.fit
    expect(at(22.1)).toBe('press fit')
    expect(at(22.2)).toBe('slip fit')
    expect(at(21.95)).toBe('too tight')
  })
  test('a screw that binds', () => {
    expect(fitsOf(3.1, S).find((x) => x.kind === 'screw' && x.size === 'M3')!.fit).toBe('too tight: the screw binds')
  })
  test('nothing near a Ø100 hole', () => {
    expect(fitsOf(100, S)).toEqual([])
  })
})

describe('the project file', () => {
  test('settings read back, each out of range left at its default', () => {
    const s = settingsFrom({ allowance: { screw: 0.3, nut: 'x', magnet: 9 }, fit: 'coarse', headMargin: 0.5, headSink: -1, teardrop: false, bridgeLayer: 0.2, insertExtra: 2, magnetExtra: null })
    expect(s).toEqual({ ...DEFAULT_SETTINGS, allowance: { ...DEFAULT_SETTINGS.allowance, screw: 0.3 }, fit: 'coarse', headMargin: 0.5, teardrop: false, bridgeLayer: 0.2, insertExtra: 2 })
    expect(settingsFrom({})).toEqual(DEFAULT_SETTINGS)
  })
})

describe('the tool solids in OCCT', () => {
  test('a teardrop extruded: r²(1 + 3π/4) of section', async () => {
    const k = await kernel()
    const r = 1.8
    const [a, apex, b] = teardropLines([0, 0], r, [0, 1])
    const P = (p: V2) => ({ x: p[0], y: p[1], z: 0 })
    // The arc from b round the bottom to a, then the two lines up to the point.
    const bottom: V2 = [0, -r]
    const wire = k.makeWire([k.makeArcEdge(P(b), P(bottom), P(a)), k.makeLineEdge(P(a), P(apex)), k.makeLineEdge(P(apex), P(b))])
    const v = k.getVolume(k.extrude(k.makeFace(wire), 0, 0, 5))
    near(v, r * r * (1 + (3 * Math.PI) / 4) * 5, 1e-4)
  })
  test('a hex slot extruded: a closed face of the outline’s area', async () => {
    const k = await kernel()
    const p = hexSlotOutline([0, 0], 5.7, 30, 12)
    const P = (q: V2) => ({ x: q[0], y: q[1], z: 0 })
    const wire = k.makeWire(p.map((q, i) => k.makeLineEdge(P(q), P(p[(i + 1) % p.length]))))
    near(k.getVolume(k.extrude(k.makeFace(wire), 0, 0, 2.6)), area(p) * 2.6, 1e-6)
  })
  test('the countersink cone: the head’s circle leaning in 45° down to the clearance', async () => {
    const k = await kernel()
    const c = planCut({ kind: 'screw', size: 'M4', head: 'countersunk' }, { ...S, headSink: 0 }, false)
    const cs = c.steps.find((s) => s.role === 'countersink')!
    const R = cs.diameter / 2
    const h = cs.to!
    const face = k.makeFace(k.makeWire([k.makeCircleEdge({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, R)]))
    const v = k.getVolume(k.draftPrism(face, 0, 0, h, 45))
    const r2 = R - h
    near(r2, c.steps.find((s) => s.role === 'shaft')!.diameter / 2, 1e-3)
    near(v, (Math.PI * h * (R * R + R * r2 + r2 * r2)) / 3, 1e-3)
  })
})

let occt: Promise<any> | null = null // eslint-disable-line @typescript-eslint/no-explicit-any
const kernel = () => (occt ??= import('occt-wasm').then((m) => m.OcctKernel.init()))
