// SPDX-License-Identifier: AGPL-3.0-only
// dfm-fdm's part of a project file: the profiles chosen, the project's own
// rule changes and the waivers, as JSON.

import type { ProjectSection } from '../../../src/app/projectSections'
import type { Guide, Override } from '../core/rules'
import { DEFAULT_DFM, useDfm, type DfmSettings, type Waiver } from '../state/dfmStore'

interface SavedDfm {
  version: 1
  settings: DfmSettings
  overrides: Record<string, Override>
  waivers: Waiver[]
  /** Imported guides; absent in older projects. */
  guides?: Guide[]
}

export const dfmSection: ProjectSection<SavedDfm> = {
  key: 'dfm-fdm',
  collect() {
    const s = useDfm.getState()
    if (JSON.stringify(s.settings) === JSON.stringify(DEFAULT_DFM) && Object.keys(s.overrides).length === 0 && s.waivers.length === 0 && s.guides.length === 0) return undefined
    return { version: 1, settings: s.settings, overrides: s.overrides, waivers: s.waivers, ...(s.guides.length ? { guides: s.guides } : {}) }
  },
  prepare(value) {
    if (value === undefined) return () => useDfm.getState().reset()
    const v = value as SavedDfm
    if (!v || v.version !== 1 || typeof v.settings !== 'object' || typeof v.overrides !== 'object' || !Array.isArray(v.waivers)) throw new Error('The printability part of the project is not one this ScanRuler reads.')
    return () => {
      useDfm.getState().reset()
      useDfm.getState().replace({ settings: { ...DEFAULT_DFM, ...v.settings }, overrides: v.overrides, waivers: v.waivers, guides: Array.isArray(v.guides) ? v.guides : [] })
    }
  },
  hasContent: (v) => v.waivers.length > 0 || Object.keys(v.overrides).length > 0 || (v.guides?.length ?? 0) > 0,
  // What collect reads, so the project shows unsaved and New project asks.
  watch(changed) {
    const keys = ['settings', 'overrides', 'waivers', 'guides'] as const
    return useDfm.subscribe((s, prev) => {
      if (keys.some((k) => s[k] !== prev[k])) changed()
    })
  },
}
