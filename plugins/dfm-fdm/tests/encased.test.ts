// SPDX-License-Identifier: AGPL-3.0-only
// A closed cavity told apart as the pocket of a part encased at a print
// pause by where it is: within the part's reach of one of its centres.
import { describe, expect, test } from 'vitest'
import { asEncased, ENCASED_SLACK_MM, pocketOf, type EncasedPart } from '../core/encased'
import type { Finding } from '../core/checks'

const magnets: EncasedPart[] = [{ id: 'E1', what: '6x2 magnet ×2', count: 2, centres: [[0, 0, 11], [30, 0, 11]], reach: 3.162 }]
const cavity = (at: [number, number, number], rule = 'trapped-volume'): Finding => ({ rule, check: 'trappedVolume', severity: 'warning', value: 90.1, limit: 1, unit: 'mm³', at, says: 'a closed cavity' })

describe('an encased part’s pocket', () => {
  test('within reach of any of its centres', () => {
    expect(pocketOf([0, 0, 11.1], magnets)?.id).toBe('E1')
    expect(pocketOf([30, 0, 10.5], magnets)?.id).toBe('E1')
    expect(pocketOf([0, 0, 11 + 3.162 + ENCASED_SLACK_MM - 0.01], magnets)?.id).toBe('E1')
    expect(pocketOf([0, 0, 11 + 3.162 + ENCASED_SLACK_MM + 0.01], magnets)).toBe(null)
    expect(pocketOf([15, 0, 11], magnets)).toBe(null)
    expect(pocketOf([0, 0, 11], [])).toBe(null)
  })
  test('a trapped volume there is info naming it; any other finding as it was', () => {
    const f = asEncased(cavity([0, 0, 11.1]), magnets)
    expect(f.severity).toBe('info')
    expect(f.encased).toBe('E1')
    expect(f.says).toMatch(/^pocket for E1: 6x2 magnet ×2, filled at the pause/)
    expect(f.value).toBe(90.1)
    const away = cavity([15, 0, 11])
    expect(asEncased(away, magnets)).toBe(away)
    const ledge = cavity([0, 0, 11.1], 'overhang')
    expect(asEncased(ledge, magnets)).toBe(ledge)
  })
})
