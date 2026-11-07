// SPDX-License-Identifier: AGPL-3.0-only
// fit-comp's part of a project file: the settings, the runs, the saved
// profiles and your own key maps, as JSON.

import type { ProjectSection } from '../../../src/app/projectSections'
import { DEFAULT_SETTINGS, useFit, type FitProfile, type FitRun, type FitSettings } from '../state/fitStore'
import type { Keymap } from '../core/suggest'

interface SavedFit {
  version: 1
  settings: FitSettings
  runs: FitRun[]
  profiles: FitProfile[]
  keymaps: Keymap[]
}

export const fitSection: ProjectSection<SavedFit> = {
  key: 'fit-comp',
  collect() {
    const s = useFit.getState()
    const changed = JSON.stringify(s.settings) !== JSON.stringify(DEFAULT_SETTINGS)
    if (!changed && s.runs.length === 0 && s.profiles.length === 0 && s.keymaps.length === 0) return undefined
    return { version: 1, settings: s.settings, runs: s.runs, profiles: s.profiles, keymaps: s.keymaps }
  },
  prepare(value) {
    if (value === undefined) return () => useFit.getState().reset()
    const v = value as SavedFit
    if (!v || v.version !== 1 || typeof v.settings !== 'object' || !Array.isArray(v.runs) || !Array.isArray(v.profiles) || !Array.isArray(v.keymaps)) throw new Error('The print-fit part of the project is not one this ScanRuler reads.')
    return () => useFit.getState().replace({ settings: { ...DEFAULT_SETTINGS, ...v.settings }, runs: v.runs, profiles: v.profiles, keymaps: v.keymaps })
  },
  hasContent: (v) => v.runs.length > 0 || v.profiles.length > 0,
}
