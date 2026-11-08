// SPDX-License-Identifier: AGPL-3.0-only
// The Wear repair panel's sums: a region drawn up as a centre and a size
// goes to wear.tag as the box or ball it means, and comes back the same;
// names don't collide; the reference and the pre-warp verdict in words.
import { describe, expect, test } from 'vitest'
import { stopRule } from '../core/prewarp'
import { draftOf, NEW_DRAFT, nextName, referenceWords, regionOf, symmetryAxis, verdictWords } from '../ui/panelModel'

const fmt = (mm: number) => `${mm}`

describe('the panel’s region form', () => {
  test('a box by centre and size is its corners, and back', () => {
    const d = { ...NEW_DRAFT, name: 'Worn 1', shape: 'box' as const, centre: [15, 0, 10] as [number, number, number], size: [8, 12, 3] as [number, number, number] }
    const r = regionOf(d)
    expect(r).toEqual({ kind: 'box', min: [11, -6, 8.5], max: [19, 6, 11.5] })
    expect(draftOf({ name: 'Worn 1', kind: 'worn', region: r })).toMatchObject({ shape: 'box', centre: [15, 0, 10], size: [8, 12, 3] })
  })

  test('a ball keeps its centre and radius', () => {
    const r = regionOf({ ...NEW_DRAFT, centre: [1, 2, 3], radius: 4 })
    expect(r).toEqual({ kind: 'sphere', center: [1, 2, 3], radius: 4 })
    expect(draftOf({ name: 'Keep 1', kind: 'keep', region: r })).toMatchObject({ kind: 'keep', shape: 'sphere', centre: [1, 2, 3], radius: 4 })
  })

  test('a new name is one not taken', () => {
    const region = regionOf(NEW_DRAFT)
    expect(nextName([], 'worn')).toBe('Worn 1')
    expect(nextName([{ name: 'Worn 1', kind: 'worn', region }, { name: 'Keep 1', kind: 'keep', region }], 'worn')).toBe('Worn 2')
    expect(nextName([{ name: 'Worn 1', kind: 'worn', region }], 'keep')).toBe('Keep 1')
  })
})

describe('the panel’s words', () => {
  test('the reference', () => {
    expect(referenceWords(null, null)).toBe('Not chosen')
    expect(referenceWords({ source: 'mirror', point: [0, 0, 0], normal: [0, 1, 0] }, null)).toBe('Mirror across the Y plane')
    expect(referenceWords({ source: 'mirror', point: [0, 0, 0], normal: [1, 1, 0] }, null)).toBe('Mirror across a tilted plane')
    expect(referenceWords({ source: 'deviation' }, 'bracket.step')).toBe('Aligned part: bracket.step')
  })

  test('the axis a symmetry alignment settled on', () => {
    expect(symmetryAxis('Settled on the scan’s mirror plane: it is the YZ plane now — X turned 0.40° onto its normal, …')).toBe('x')
    expect(symmetryAxis(undefined)).toBeNull()
  })

  test('the pre-warp verdict follows the stop rule', () => {
    const at = ''
    expect(verdictWords([], 0.05, fmt).stop).toBe(false)
    expect(verdictWords([{ n: 1, rms: 0.4, at }], 0.05, fmt)).toMatchObject({ stop: false })
    expect(verdictWords([{ n: 1, rms: 0.04, at }], 0.05, fmt)).toMatchObject({ stop: true })
    expect(verdictWords([{ n: 1, rms: 0.4, at }, { n: 2, rms: 0.35, at }], 0.05, fmt).stop).toBe(true)
    expect(verdictWords([{ n: 1, rms: 0.4, at }, { n: 2, rms: 0.2, at }, { n: 3, rms: 0.1, at }], 0.05, fmt).text).toContain('3 runs')
    const cases = [[], [0.4], [0.04], [0.4, 0.35], [0.4, 0.2], [0.4, 0.2, 0.1]].map((rs) => rs.map((rms, i) => ({ n: i + 1, rms, at })))
    for (const runs of cases) expect(verdictWords(runs, 0.05, fmt).stop).toBe(stopRule(runs, 0.05).stop)
  })
})
