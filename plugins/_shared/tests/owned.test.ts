// SPDX-License-Identifier: AGPL-3.0-only
// A workspace's own setting that a print setup owns: the bodies it reaches
// all in one print setup — written there through setup.set, the setup's
// other bodies named; some in setups that set it — those govern, with the
// setup.set that changes it; a setup that leaves it unset, or a value no
// setup can hold, said as such.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/commands/registry', () => import('./setupsFakes'))

import { calls, handlers } from './setupsFakes'
import { registerStateSection } from '../../../src/commands/stateSections'
import { ownedBy, writeOwned, type Setup } from '../setups'

let setups: Setup[] = []
registerStateSection('reverse', () => ({ bodies: [{ id: 1, name: 'Bracket' }, { id: 2, name: 'Clip' }, { id: 3, name: 'Lid' }] }))
registerStateSection('setups', () => ({ setups }))
handlers['setup.set'] = (i: { id: string; settings: Record<string, unknown> }) => {
  setups = setups.map((s) => (s.id === i.id ? { ...s, ...i.settings } : s))
}

describe('a setting a print setup owns, set in a workspace', () => {
  it('every body it reaches in one print setup: written there, its other bodies named', async () => {
    setups = [{ id: 'S1', type: 'print', name: 'Bracket print', bodies: ['1', '2'], walls: 2 }]
    calls.length = 0
    const plan = ownedBy([1], { walls: 3, infill: undefined })
    expect(plan.into?.id).toBe('S1')
    const owned = await writeOwned(plan)
    expect(calls).toEqual([{ name: 'setup.set', input: { id: 'S1', settings: { walls: 3 } } }])
    expect(owned.wrote).toEqual({ id: 'S1', name: 'Bracket print', settings: { walls: 3 } })
    expect(owned.note).toMatch(/Written to Bracket print \(S1\) too: Bracket is printed by it.*Clip in it follows/)
    expect(setups[0].walls).toBe(3)
  })

  it('bodies in a setup and out of one: the setup that sets it governs, said with setup.set', async () => {
    setups = [{ id: 'S1', type: 'print', name: 'Bracket print', bodies: ['1'], walls: 4 }]
    calls.length = 0
    const plan = ownedBy([1, 3], { walls: 3 })
    expect(plan.into).toBe(null)
    const owned = await writeOwned(plan)
    expect(calls).toEqual([])
    expect(owned.governed).toEqual([{ id: 'S1', name: 'Bracket print', bodies: ['Bracket'], settings: { walls: 4 } }])
    expect(owned.note).toContain('Bracket is in Bracket print (S1), whose walls 4 governs it — setup.set { id: "S1", settings: { walls: 3 } } changes it there')
    expect(owned.note).toMatch(/Set here for the parts in no print setup\.$/)
  })

  it('a setup that leaves it unset governs nothing; a cut setup is no print setup', () => {
    setups = [{ id: 'S1', type: 'print', name: 'Print', bodies: ['1'] }, { id: 'S2', type: 'cut', name: 'Laser', bodies: ['3'], walls: 9 }]
    expect(ownedBy([1, 3], { walls: 3 }).owned).toEqual({})
    expect(ownedBy([3], { walls: 3 }).into).toBe(null)
  })

  it('a value no setup can hold, or nothing given: only who governs, or nothing', () => {
    setups = [{ id: 'S1', type: 'print', name: 'Print', bodies: ['1'], up: '-z' }]
    const plan = ownedBy([1], { up: 'one of +x, -x, +y, -y, +z, -z' }, { write: false })
    expect(plan.into).toBe(null)
    expect(plan.owned.governed?.[0].settings).toEqual({ up: '-z' })
    expect(ownedBy([1], { up: undefined }).into).toBe(null)
    expect(ownedBy([], { up: '+x' }).into).toBe(null)
  })
})
