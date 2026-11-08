// SPDX-License-Identifier: AGPL-3.0-only
// assembly-manual's part of a project file.

import type { ProjectSection } from '../../../src/app/projectSections'
import { DEFAULT_SETTINGS, DEFAULT_STYLE } from '../core/model'
import { useAsm, type AsmData } from '../state/asmStore'

interface Saved extends AsmData {
  version: 1
}

export const asmSection: ProjectSection<Saved> = {
  key: 'assembly-manual',
  collect() {
    const s = useAsm.getState()
    if (!s.parts.length && !s.steps.length && JSON.stringify(s.settings) === JSON.stringify(DEFAULT_SETTINGS) && JSON.stringify(s.style) === JSON.stringify(DEFAULT_STYLE)) return undefined
    return { version: 1, settings: s.settings, parts: s.parts, steps: s.steps, style: s.style }
  },
  prepare(value) {
    if (value === undefined) return () => useAsm.getState().reset()
    const v = value as Saved
    if (!v || v.version !== 1 || !Array.isArray(v.parts) || !Array.isArray(v.steps)) throw new Error('The assembly-manual part of the project is not one this ScanRuler reads.')
    return () => useAsm.getState().replace({ settings: { ...DEFAULT_SETTINGS, ...v.settings }, parts: v.parts, steps: v.steps, style: v.style ?? DEFAULT_STYLE })
  },
  hasContent: (v) => v.parts.length > 0 || v.steps.length > 0,
  // What collect reads, so the project shows unsaved and New project asks.
  watch(changed) {
    const keys = ['settings', 'parts', 'steps', 'style'] as const
    return useAsm.subscribe((s, prev) => {
      if (keys.some((k) => s[k] !== prev[k])) changed()
    })
  },
}
