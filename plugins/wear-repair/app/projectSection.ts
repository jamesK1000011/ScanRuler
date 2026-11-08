// SPDX-License-Identifier: AGPL-3.0-only
// wear-repair's part of a project file: settings, regions, reference, runs.

import type { ProjectSection } from '../../../src/app/projectSections'
import { DEFAULT_WEAR, useWear, type Reference, type Tag, type WearSettings } from '../state/wearStore'
import type { Run } from '../core/prewarp'

interface SavedWear {
  version: 1
  settings: WearSettings
  tags: Tag[]
  reference: Reference | null
  runs: Run[]
}

export const wearSection: ProjectSection<SavedWear> = {
  key: 'wear-repair',
  collect() {
    const s = useWear.getState()
    if (!s.tags.length && !s.reference && !s.runs.length && JSON.stringify(s.settings) === JSON.stringify(DEFAULT_WEAR)) return undefined
    return { version: 1, settings: s.settings, tags: s.tags, reference: s.reference, runs: s.runs }
  },
  prepare(value) {
    if (value === undefined) return () => useWear.getState().reset()
    const v = value as SavedWear
    if (!v || v.version !== 1 || !Array.isArray(v.tags) || !Array.isArray(v.runs)) throw new Error('The wear-repair part of the project is not one this ScanRuler reads.')
    return () => useWear.getState().replace({ settings: { ...DEFAULT_WEAR, ...v.settings }, tags: v.tags, reference: v.reference ?? null, runs: v.runs })
  },
  hasContent: (v) => v.tags.length > 0 || v.runs.length > 0,
  // What collect reads, so the project shows unsaved and New project asks.
  watch(changed) {
    const keys = ['settings', 'tags', 'reference', 'runs'] as const
    return useWear.subscribe((s, prev) => {
      if (keys.some((k) => s[k] !== prev[k])) changed()
    })
  },
}
