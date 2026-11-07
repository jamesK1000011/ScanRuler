// SPDX-License-Identifier: AGPL-3.0-only
// patent-kit's part of a project file. It stays in the project: nothing of
// it is sent anywhere.

import type { ProjectSection } from '../../../src/app/projectSections'
import { DEFAULT_SETTINGS } from '../core/model'
import { usePatent, type PatentData } from '../state/patentStore'

interface Saved extends PatentData {
  version: 1
}

export const patentSection: ProjectSection<Saved> = {
  key: 'patent-kit',
  collect() {
    const s = usePatent.getState()
    if (!s.figures.length && !s.numerals.length && !Object.keys(s.draft).length && JSON.stringify(s.settings) === JSON.stringify(DEFAULT_SETTINGS)) return undefined
    return { version: 1, settings: s.settings, figures: s.figures, numerals: s.numerals, draft: s.draft }
  },
  prepare(value) {
    if (value === undefined) return () => usePatent.getState().reset()
    const v = value as Saved
    if (!v || v.version !== 1 || !Array.isArray(v.figures) || !Array.isArray(v.numerals)) throw new Error('The patent-kit part of the project is not one this ScanRuler reads.')
    return () => usePatent.getState().replace({ settings: { ...DEFAULT_SETTINGS, ...v.settings }, figures: v.figures, numerals: v.numerals, draft: v.draft ?? {} })
  },
  hasContent: (v) => v.figures.length > 0 || v.numerals.length > 0 || Object.keys(v.draft ?? {}).length > 0,
}
