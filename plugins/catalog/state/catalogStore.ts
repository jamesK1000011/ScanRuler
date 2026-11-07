// SPDX-License-Identifier: AGPL-3.0-only
// Where each part brought into this project came from: its source, page,
// licence and what may be done with it — kept with the project, read by
// whatever later shares the project's files.

import { create } from 'zustand'

export interface Provenance {
  file: string
  source: string
  url?: string
  licence?: string
  /** May the file be shared on (library-pack reads this). */
  redistribute: boolean
  note?: string
  at: string
}

interface CatalogState {
  parts: Provenance[]
  record(p: Provenance): void
  forget(file: string): boolean
  replace(parts: Provenance[]): void
}

export const useCatalog = create<CatalogState>((set, get) => ({
  parts: [],
  record: (p) => set({ parts: [...get().parts.filter((x) => x.file !== p.file), p] }),
  forget: (file) => {
    const before = get().parts.length
    set({ parts: get().parts.filter((x) => x.file !== file) })
    return get().parts.length < before
  },
  replace: (parts) => set({ parts }),
}))
