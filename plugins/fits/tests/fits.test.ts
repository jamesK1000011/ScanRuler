// SPDX-License-Identifier: AGPL-3.0-only
// The Fits formulas against values worked by hand: a class's clearance, a
// hole and shaft pair (hole basis, a bought dowel, a class as tested), the
// IT grade, calibration from readings and from Print fit, the tolerance
// stack, the snap hook, the plans' sizes and refusals, the labels, and a
// saved project part read back.
import { describe, expect, it } from 'vitest'
import { classClearance, fromPrintFit, fromReadings, itGrade, pair, phi, stack, DEFAULT_CALIBRATION } from '../core/fits'
import { clearanceLabel, labelWidth } from '../core/kernel'
import { planHinge, planPin, planSnap, planTest, type Ctx } from '../core/plans'
import { snap, wedgeForce } from '../core/snap'
import { savedIn } from '../app/projectSection'

const near = (a: number, b: number, tol = 1e-4) => expect(Math.abs(a - b)).toBeLessThan(tol)
const ctx = (over: Partial<Ctx['settings']> = {}, cal = DEFAULT_CALIBRATION): Ctx => ({ settings: { tolerance: 0.15, material: 'petg', classes: {}, ...over }, cal })

describe('classes', () => {
  it('grow with size: slip at 8 is 0.2 + 0.002·8, press at 10 is −0.05 − 0.004·10', () => {
    near(classClearance('slip', 8), 0.216)
    near(classClearance('press', 10), -0.09)
    near(classClearance('free', 5), 0.42)
  })
  it('as tested: the clearance felt at its nominal, growing as the class does from there', () => {
    const o = { slip: { clearance: 0.12, at: 8 } }
    near(classClearance('slip', 8, o), 0.12)
    near(classClearance('slip', 10, o), 0.124)
  })
})

describe('a hole and a shaft', () => {
  it('slip at 8, hole basis: the hole keeps 8, the shaft 7.784; model +0.2 and −0.1', () => {
    const p = pair({ nominal: 8, cls: 'slip' }, DEFAULT_CALIBRATION, 0.15)
    expect(p.printed).toEqual({ hole: 8, shaft: 7.784 })
    expect(p.model).toEqual({ hole: 8.2, shaft: 7.684 })
    // ± 0.15 on each: worst 0.216 ∓ 0.3; RSS 0.216 ∓ 0.15·√2.
    expect(p.range.worst).toEqual([-0.084, 0.516])
    expect(p.range.rss).toEqual([0.0039, 0.4281])
    expect(p.notes.some((n) => /bind/.test(n))).toBe(true)
    expect(p.iso.like).toBe('H7/g6 (sliding)')
  })
  it('shaft basis moves the clearance onto the hole', () => {
    const p = pair({ nominal: 8, cls: 'slip', basis: 'shaft' }, DEFAULT_CALIBRATION, 0.15)
    expect(p.printed).toEqual({ hole: 8.216, shaft: 8 })
  })
  it('a bought 5 dowel pressed: it keeps 5 with no offset; the hole 4.93, modelled 5.13; strain 0.07/5', () => {
    const p = pair({ nominal: 5, cls: 'press', bought: 'shaft' }, DEFAULT_CALIBRATION, 0.15, {}, 0.025)
    expect(p.clearance).toBe(-0.07)
    expect(p.printed).toEqual({ hole: 4.93, shaft: 5 })
    expect(p.model).toEqual({ hole: 5.13, shaft: 5 })
    // ± 0.15 on the hole, ± 0.01 on the dowel.
    expect(p.range.worst).toEqual([-0.23, 0.09])
    expect(p.strain).toEqual({ value: 0.014, limit: 0.025 })
    expect(p.notes.some((n) => /loose/.test(n))).toBe(true)
  })
  it('a press past the material’s strain says it may split', () => {
    const p = pair({ nominal: 4, clearance: -0.2 }, DEFAULT_CALIBRATION, 0.05, {}, 0.015)
    expect(p.notes.some((n) => /split/.test(n))).toBe(true)
  })
  it('refuses a size out of range, no class, and a basis against the bought side', () => {
    expect(() => pair({ nominal: 0.1, cls: 'slip' }, DEFAULT_CALIBRATION, 0.1)).toThrow(/nominal/)
    expect(() => pair({ nominal: 5 }, DEFAULT_CALIBRATION, 0.1)).toThrow(/class/)
    expect(() => pair({ nominal: 5, cls: 'slip', bought: 'shaft', basis: 'hole' }, DEFAULT_CALIBRATION, 0.1)).toThrow(/basis/)
    expect(() => pair({ nominal: 1, clearance: 0.9 }, DEFAULT_CALIBRATION, 0.1)).toThrow(/shaft/)
  })
})

