// SPDX-License-Identifier: AGPL-3.0-only
// The 3D Measure panel's Thread section: installed with the plugin, and the
// commands its controls run — a size looked up, the families and the pitch
// floor set and reset, and Identify refused with no scan open.
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runCommand } from '../../../src/commands/registry'
import { panelSectionsIn } from '../../../src/plugins/panelSections'
import { useStore } from '../../../src/state/store'
import plugin from '../plugin'
import { PITCH_FLOOR } from '../core/decide'
import { FAMILY_IDS } from '../core/tables'
import { useThreadMatch } from '../state/threadStore'
import { ThreadSection, type LookupAnswer } from '../ui/ThreadSection'

beforeAll(() => plugin.install?.())
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true)
  useThreadMatch.getState().reset()
})

describe('Thread section', () => {
  test('sits in the 3D Measure panel', () => {
    const s = panelSectionsIn('measure').find((x) => x.id === 'thread-match')
    expect(s?.Section).toBe(ThreadSection)
  })

  test('Look up gives a size’s dimensions, and names near ones for a miss', async () => {
    const r = (await runCommand('thread.lookup', { designation: 'm6x1' })) as LookupAnswer
    expect(r.designation).toBe('M6×1')
    expect(r.major).toBeCloseTo(6, 6)
    expect(r.pitch).toBeCloseTo(1, 6)
    expect(r.minorInternal).toBeLessThan(r.major)
    const inch = (await runCommand('thread.lookup', { designation: '1/4-20 UNC' })) as LookupAnswer
    expect(inch.tpi).toBe(20)
    await expect(runCommand('thread.lookup', { designation: 'M6x0.3' })).rejects.toThrow(/No size/)
  })

  test('the families and the pitch floor are set, and reset', async () => {
    await runCommand('thread.settings', { families: ['metric', 'unc'] })
    await runCommand('thread.settings', { pitchFloor: 0.02 })
    expect(useThreadMatch.getState().families).toEqual(['metric', 'unc'])
    expect(useThreadMatch.getState().pitchFloor).toBe(0.02)
    await runCommand('thread.settings', { reset: true })
    expect(useThreadMatch.getState().families).toEqual([...FAMILY_IDS])
    expect(useThreadMatch.getState().pitchFloor).toBe(PITCH_FLOOR)
  })

  test('Identify with no scan open is refused', async () => {
    await expect(runCommand('thread.identify', { axis: { kind: 'element', id: 1 } })).rejects.toThrow(/no scan/i)
  })
})
