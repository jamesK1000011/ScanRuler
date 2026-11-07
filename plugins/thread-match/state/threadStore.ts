// SPDX-License-Identifier: AGPL-3.0-only
// thread-match's settings and the last thread it identified.

import { create } from 'zustand'
import { PITCH_FLOOR } from '../core/decide'
import { FAMILY_IDS, type Family } from '../core/tables'

export interface LastThread {
  verdict: 'match' | 'ambiguous' | 'none'
  best: string | null
  tied: string[]
  at: number[]
}

interface ThreadMatchState {
  families: Family[]
  pitchFloor: number
  last: LastThread | null
  set(p: Partial<Pick<ThreadMatchState, 'families' | 'pitchFloor'>>): void
  remember(last: LastThread): void
  reset(): void
}

export const useThreadMatch = create<ThreadMatchState>((set) => ({
  families: [...FAMILY_IDS],
  pitchFloor: PITCH_FLOOR,
  last: null,
  set: (p) => set(p),
  remember: (last) => set({ last }),
  reset: () => set({ families: [...FAMILY_IDS], pitchFloor: PITCH_FLOOR }),
}))