describe('ISO 286 grade', () => {
  it('at 10, i = 0.45·∛10 + 0.01 = 0.9795 µm: ±0.15 spans 306 i, IT14; ±0.005 spans 10.2 i, IT7', () => {
    expect(itGrade(10, 0.15)).toEqual({ grade: 14, units: 306 })
    expect(itGrade(10, 0.005).grade).toBe(7)
    expect(itGrade(1, 2).grade).toBe(null)
  })
})

describe('calibration', () => {
  it('from readings: the mean shortfall of holes and excess of shafts, and their spread', () => {
    const c = fromReadings(
      [
        { kind: 'hole', model: 8.2, measured: 7.95 },
        { kind: 'hole', model: 6.2, measured: 5.99 },
        { kind: 'shaft', model: 7.9, measured: 8.02 },
      ],
      DEFAULT_CALIBRATION,
    )
    expect(c).toMatchObject({ hole: 0.23, shaft: 0.12, n: 3, holes: 2, shafts: 1, source: 'measured' })
    // ±0.02 about 0.23 and 0 about 0.12: √(0.0008 / 1).
    expect(c.spread).toBe(0.0283)
  })
  it('refuses a reading off by more than a printer does: another unit, a misreading', () => {
    expect(() => fromReadings([{ kind: 'hole', model: 8.2, measured: 0.32 }], DEFAULT_CALIBRATION)).toThrow(/misreading/)
  })
  it('holes only keep the shaft offset as it was', () => {
    expect(fromReadings([{ kind: 'hole', model: 5, measured: 4.9 }], DEFAULT_CALIBRATION)).toMatchObject({ hole: 0.1, shaft: 0.1 })
  })
  it('from Print fit: its radial offsets doubled', () => {
    expect(fromPrintFit(0.06, 0.04)).toEqual({ hole: 0.12, shaft: 0.08, source: 'print-fit' })
  })
})

describe('tolerance stack', () => {
  it('20 ± 0.1 less 10 ± 0.1 less 9.5 ± 0.2: gap 0.5, worst ± 0.4, RSS ± √0.06', () => {
    const s = stack([{ name: 'slot', nominal: 20, tol: 0.1 }, { name: 'a', nominal: 10, sign: -1, tol: 0.1 }, { name: 'b', nominal: 9.5, sign: -1, tol: 0.2 }], 0.15)
    expect(s.nominal).toBe(0.5)
    expect(s.worst).toEqual({ min: 0.1, max: 0.9, spread: 0.4 })
    expect(s.rss).toEqual({ min: 0.2551, max: 0.7449, spread: 0.2449 })
    expect(s.contributions[0]).toEqual({ name: 'b', share: 0.6667, tol: 0.2 })
    expect(s.below!.chance).toBeLessThan(1e-6)
  })
  it('a one-sided tolerance moves the mean; an item with none takes the printer’s', () => {
    const s = stack([{ nominal: 10, plus: 0.2, minus: 0 }, { nominal: 9, sign: -1 }], 0.1)
    expect(s.mean).toBe(1.1)
    expect(s.worst).toEqual({ min: 0.9, max: 1.3, spread: 0.2 })
    expect(s.items[1].defaulted).toBe(true)
  })
  it('refuses a plus without its minus', () => {
    expect(() => stack([{ nominal: 10, plus: 0.2 }], 0.1)).toThrow(/together/)
  })
  it('the chance under: half when the mean sits on it', () => {
    near(stack([{ nominal: 1, tol: 0.3 }], 0.1, 1).below!.chance, 0.5)
    near(phi(1.959964), 0.975, 1e-6)
    near(phi(-1), 0.158655, 1e-6)
  })
})

