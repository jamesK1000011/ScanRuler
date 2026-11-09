// SPDX-License-Identifier: AGPL-3.0-only
// The Generate workspace's state: the generator picked, the values set for
// each, and what was last made.

import { create } from 'zustand'
import { GENERATORS, type Value } from '../core/generators'
import type { GenPart } from '../core/genWorker'
import type { BoardSpec } from '../core/boardBox'

export interface Made {
  generator: string
  params: Record<string, Value>
  parts: GenPart[]
  /** The Reverse Engineer bodies it became. */
  bodies: string[]
}

export interface GenSetup {
  generator: string
  /** Values set, per generator — only those that differ from its defaults. */
  values: Record<string, Record<string, Value>>
  /** The board a board enclosure goes round (Electronics › KiCad sets it). */
  board: BoardSpec | null
  /** Holes, gaps and margins not set by hand follow the printer's fit
   *  calibration (Fits), when there is one. */
  printerFit: boolean
}

interface GenState extends GenSetup {
  busy: boolean
  status: string
  made: Made | null
  set(s: Partial<GenSetup>): void
  setValues(generator: string, values: Record<string, Value>): void
  reset(): void
}

export const DEFAULT_GEN: GenSetup = { generator: GENERATORS[0].id, values: {}, board: null, printerFit: true }

export const useGen = create<GenState>((set) => ({
  ...DEFAULT_GEN,
  busy: false,
  status: '',
  made: null,
  set: (s) => set(s),
  setValues: (generator, values) =>
    set((st) => {
      const g = GENERATORS.find((x) => x.id === generator)
      const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => g?.defaults[k] !== v))
      const next = { ...st.values }
      if (Object.keys(changed).length) next[generator] = changed
      else delete next[generator]
      return { values: next }
    }),
  reset: () => set({ ...DEFAULT_GEN, busy: false, status: '', made: null }),
}))

export const setupOf = (s: GenSetup): GenSetup => ({ generator: s.generator, values: s.values, board: s.board, printerFit: s.printerFit })
