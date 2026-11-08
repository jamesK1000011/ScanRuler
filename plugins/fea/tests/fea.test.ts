// SPDX-License-Identifier: AGPL-3.0-only
// The FEA study kept with a project — cleaned on the way in — and the
// range a field is coloured over.
import { describe, expect, test } from 'vitest'
import { feaSection } from '../app/projectSection'
import { DEFAULT_SETUP, setupOf, useFea } from '../state/feaStore'
import { rangeOf } from '../viewer/resultLayer'

describe('the study in a project', () => {
  test('round trip, and a hostile file cleaned', () => {
    useFea.getState().reset()
    expect(feaSection.collect({} as never)).toBeUndefined()
    useFea.getState().set({ body: 'Bracket', build: [1, 0, 0], holds: [{ name: 'Hold 1', faces: [2] }], loads: [{ name: 'Load 1', faces: [5], force: [0, 0, -10] }] })
    const saved = feaSection.collect({} as never)!
    useFea.getState().reset()
    feaSection.prepare(JSON.parse(JSON.stringify(saved)), {} as never)()
    expect(setupOf(useFea.getState())).toEqual(saved.setup)
    feaSection.prepare({ version: 1, setup: { body: 7, build: 'up', holds: [{ name: 'x' }, null, { name: 'ok', faces: [1] }], loads: [{ name: 'l', faces: [1] }], target: -3 } }, {} as never)()
    const s = setupOf(useFea.getState())
    expect(s.body).toBeNull()
    expect(s.build).toEqual(DEFAULT_SETUP.build)
    expect(s.holds).toEqual([{ name: 'ok', faces: [1] }])
    expect(s.loads).toEqual([])
    expect(s.target).toBe(DEFAULT_SETUP.target)
    expect(() => feaSection.prepare({ version: 2 }, {} as never)).toThrow()
  })
})

describe('the colour range', () => {
  test('safety red at the bottom, stress from zero, the pull across the layers about zero', () => {
    expect(rangeOf('safety', [0.5, 3], 2)).toEqual({ lo: 0, hi: 4, flip: true })
    expect(rangeOf('vonMises', [3, 40], 2)).toEqual({ lo: 0, hi: 40, flip: false })
    expect(rangeOf('across', [-5, 12], 2)).toEqual({ lo: -12, hi: 12, flip: false })
  })
})
