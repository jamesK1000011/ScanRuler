// SPDX-License-Identifier: AGPL-3.0-only
// The way a part is built up, a print setup's for a body in one: a result
// goes stale when the setup's up turns, is set or is dropped; the study's
// build direction set in Strength is written to the print setup that
// prints the body, and one off the six axes only says the setup governs.
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../../src/commands/registry', () => import('./feaFakes'))

import { handlers } from './feaFakes'
import { registerStateSection } from '../../../src/commands/stateSections'
import { builtFor, feaCommands, staleness } from '../app/feaCommands'
import { setupOf, useFea } from '../state/feaStore'

type Result = NonNullable<ReturnType<typeof useFea.getState>['result']>

let setups: Record<string, unknown>[] = []
registerStateSection('reverse', () => ({ bodies: [{ id: 4, name: 'Bracket' }] }))
registerStateSection('setups', () => ({ setups }))
handlers['reverse.body.names'] = async () => ({ bodies: [{ id: 4, name: 'Bracket', faces: 6, key: 'k4' }] })
const asked: Record<string, unknown>[] = []
handlers['setup.set'] = async (i: { id: string; settings: Record<string, unknown> }) => {
  asked.push(i)
  setups = setups.map((s) => (s.id === i.id ? { ...s, ...i.settings } : s))
}

type Run = (input: Record<string, unknown>, ctx: unknown) => Promise<Record<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
const run = (name: string, input: Record<string, unknown> = {}) => (feaCommands as unknown as { name: string; run: Run }[]).find((c) => c.name === name)!.run(input, { progress() {} })

describe('the build direction and the print setup', () => {
  test('a result goes stale when the setup’s up turns, is set or is dropped', () => {
    useFea.getState().reset()
    useFea.getState().set({ body: 'Bracket' })
    setups = [{ id: 'S1', type: 'print', name: 'Print', bodies: ['4'], up: '+x' }]
    const built = builtFor('Bracket', useFea.getState().build)
    expect(built.build).toEqual([1, 0, 0])
    expect(built.up?.setup.id).toBe('S1')
    // A result as a solve leaves it, of the study now and built by the setup.
    useFea.setState({ result: { at: '', setup: setupOf(useFea.getState()), bodyKey: null, built: built.build } as unknown as Result })
    expect(staleness(null)).toBe(null)
    setups = [{ id: 'S1', type: 'print', name: 'Print', bodies: ['4'], up: '-y' }]
    expect(staleness(null)).toMatch(/way it is built up has changed/)
    // Dropped: the study's own, +z, which the result was not built by.
    setups = [{ id: 'S1', type: 'print', name: 'Print', bodies: ['4'] }]
    expect(staleness(null)).toMatch(/way it is built up has changed/)
    setups = [{ id: 'S1', type: 'print', name: 'Print', bodies: ['4'], up: '+x' }]
    expect(staleness(null)).toBe(null)
    useFea.getState().reset()
  })

  test('set in Strength: written to the print setup that prints the body; off the axes, only said', async () => {
    useFea.getState().reset()
    setups = [{ id: 'S1', type: 'print', name: 'Print', bodies: ['4'], up: '+z' }]
    asked.length = 0
    const r = await run('setup', { body: 'Bracket', build: [0, 1, 0] })
    expect(asked).toEqual([{ id: 'S1', settings: { up: '+y' } }])
    expect(r.printSetup.wrote).toEqual({ id: 'S1', name: 'Print', settings: { up: '+y' } })
    expect(useFea.getState().build).toEqual([0, 1, 0])
    const off = await run('setup', { build: [1, 1, 0] })
    expect(asked.length).toBe(1)
    expect(off.printSetup.governed).toEqual([{ id: 'S1', name: 'Print', bodies: ['Bracket'], settings: { up: '+y' } }])
    expect(off.note).toMatch(/Bracket is in Print \(S1\), whose up "\+y" governs it/)
    // A body in no setup: the study's own alone.
    setups = []
    const own = await run('setup', { build: '-x' })
    expect(own.printSetup).toBe(undefined)
    expect(asked.length).toBe(1)
    useFea.getState().reset()
  })
})
