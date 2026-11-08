// SPDX-License-Identifier: AGPL-3.0-only
// The screenshots the person took of this tab, newest first, kept in the
// page's memory only — never in the project, never in storage — until the
// tab closes or they are discarded. An agent reads them (snapshot.*) only
// when asked to look.

import { create } from 'zustand'

/** A mark the person drew on a shot, in the shot's own pixels. */
export interface ShotMark {
  kind: 'pin' | 'arrow' | 'box' | 'circle' | 'pen'
  /** x, y pairs: a pin's point; an arrow's tail then head; a box's or a
   *  circle's two corners; a pen's whole stroke. */
  pts: number[]
  color: string
  /** A pin's number and what the person wrote on it. */
  n?: number
  comment?: string
}

export interface Shot {
  id: string
  at: string
  png: Uint8Array
  url: string
  width: number
  height: number
  note: string
  workspace: string | null
  marks: ShotMark[]
  /** Where the agent's server wrote it, once it has. */
  path?: string
}

const SAVE_KEY = 'scanruler.snapshot.save'
const readSave = () => {
  try {
    return localStorage.getItem(SAVE_KEY) !== '0'
  } catch {
    return true
  }
}

export const KEEP = 8

interface Shots {
  shots: Shot[]
  /** The card under the button: the shot just taken, until put away. */
  open: string | null
  busy: boolean
  error: string | null
  /** The shot open in the markup view. */
  editing: string | null
  /** Whether the agent's server saves each shot beside the scan. */
  save: boolean
  add(s: Shot): void
  note(id: string, note: string): void
  setMarks(id: string, marks: ShotMark[]): void
  saved(id: string, path: string): void
  setSave(on: boolean): void
  remove(id: string): void
  clear(): void
}

export const useShots = create<Shots>((set, get) => ({
  shots: [],
  open: null,
  busy: false,
  error: null,
  editing: null,
  save: readSave(),
  add: (s) => {
    const all = [s, ...get().shots]
    for (const old of all.slice(KEEP)) URL.revokeObjectURL(old.url)
    set({ shots: all.slice(0, KEEP), open: s.id, error: null })
  },
  note: (id, note) => set({ shots: get().shots.map((s) => (s.id === id ? { ...s, note } : s)) }),
  setMarks: (id, marks) => set({ shots: get().shots.map((s) => (s.id === id ? { ...s, marks } : s)) }),
  saved: (id, path) => set({ shots: get().shots.map((s) => (s.id === id ? { ...s, path } : s)) }),
  setSave: (on) => {
    try {
      localStorage.setItem(SAVE_KEY, on ? '1' : '0')
    } catch {
      /* private mode: for this tab only */
    }
    set({ save: on })
  },
  remove: (id) => {
    const s = get().shots.find((x) => x.id === id)
    if (s) URL.revokeObjectURL(s.url)
    set({ shots: get().shots.filter((x) => x.id !== id), open: get().open === id ? null : get().open, editing: get().editing === id ? null : get().editing })
  },
  clear: () => {
    for (const s of get().shots) URL.revokeObjectURL(s.url)
    set({ shots: [], open: null, editing: null })
  },
}))
