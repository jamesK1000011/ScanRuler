// SPDX-License-Identifier: AGPL-3.0-only
// patent-kit's settings, figures, numerals and draft, kept with the project
// and nowhere else.

import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Figure, type Numeral, type PatentSettings, type Section } from '../core/model'

export interface PatentData {
  settings: PatentSettings
  figures: Figure[]
  numerals: Numeral[]
  draft: Partial<Record<Section, string>>
}

interface PatentState extends PatentData {
  set(p: Partial<PatentData>): void
  replace(d: PatentData): void
  reset(): void
}

const empty = (): PatentData => ({ settings: { ...DEFAULT_SETTINGS }, figures: [], numerals: [], draft: {} })

export const usePatent = create<PatentState>((set) => ({
  ...empty(),
  set: (p) => set(p),
  replace: (d) => set(d),
  reset: () => set(empty()),
}))
