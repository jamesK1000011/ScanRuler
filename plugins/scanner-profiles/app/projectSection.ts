// SPDX-License-Identifier: AGPL-3.0-only
// The scanner profile a project uses, and the noise measured on it.

import type { ProjectSection } from '../../../src/app/projectSections'
import { useScanner, type ScannerProfile } from '../state/scannerStore'

interface Saved {
  version: 1
  using: ScannerProfile | null
  measured: { sigmaMm: number; spacingMm: number; at: string } | null
}

export const scannerSection: ProjectSection<Saved> = {
  key: 'scanner-profiles',
  collect() {
    const s = useScanner.getState()
    if (!s.using && !s.measured) return undefined
    return { version: 1, using: s.using, measured: s.measured }
  },
  prepare(value) {
    if (value === undefined) return () => useScanner.getState().replace(null, null)
    const v = value as Saved
    if (!v || v.version !== 1) throw new Error('The scanner part of the project is not one this ScanRuler reads.')
    return () => useScanner.getState().replace(v.using ?? null, v.measured ?? null)
  },
  hasContent: (v) => Boolean(v.using || v.measured),
  // What collect reads, so the project shows unsaved and New project asks.
  watch(changed) {
    const keys = ['using', 'measured'] as const
    return useScanner.subscribe((s, prev) => {
      if (keys.some((k) => s[k] !== prev[k])) changed()
    })
  },
}
