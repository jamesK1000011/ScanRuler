// SPDX-License-Identifier: AGPL-3.0-only
// The screenshots the person took of this tab, newest first, kept in the
// page's memory only — never in the project, never in storage — until the
// tab closes or they are discarded. An agent reads them (snapshot.*) only
// when asked to look.

import { create } from 'zustand'

export interface Shot {
  id: string
  at: string
  png: Uint8Array
  url: string
  width: number
  height: number
  note: string
  workspace: string | null
}

export const KEEP = 8

interface Shots {
  shots: Shot[]
  /** The card under the button: the shot just taken, until put away. */
  open: string | null
  busy: boolean
  error: string | null
  add(s: Shot): void
  note(id: string, note: string): void
  remove(id: string): void
  clear(): void
}

export const useShots = create<Shots>((set, get) => ({
  shots: [],
  open: null,
  busy: false,
  error: null,
  add: (s) => {
    const all = [s, ...get().shots]
    for (const old of all.slice(KEEP)) URL.revokeObjectURL(old.url)
    set({ shots: all.slice(0, KEEP), open: s.id, error: null })
  },
  note: (id, note) => set({ shots: get().shots.map((s) => (s.id === id ? { ...s, note } : s)) }),
  remove: (id) => {
    const s = get().shots.find((x) => x.id === id)
    if (s) URL.revokeObjectURL(s.url)
    set({ shots: get().shots.filter((x) => x.id !== id), open: get().open === id ? null : get().open })
  },
  clear: () => {
    for (const s of get().shots) URL.revokeObjectURL(s.url)
    set({ shots: [], open: null })
  },
}))
