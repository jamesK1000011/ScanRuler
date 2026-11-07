// SPDX-License-Identifier: AGPL-3.0-only
// thread-match on synthetic scanned threads: each family read through
// reverse.thread.read's reader and the helix fold, then decided. The
// ambiguous pairs must come back ambiguous with a measurement that tells
// them apart; the rest must match the size they were made as.
import { describe, expect, test } from 'vitest'
import { readThread } from '../../reverse/core/threadRead'
import { decide } from '../core/decide'
import { readingOf, type ReverseRead } from '../core/identify'
import { readShape } from '../core/shape'
import { FAMILY_IDS, lookup, ROWS } from '../core/tables'
import { synthThread, type SynthThread } from './synth'

const V = (5 / 8) * (Math.sqrt(3) / 2)
const IN = 25.4

function run(c: SynthThread) {
  const s = synthThread(c)
  const band = Math.max(0.6, 0.2 * s.radius)
  const read = readThread({ points: s.points, normals: s.normals, origin: [0, 0, 0], dir: [0, 0, 1], radius: s.radius, band, halfLength: c.length / 2 })
  if (!read || read.pitch === null) return { read, shape: null, verdict: null }
  const range = read.threaded ?? read.span
  const shape = readShape({ positions: s.points, origin: [0, 0, 0], dir: [0, 0, 1], radius: s.radius, band, from: range[0], to: range[1], pitch: read.pitch })
  const reading = readingOf({ ...read, thread: true } as ReverseRead, shape)!
  return { read, shape, verdict: decide(reading, FAMILY_IDS) }
}

describe('tables', () => {
  test('every family has rows and designations are unique within a family', () => {
    for (const f of FAMILY_IDS) {
      const rows = ROWS.filter((r) => r.family === f)
      expect(rows.length, f).toBeGreaterThan(5)
      expect(new Set(rows.map((r) => r.designation)).size, f).toBe(rows.length)
    }
  })
  test('basic dimensions', () => {
    expect(lookup('M6x1')!.minorInternal).toBeCloseTo(4.9175, 3)
    expect(lookup('1/4-20 UNC')!.major).toBeCloseTo(6.35, 3)
    expect(lookup('1/2-14 NPT')!.taper).toBeCloseTo(1 / 16, 6)
    expect(lookup('G 1/2')!.angle).toBe(55)
    expect(lookup('tr8x2')!.note).toMatch(/4 starts/)
    expect(lookup('Ø6×1.75 print')).not.toBeNull()
    expect(lookup('M6x7')).toBeNull()
  })
})

describe('matches', () => {
  const cases: [string, SynthThread][] = [
    ['M6×1', { major: 6, pitch: 1, angle: 60, depthShare: V, length: 12, noise: 0.02, blur: 0.1 }],
    ['M3×0.5', { major: 3, pitch: 0.5, angle: 60, depthShare: V, length: 6, noise: 0.04, blur: 0.15 }],
    ['1/4-20 UNC', { major: 6.35, pitch: 1.27, angle: 60, depthShare: V, length: 10, noise: 0.06, blur: 0.3 }],
    ['M8×1.25', { major: 8, pitch: 1.25, angle: 60, depthShare: V, internal: true, length: 10, noise: 0.03, blur: 0.1 }],
    ['G 1/2', { major: 20.955, pitch: IN / 14, angle: 55, depthShare: 0.64, length: 15, noise: 0.03, blur: 0.1 }],
    ['G 1/4', { major: 13.157, pitch: IN / 19, angle: 55, depthShare: 0.64, length: 8, noise: 0.05, blur: 0.2, points: 3000 }],
    ['R 1/4', { major: 13.157, pitch: IN / 19, angle: 55, depthShare: 0.64, taper: 1 / 16, length: 4, noise: 0.08, blur: 0.25, points: 4000 }],
    ['1/2-14 NPT', { major: 21.336, pitch: IN / 14, angle: 60, depthShare: 0.8, taper: 1 / 16, length: 15, noise: 0.03, blur: 0.1 }],
    ['Tr16×4', { major: 16, pitch: 4, angle: 30, depthShare: 0.5625, length: 24, noise: 0.03, blur: 0.1 }],
    ['Ø6×1.75 print', { major: 6, pitch: 1.75, angle: 90, depthShare: 0.3, length: 16, noise: 0.03, blur: 0.1 }],
  ]
  test.each(cases)('%s', (name, c) => {
    const { verdict } = run(c)
    expect(verdict?.verdict).toBe('match')
    expect(verdict?.best?.designation).toBe(name)
  })

  test('a 4-start lead screw reads 4 starts and its pitch', () => {
    const { shape, verdict } = run({ major: 8, pitch: 2, angle: 30, depthShare: 0.625, starts: 4, length: 20, noise: 0.02, blur: 0.08 })
    expect(shape!.starts).toBe(4)
    expect(shape!.lead).toBeCloseTo(8, 1)
    expect(verdict!.best!.designation).toBe('Tr8×2')
  })

  test('a left-hand thread reads left and its flank angle', () => {
    const { shape, verdict } = run({ major: 10, pitch: 1.5, angle: 60, depthShare: V, leftHanded: true, length: 15, noise: 0.03, blur: 0.1 })
    expect(shape!.leftHanded).toBe(true)
    expect(shape!.flankAngle!).toBeGreaterThan(56)
    expect(shape!.flankAngle!).toBeLessThan(64)
    expect(verdict!.best!.designation).toBe('M10×1.5')
  })

  test('the pipe tapers read their taper and are told apart by flank angle', () => {
    const npt = run({ major: 21.336, pitch: IN / 14, angle: 60, depthShare: 0.8, taper: 1 / 16, length: 15, noise: 0.03, blur: 0.1 })
    expect(npt.verdict!.taperRead).toBe('tapered')
    expect(npt.verdict!.ruledOut.map((r) => r.designation)).toContain('R 1/2')
  })
})

describe('ambiguous', () => {
  test('M5×0.8 against #10-32: calipers on the crests decide', () => {
    const { verdict } = run({ major: 5, pitch: 0.8, angle: 60, depthShare: V, length: 14, noise: 0.03, blur: 0.1 })
    expect(verdict!.verdict).toBe('ambiguous')
    expect(verdict!.tied).toEqual(expect.arrayContaining(['M5×0.8', '#10-32 UNF']))
    expect(verdict!.deciding[0].measure).toMatch(/major diameter/)
    expect(verdict!.deciding[0].expect.map((e) => e.value)).toEqual(['5 mm', '4.83 mm'])
  })

  test('M2×0.4 against #1-64 on a noisy scan', () => {
    const { verdict } = run({ major: 2, pitch: 0.4, angle: 60, depthShare: V, length: 5, noise: 0.03, blur: 0.15, points: 6000 })
    expect(verdict!.verdict).toBe('ambiguous')
    expect(verdict!.tied).toContain('#1-64 UNC')
  })

  test('a plain cylinder is no thread', () => {
    const { verdict } = run({ major: 8, pitch: 1, angle: 60, depthShare: 0, length: 10, noise: 0.02 })
    expect(verdict).toBeNull()
  })

  test('the taper decides G from R when the fold cannot read it', () => {
    const reading = { pitch: IN / 14, pitchSigma: 0.002, major: 20.96, minor: 18.3, internal: false, noise: 0.05, length: 5, flankAngle: null, flankConfidence: null, taper: null, taperSigma: null, depthShare: null }
    const v = decide(reading, ['bspp', 'bspt'])
    expect(v.verdict).toBe('ambiguous')
    expect(v.deciding[0].measure).toMatch(/each end/)
  })
})
