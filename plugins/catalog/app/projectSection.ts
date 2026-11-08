// SPDX-License-Identifier: AGPL-3.0-only
// The catalog's part of a project file: where each part came from.

import type { ProjectSection } from '../../../src/app/projectSections'
import { useCatalog, type Provenance } from '../state/catalogStore'

interface SavedCatalog {
  version: 1
  parts: Provenance[]
}

export const catalogSection: ProjectSection<SavedCatalog> = {
  key: 'catalog',
  collect: () => (useCatalog.getState().parts.length ? { version: 1, parts: useCatalog.getState().parts } : undefined),
  prepare(value) {
    if (value === undefined) return () => useCatalog.getState().replace([])
    const v = value as SavedCatalog
    if (!v || v.version !== 1 || !Array.isArray(v.parts)) throw new Error('The catalog part of the project is not one this ScanRuler reads.')
    return () => useCatalog.getState().replace(v.parts)
  },
  hasContent: (v) => v.parts.length > 0,
  // What collect reads, so the project shows unsaved and New project asks.
  watch(changed) {
    const keys = ['parts'] as const
    return useCatalog.subscribe((s, prev) => {
      if (keys.some((k) => s[k] !== prev[k])) changed()
    })
  },
}
