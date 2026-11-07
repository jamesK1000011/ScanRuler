// SPDX-License-Identifier: AGPL-3.0-only
// assembly-manual's parts, steps, style and settings, kept with the project.

import { create } from 'zustand'
import { DEFAULT_SETTINGS, DEFAULT_STYLE, type AsmSettings, type Part, type Step, type Style } from '../core/model'

export interface AsmData {
  settings: AsmSettings
  parts: Part[]
  steps: Step[]
  style: Style
}

interface AsmState extends AsmData {
  set(p: Partial<AsmData>): void
  replace(d: AsmData): void
  reset(): void
}

const empty = (): AsmData => ({ settings: { ...DEFAULT_SETTINGS }, parts: [], steps: [], style: { ...DEFAULT_STYLE, words: { ...DEFAULT_STYLE.words } } })

export const useAsm = create<AsmState>((set) => ({
  ...empty(),
  set: (p) => set(p),
  replace: (d) => set(d),
  reset: () => set(empty()),
}))
