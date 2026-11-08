// SPDX-License-Identifier: AGPL-3.0-only
// Plugins' sections of the app's own panels: in their order, by id where two
// share one, a clash refused, and each taken out again by its own handle.
import { describe, expect, test } from 'vitest'
import { panelSectionsIn, registerPanelSection } from '../src/plugins/panelSections'

const Nothing = () => null

describe('panel sections', () => {
  test('in their order, by id where two share one, and taken out again', () => {
    const offB = registerPanelSection({ id: 'test-b', slot: 'measure', order: 5, Section: Nothing })
    const offA = registerPanelSection({ id: 'test-a', slot: 'measure', order: 5, Section: Nothing })
    const offC = registerPanelSection({ id: 'test-c', slot: 'measure', order: 1, Section: Nothing })
    expect(panelSectionsIn('measure').map((s) => s.id).filter((id) => id.startsWith('test-'))).toEqual(['test-c', 'test-a', 'test-b'])
    offA()
    offA()
    expect(panelSectionsIn('measure').map((s) => s.id).filter((id) => id.startsWith('test-'))).toEqual(['test-c', 'test-b'])
    offB()
    offC()
    expect(panelSectionsIn('measure').some((s) => s.id.startsWith('test-'))).toBe(false)
  })

  test('two sections under one id are refused', () => {
    const off = registerPanelSection({ id: 'test-same', slot: 'measure', order: 0, Section: Nothing })
    expect(() => registerPanelSection({ id: 'test-same', slot: 'measure', order: 1, Section: Nothing })).toThrow(/share the id/)
    off()
  })
})
