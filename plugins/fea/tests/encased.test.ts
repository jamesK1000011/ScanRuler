// SPDX-License-Identifier: AGPL-3.0-only
// The parts encased in the body studied — a steel magnet in a sealed
// pocket, which the mesh holds as a void — read for its own weight: one
// load each, at its centre, with how far it reaches; none without the
// Hardware workspace; one whose weight is not known, named.
import { describe, expect, test, vi } from 'vitest'

vi.mock('../../../src/commands/registry', () => import('./feaFakes'))

import { handlers } from './feaFakes'
import { encasedIn } from '../app/feaCommands'

describe('the encased parts in the own-weight load', () => {
  test('each copy a point of its own; none without the Hardware workspace; the unknown named', async () => {
    delete handlers['hw.masses']
    expect(await encasedIn('Block')).toEqual({ points: [] })
    let asked: unknown = null
    handlers['hw.masses'] = async (i: { bodies: string[] }) => {
      asked = i
      return {
        parts: [{ id: 'E1', what: 'a 10x5 magnet', mass: 3, centres: [[10, 0, 5], [-10, 0, 5]], reach: 5.6 }],
        uncounted: [{ id: 'E2', what: 'a tag' }],
      }
    }
    const r = await encasedIn('Block')
    expect(asked).toEqual({ bodies: ['Block'] })
    expect(r.points).toEqual([
      { name: 'E1 a 10x5 magnet (1)', at: [10, 0, 5], mass: 3, reach: 5.6 },
      { name: 'E1 a 10x5 magnet (2)', at: [-10, 0, 5], mass: 3, reach: 5.6 },
    ])
    expect(r.note).toContain('a tag (E2)')
    delete handlers['hw.masses']
  })
})
