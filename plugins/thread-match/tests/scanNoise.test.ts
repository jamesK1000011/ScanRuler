// SPDX-License-Identifier: AGPL-3.0-only
// Thread identify with the scan noise to plan with: a reading is never
// surer than its scanner, so a boss that reads clean enough for one size
// comes back tied with its neighbour when the scanner's noise says the
// scan can't tell them apart.
import { describe, expect, test } from 'vitest'
import { registerStateSection } from '../../../src/commands/stateSections'
import { readScanNoise } from '../../_shared/scanNoise'
import { decide } from '../core/decide'
import { readingOf, type ReverseRead } from '../core/identify'

/** An M6×1 boss as reverse.thread.read gives it, read at 0.01 noise. */
const read: ReverseRead = { thread: true, pitch: 1, major: 5.95, minor: 4.85, internal: false, noise: 0.01, leftHanded: false, span: [-5, 5], threaded: [-5, 5], windows: [{ pitch: 1 }, { pitch: 1.001 }, { pitch: 0.999 }] }

describe('the noise floor in identify', () => {
  test('the scan’s own noise: one size, high confidence', () => {
    const v = decide(readingOf(read, null)!, ['metric'])
    expect(v).toMatchObject({ verdict: 'match', confidence: 'high' })
    expect(v.best?.designation).toBe('M6×1')
  })

  test('a scanner noisier than the reading widens the tolerance into a tie', () => {
    const stop = registerStateSection('scanner', () => ({ profile: { name: 'Handheld', noiseMm: 0.2 }, measured: { sigmaMm: 0.01 } }))
    try {
      const plan = readScanNoise()
      expect(plan?.sigmaMm).toBe(0.2)
      const reading = readingOf(read, null, plan?.sigmaMm)!
      expect(reading.noise).toBe(0.2)
      const v = decide(reading, ['metric'])
      expect(v.verdict).toBe('ambiguous')
      expect(v.tied).toEqual(expect.arrayContaining(['M6×1', 'M7×1']))
      expect(v.tolerance.diameter).toBeGreaterThan(decide(readingOf(read, null)!, ['metric']).tolerance.diameter)
    } finally {
      stop()
    }
  })

  test('a scanner cleaner than the reading changes nothing', () => {
    expect(readingOf(read, null, 0.002)!.noise).toBe(0.01)
  })
})
