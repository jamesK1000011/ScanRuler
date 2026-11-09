// SPDX-License-Identifier: AGPL-3.0-only
// The setups' part of a project file, under setups: { version, setups,
// selected }, each setup { id, type, name, bodies, …its settings } —
// written with none too, so a project whose setups were all taken away
// does not read as one from before setups. One from before (no part at
// all) opens with the print setup migrated() makes of it.

import type { ProjectSection } from '../../../src/app/projectSections'
import { setupTypeOf, type Setup } from '../../_shared/setups'
import { migrated, readSetups } from '../core/setups'
import { useSetups } from '../state/setupsStore'

interface SavedSetups {
  version: 1
  setups: Setup[]
  selected?: string | null
}

export const setupsSection: ProjectSection<SavedSetups> = {
  key: 'setups',
  collect() {
    const s = useSetups.getState()
    return { version: 1, setups: s.setups, selected: s.selected }
  },
  prepare(value, ctx) {
    if (value === undefined) {
      const made = migrated(ctx.manifest as unknown as Record<string, unknown>)
      return () => useSetups.getState().replace(made, made[0]?.id ?? null)
    }
    const v = value as SavedSetups
    if (!v || v.version !== 1) throw new Error('The setups part of the project is not one this ScanRuler reads.')
    const setups = readSetups(v, setupTypeOf)
    if (typeof setups === 'string') throw new Error(`The project’s setups do not read: ${setups}.`)
    return () => useSetups.getState().replace(setups, typeof v.selected === 'string' ? v.selected : null)
  },
  hasContent: (v) => v.setups.length > 0,
  watch(changed) {
    return useSetups.subscribe((s, prev) => {
      if (s.setups !== prev.setups || s.selected !== prev.selected) changed()
    })
  },
}