describe('the snap hook', () => {
  // L 15, t 1.5, y 1, b 6, PLA (E 2700, µ 0.35):
  // ε = 1.5·1.5·1/225 = 0.01; P = 6·2.25·2700·0.01/(6·15) = 4.05 N;
  // W = 4.05·(0.35 + tan 30°)/(1 − 0.35·tan 30°) = 4.7069 N.
  const base = { length: 15, thickness: 1.5, width: 6, undercut: 1, material: 'pla' }
  it('strain, deflection and mating force as worked by hand', () => {
    const s = snap(base)
    expect(s.strain).toBe(0.01)
    expect(s.deflectionForce).toBe(4.05)
    expect(s.matingForce).toBe(4.7069)
    expect(s.allowed).toBe(0.015)
    expect(s.ratio).toBe(0.6667)
    expect(s.ok).toBe(true)
  })
  it('a square retaining face locks; at 45° it takes 4.05·1.35/0.65 = 8.4115 N', () => {
    const s = snap(base)
    expect(s.locks).toBe(true)
    expect(s.separationForce).toBe(null)
    expect(snap({ ...base, retainAngle: 45 }).separationForce).toBe(8.4115)
  })
  it('the limits: undercut ≤ ε·L²/(1.5t) = 1.5, beam ≥ √(1.5·t·y/ε) = √150', () => {
    const s = snap(base)
    expect(s.maxUndercut).toBe(1.5)
    expect(s.minLength).toBe(12.2474)
  })
  it('repeated and upright each take their share of the strain', () => {
    expect(snap({ ...base, uses: 'repeated' }).allowed).toBe(0.009)
    expect(snap({ ...base, uses: 'repeated', printed: 'upright' }).allowed).toBe(0.0045)
    expect(snap({ ...base, uses: 'repeated', printed: 'upright' }).ok).toBe(false)
  })
  it('a lead-in too steep for its friction can’t be pushed past', () => {
    expect(wedgeForce(1, 0.5, 70)).toBe(null)
    const s = snap({ ...base, leadAngle: 70, friction: 0.5 })
    expect(s.matingForce).toBe(null)
    expect(s.ok).toBe(false)
  })
  it('refuses a stub and a bad angle', () => {
    expect(() => snap({ ...base, length: 4 })).toThrow(/cantilever/)
    expect(() => snap({ ...base, leadAngle: 90 })).toThrow(/leadAngle/)
    expect(() => snap({ ...base, material: 'wood' })).toThrow(/material/)
  })
})

