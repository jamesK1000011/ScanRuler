// SPDX-License-Identifier: AGPL-3.0-only
// What import-plus last opened, and a line for the person when a model
// dropped on the page could not be opened.

import { create } from 'zustand'

export interface Imported {
  name: string
  as: 'scan' | 'reference'
  format: string
  units: string
  up: string
  triangles: number
  parts: string[]
}

interface ImportState {
  last: Imported | null
  notice: string | null
  remember(i: Imported): void
  say(notice: string | null): void
}

export const useImportPlus = create<ImportState>((set) => ({
  last: null,
  notice: null,
  remember: (last) => set({ last, notice: null }),
  say: (notice) => set({ notice }),
}))
