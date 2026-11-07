// SPDX-License-Identifier: AGPL-3.0-only
// library-pack's part of a project file.

import type { ProjectSection } from '../../../src/app/projectSections'
import { DEFAULT_PACK } from '../core/plan'
import { usePack, type PackData } from '../state/packStore'

interface Saved extends PackData {
  version: 1
}

export const packSection: ProjectSection<Saved> = {
  key: 'library-pack',
  collect() {
    const s = usePack.getState()
    if (!s.upstream.length && !s.presets.length && JSON.stringify(s.settings) === JSON.stringify(DEFAULT_PACK)) return undefined
    return { version: 1, settings: s.settings, upstream: s.upstream, presets: s.presets }
  },
  prepare(value) {
    if (value === undefined) return () => usePack.getState().reset()
    const v = value as Saved
    if (!v || v.version !== 1 || !Array.isArray(v.upstream)) throw new Error('The library-pack part of the project is not one this ScanRuler reads.')
    return () => usePack.getState().replace({ settings: { ...DEFAULT_PACK, ...v.settings }, upstream: v.upstream, presets: v.presets ?? [] })
  },
  hasContent: (v) => v.upstream.length > 0 || Boolean(v.settings.licence),
}
