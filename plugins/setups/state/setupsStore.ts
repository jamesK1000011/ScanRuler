// SPDX-License-Identifier: AGPL-3.0-only
// The project's setups, and the one the Make tab shows.

import { create } from 'zustand'
import type { Setup } from '../../_shared/setups'

interface SetupsState {
  setups: Setup[]
  /** The setup the Make tab shows, by id; null for none. */
  selected: string | null
  replace(setups: Setup[], selected?: string | null): void
  select(id: string | null): void
  reset(): void
}

export const useSetups = create<SetupsState>((set, get) => ({
  setups: [],
  selected: null,
  replace: (setups, selected) => {
    const want = selected === undefined ? get().selected : selected
    set({ setups, selected: want && setups.some((s) => s.id === want) ? want : (setups[0]?.id ?? null) })
  },
  select: (id) => set({ selected: id && get().setups.some((s) => s.id === id) ? id : null }),
  reset: () => set({ setups: [], selected: null }),
}))
