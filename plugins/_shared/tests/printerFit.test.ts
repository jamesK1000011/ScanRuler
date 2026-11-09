// SPDX-License-Identifier: AGPL-3.0-only
// The printer's fit calibration in its one convention: a hole clearance
// added to a hole's diameter, positive growing the hole. The other ways the
// same figure is written — Fits' printed change ("holes −0.2"), Print
// fit's offsets per side — come in through the converters, and a figure
// copied across by hand no longer flips its sign.
import { describe, expect, it } from 'vitest'
import { fitLabel, gapShift, holeFromPrintedChange, holeFromRadialOffset, holeFromShrink, holeShift, pocketShift, printedChangeOfHole, printerFitOf, shaftFromRadialOffset, TYPICAL_FIT } from '../printerFit'

describe('the sign convention', () => {
  it('a hole that prints 0.2 small takes +0.2, however the figure was written', () => {
    expect(holeFromShrink(0.2)).toBe(0.2)
    // Fits shows it as a printed change, "holes −0.2": the sign flips.
    expect(holeFromPrintedChange(-0.2)).toBe(0.2)
    // Print fit reads 0.1 of material standing into the hole, each side.
    expect(holeFromRadialOffset(0.1)).toBe(0.2)
    expect(printedChangeOfHole(0.2)).toBe(-0.2)
    expect(holeFromPrintedChange(printedChangeOfHole(0.35))).toBe(0.35)
  })
  it('holes printing big take a negative clearance', () => {
    expect(holeFromPrintedChange(0.1)).toBe(-0.1)
    expect(holeFromRadialOffset(-0.05)).toBe(-0.1)
  })
  it('outer walls standing out shrink a shaft by both sides', () => {
    expect(shaftFromRadialOffset(0.03)).toBe(0.06)
  })
  it('the typical printer is Fits’ default, and moves nothing', () => {
    const typical = { ...TYPICAL_FIT }
    expect(holeShift(typical)).toBe(0)
    expect(gapShift(typical)).toBe(0)
    expect(pocketShift(typical)).toBe(0)
  })
  it('a printer whose holes print 0.3 small moves holes by 0.1, a printed gap by its share each side', () => {
    expect(holeShift({ hole: 0.3 })).toBe(0.1)
    expect(pocketShift({ hole: 0.3 })).toBe(0.05)
    expect(gapShift({ hole: 0.3, shaft: 0.2 })).toBe(0.1)
  })
})

describe('reading Fits’ calibration', () => {
  it('none on the defaults or for what it cannot read', () => {
    expect(printerFitOf({ hole: 0.2, shaft: 0.1, source: 'default' })).toBe(null)
    expect(printerFitOf(undefined)).toBe(null)
    expect(printerFitOf({ hole: 9, shaft: 0.1, source: 'entered' })).toBe(null)
  })
  it('its figures as they are — the same sign — with the day and what it was measured on', () => {
    const f = printerFitOf({ hole: 0.16, shaft: 0.06, source: 'print-fit', at: '2026-11-08', profile: 'MK4, PETG' })
    expect(f).toEqual({ hole: 0.16, shaft: 0.06, source: 'print-fit', at: '2026-11-08', profile: 'MK4, PETG', label: 'printer fits from 2026-11-08 (MK4, PETG)' })
  })
  it('a label without a day says how it was made', () => {
    expect(fitLabel({ source: 'measured' })).toBe('printer fits from a measured coupon')
    expect(fitLabel({ source: 'entered', at: '2026-01-02' })).toBe('printer fits from 2026-01-02 (values entered)')
  })
})