describe('plans', () => {
  it('the coupon: holes D + c modelled + 0.2, pegs D − c modelled − 0.1; uncompensated as printed', () => {
    const t = planTest({}, ctx())
    const r = t.rows.find((x) => x.label === 0.1)!
    expect(r).toEqual({ label: 0.1, hole: { printed: 8.1, model: 8.3 }, peg: { printed: 7.9, model: 7.8 } })
    expect(t.gauges).toEqual({ pin: { printed: 8, model: 7.9 }, ring: { printed: 8, model: 8.2 } })
    const u = planTest({ compensate: false, clearances: [0.3, -0.1, 0.3] }, ctx())
    expect(u.rows.map((x) => x.label)).toEqual([-0.1, 0.3])
    expect(u.rows[1].hole.model).toBe(8.3)
    expect(() => planTest({ clearances: [0.1] }, ctx())).toThrow(/clearances/)
    expect(() => planTest({ nominal: 2, clearances: [0, 1.5] }, ctx())).toThrow(/peg/)
    // Twelve 30s at 38.6 apart: past a bed.
    expect(() => planTest({ nominal: 30, clearances: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1] }, ctx())).toThrow(/long/)
  })
  it('the hinge: clearances plus the offsets, knuckle (30 − 4·0.4)/5 = 5.68, wall 3 − 1.5 − 0.35', () => {
    const h = planHinge({}, ctx())
    expect(h.radial).toEqual({ printed: 0.2, model: 0.35 })
    expect(h.axial).toEqual({ printed: 0.3, model: 0.4 })
    expect(h.segment).toBe(5.68)
    expect(h.wall).toBe(1.15)
    expect(h.bore).toBe(3.7)
    expect(h.leaves).toEqual({ a: 3, b: 2 })
    expect(() => planHinge({ pin: 4.5 }, ctx())).toThrow(/wall/)
    expect(() => planHinge({ knuckles: 15, length: 10 }, ctx())).toThrow(/Knuckles/)
    expect(() => planHinge({ leaf: 3 }, ctx())).toThrow(/leaf/)
  })
  it('the snap: the window clearance plus the offsets, and the engagement left', () => {
    const s = planSnap({ material: 'pla' }, ctx())
    expect(s.geo.window).toBe(0.35)
    // The beam modelled 0.1 thinner, to print at 1.5.
    expect(s.geo.thickness).toBe(1.4)
    expect(s.geo.name).toBe('Snap hook 15×1.5×6')
    expect(s.engagement).toBe(0.65)
    expect(() => planSnap({ undercut: 0.4 }, ctx())).toThrow(/ledge/)
    expect(() => planSnap({ length: 6, thickness: 1.5, plate: 5.5 }, ctx())).toThrow(/catch/)
  })
  it('the pin: sized as the pair; a bought dowel gets a socket alone', () => {
    const p = planPin({}, ctx())
    expect(p.fit.clearance).toBe(-0.07)
    expect(p.geo.pin).toBe(4.97)
    expect(p.geo.hole).toBe(5.2)
    const b = planPin({ bought: true }, ctx())
    expect(b.geo.pin).toBe(null)
    expect(b.geo.hole).toBe(5.13)
    expect(() => planPin({ length: 5, depth: 6 }, ctx())).toThrow(/length/)
  })
})

describe('labels', () => {
  it('signed, two places under one, no leading zero', () => {
    expect([0.1, -0.05, 0, 1.5, -0.15, 0.4].map(clearanceLabel)).toEqual(['+.10', '-.05', '0', '+1.5', '-.15', '+.40'])
    // Four glyphs: 1.8 + 0.45 + 0.45 (the point) + 0.45 + 1.8 + 0.45 + 1.8.
    near(labelWidth('-.15'), 7.2)
  })
})

describe('the project part', () => {
  it('keeps what reads and drops what doesn’t', () => {
    const s = savedIn({ settings: { tolerance: 9, material: 'wood', classes: { slip: { clearance: 0.1, at: 8 }, bogus: { clearance: 1, at: 1 }, press: { clearance: 'x' } } }, calibration: { hole: 0.3, shaft: 0.05, source: 'measured', n: 4 }, tool: 'snap', inputs: { snap: { length: 20 }, nope: {} } })
    expect(s.settings).toEqual({ tolerance: 0.15, material: 'petg', classes: { slip: { clearance: 0.1, at: 8 } } })
    expect(s.calibration).toEqual({ hole: 0.3, shaft: 0.05, source: 'measured', n: 4 })
    expect(s.tool).toBe('snap')
    expect(s.inputs).toEqual({ snap: { length: 20 } })
    expect(savedIn(null).calibration.source).toBe('default')
  })
})
