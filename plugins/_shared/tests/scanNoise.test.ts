// SPDX-License-Identifier: AGPL-3.0-only
// The scan noise to plan with, in its one rule: the larger of the
// scanner's usual noise and this scan's, else whichever is known; a
// warning when the scan reads well above its scanner or no scanner is set;
// read from Scanner noise's state section without importing it.
import { describe, expect, it } from 'vitest'
import { registerStateSection } from '../../../src/commands/stateSections'
import { atLeastScanNoise, finestMm, noiseFrom, noiseWarningText, planNoise, readScanNoise, scanNoiseAnswer, WELL_ABOVE } from '../scanNoise'

const mm = (v: number) => `${v} mm`
const bench = { name: 'Bench', noiseMm: 0.03 }

describe('the noise to plan with', () => {
  it('is the larger of the two when both are known', () => {
    expect(planNoise(bench, { sigmaMm: 0.02 })).toMatchObject({ sigmaMm: 0.03, source: 'profile', warning: null })
    expect(planNoise(bench, { sigmaMm: 0.04 })).toMatchObject({ sigmaMm: 0.04, source: 'measured', warning: null })
    // A tie goes to the scanner: it names where the figure comes from.
    expect(planNoise(bench, { sigmaMm: 0.03 })?.source).toBe('profile')
  })

  it('is whichever is known, and nothing with neither', () => {
    expect(planNoise(bench, null)).toMatchObject({ sigmaMm: 0.03, source: 'profile', measured: null, warning: null })
    expect(planNoise(null, { sigmaMm: 0.05 })).toMatchObject({ sigmaMm: 0.05, source: 'measured', profile: null })
    expect(planNoise(null, null)).toBeNull()
    // A figure that is no noise is not known.
    expect(planNoise({ name: 'X', noiseMm: 0 }, { sigmaMm: Number.NaN })).toBeNull()
  })

  it('warns when the scan reads well above its scanner', () => {
    const n = planNoise(bench, { sigmaMm: WELL_ABOVE * 0.03 })
    expect(n?.warning).toEqual({ kind: 'worse-than-profile', ratio: 1.5 })
    expect(noiseWarningText(n, mm)).toMatch(/^This scan reads 0\.045 mm, 1\.5× the 0\.03 mm Bench usually gives/)
    expect(planNoise(bench, { sigmaMm: 0.044 })?.warning).toBeNull()
  })

  it('warns when no scanner is set', () => {
    const n = planNoise(null, { sigmaMm: 0.02 })
    expect(n?.warning).toEqual({ kind: 'no-profile' })
    expect(noiseWarningText(n, mm)).toMatch(/^No scanner is set: planning with this scan's own noise \(0\.02 mm\)/)
    expect(noiseWarningText(planNoise(bench, null), mm)).toBeNull()
  })

  it('says where it came from, and the finest difference to trust', () => {
    const n = planNoise(bench, { sigmaMm: 0.01 })!
    expect(noiseFrom(n)).toBe('scanner Bench')
    expect(noiseFrom(planNoise(null, { sigmaMm: 0.01 })!)).toBe('measured on this scan')
    expect(finestMm(n)).toBe(0.09)
    expect(scanNoiseAnswer(n, mm)).toEqual({ sigmaMm: 0.03, source: 'profile', from: 'scanner Bench', finestMm: 0.09 })
    expect(scanNoiseAnswer(planNoise(null, { sigmaMm: 0.01 })!, mm)).toEqual(expect.objectContaining({ warning: expect.stringMatching(/^No scanner is set/) }))
  })

  it('raises a reading’s own noise to it, never lowers it', () => {
    const n = planNoise(bench, null)
    expect(atLeastScanNoise(0.01, n)).toBe(0.03)
    expect(atLeastScanNoise(0.05, n)).toBe(0.05)
    expect(atLeastScanNoise(0.01, null)).toBe(0.01)
  })
})

describe('reading it from the session', () => {
  it('is null without Scanner noise in the build', () => {
    expect(readScanNoise()).toBeNull()
  })

  it('applies the rule to the scanner part’s two figures', () => {
    let part: unknown = { profile: { name: 'Bench', noiseMm: 0.03 }, measured: { sigmaMm: 0.05, spacingMm: 0.3, at: '' } }
    const stop = registerStateSection('scanner', () => part)
    try {
      expect(readScanNoise()).toMatchObject({ sigmaMm: 0.05, source: 'measured', warning: { kind: 'worse-than-profile', ratio: 1.7 } })
      part = { profile: null, measured: null }
      expect(readScanNoise()).toBeNull()
      // A part in another shape reads as nothing known.
      part = { profile: { name: 3, noiseMm: 'a' }, measured: 'x' }
      expect(readScanNoise()).toBeNull()
    } finally {
      stop()
    }
  })
})
