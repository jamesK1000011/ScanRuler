// SPDX-License-Identifier: AGPL-3.0-only
// Calibrate from a scan against the scan noise to plan with (Scanner
// noise's, read through the shared reader): an offset worth changing by its
// errors but under three times the noise is said to need confirming, and a
// poor fit on a scan scattering well above its scanner is laid at the
// scan's door.
import { describe, expect, test } from 'vitest'
import { registerStateSection } from '../../../src/commands/stateSections'
import { readScanNoise } from '../../_shared/scanNoise'
import { judgeNoise, noiseNotes } from '../core/noiseCheck'
import type { Correction } from '../core/suggest'

const mm = (v: number) => `${v} mm`
const c = (quantity: Correction['quantity'], read: number, change = true): Correction => ({ quantity, read, se: 0.002, change, why: '' })
const cs = [c('scaleXY', 0.998), c('contour', 0.06), c('hole', 0.2), c('foot', 0.03, false)]

function withScanner<T>(part: unknown, f: () => T): T {
  const stop = registerStateSection('scanner', () => part)
  try {
    return f()
  } finally {
    stop()
  }
}

describe('offsets near the noise', () => {
  test('without Scanner noise, the run’s own scatter is the noise', () => {
    const j = judgeNoise(cs, 0.01, readScanNoise())
    expect(j).toMatchObject({ sigmaMm: 0.01, nearNoise: [], scanWorse: null })
  })

  test('a scanner’s 0.03 puts a 0.06 contour offset under three times it', () => {
    const j = withScanner({ profile: { name: 'Bench', noiseMm: 0.03 }, measured: null }, () => judgeNoise(cs, 0.01, readScanNoise()))
    expect(j).toMatchObject({ sigmaMm: 0.03, from: 'scanner Bench', nearNoise: [{ quantity: 'contour', read: 0.06 }] })
    const said = noiseNotes(j, false, mm)
    expect(said).toEqual([expect.stringMatching(/^the contour offset \(0\.06 mm\) is under three times the scan noise \(0\.03 mm, scanner Bench\)/)])
  })
})

describe('a poor fit', () => {
  test('on a scan scattering well above its scanner, the scan is suspected', () => {
    const j = withScanner({ profile: { name: 'Bench', noiseMm: 0.02 }, measured: null }, () => judgeNoise(cs, 0.05, readScanNoise()))
    expect(j?.scanWorse).toEqual({ scatterMm: 0.05, usualMm: 0.02, scanner: 'Bench' })
    expect(noiseNotes(j, true, mm).at(-1)).toMatch(/well above the 0\.02 mm Bench usually gives: the scan may be what fits poorly/)
    // A good fit is not blamed on anything.
    expect(noiseNotes(j, false, mm).some((s) => /fits poorly/.test(s))).toBe(false)
  })

  test('on a scan scattering as its scanner does, nothing is laid at the scan', () => {
    const j = withScanner({ profile: { name: 'Bench', noiseMm: 0.02 }, measured: null }, () => judgeNoise(cs, 0.021, readScanNoise()))
    expect(j?.scanWorse).toBeNull()
  })
})
