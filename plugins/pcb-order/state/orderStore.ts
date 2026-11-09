// SPDX-License-Identifier: AGPL-3.0-only
// Make › Order's state: what the last check and the last package of each
// PCB order setup said, by setup id, for the page and for the next check
// (which reads the parts lists the package collected). Not saved with the
// project: each is made again from the board.

import { create } from 'zustand'
import type { Finding } from '../app/pcboCommandCore'

export interface Checked {
  at: string
  verdict: 'ok' | 'fix' | 'unknown'
  findings: Finding[]
  board: string | null
  source: string | null
}

export interface Packaged {
  at: string
  name: string
  files: string[]
  /** The parts lists' references, as the package found them; null: none. */
  bom: string[] | null
  cpl: string[] | null
  findings: Finding[]
}

interface OrderState {
  checked: Record<string, Checked>
  packaged: Record<string, Packaged>
  busy: string | null
  reset(): void
}

export const useOrder = create<OrderState>((set) => ({
  checked: {},
  packaged: {},
  busy: null,
  reset: () => set({ checked: {}, packaged: {}, busy: null }),
}))
