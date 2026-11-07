// SPDX-License-Identifier: AGPL-3.0-only
// fit-comp's settings, the runs measured in this project, the saved
// correction profiles and any key maps of your own.

import { create } from 'zustand'
import type { Up } from '../core/frame'
import type { Readings } from '../core/measure'
import type { Solution } from '../core/solve'
import type { Keymap } from '../core/suggest'

export interface FitSettings {
  up: Up
  /** How far off the nominal surface a scan point still counts, mm. */
  band: number
  /** The first layer's height, mm. */
  firstLayer: number
  /** The key map the suggestions are written for. */
  slicer: string
  /** What the run was printed on, for the record and the profiles. */
  printer: string
  material: string
  nozzle: string
  /** The slicer's values in use when the part was printed, by key. */
  current: Record<string, number>
  /** Flat walls that bound a pocket (a hole's, to the slicer). */
  inner: string[]
  /** Features left out of the fit. */
  ignore: string[]
}

export const DEFAULT_SETTINGS: FitSettings = {
  up: '+z',
  band: 1,
  firstLayer: 0.2,
  slicer: 'orcaslicer',
  printer: '',
  material: '',
  nozzle: '',
  current: {},
  inner: [],
  ignore: [],
}

export interface FitRun {
  n: number
  at: string
  reference: string
  settings: FitSettings
  readings: Readings
  solution: Solution
}

export interface FitProfile {
  name: string
  slicer: string
  printer: string
  material: string
  nozzle: string
  /** The settings to print with, by key. */
  values: Record<string, number>
  from: number | null
  at: string
}

interface FitState {
  settings: FitSettings
  runs: FitRun[]
  profiles: FitProfile[]
  keymaps: Keymap[]
  setSettings(p: Partial<FitSettings>): void
  addRun(run: Omit<FitRun, 'n'>): FitRun
  saveProfile(p: FitProfile): void
  removeProfile(name: string): boolean
  addKeymap(k: Keymap): void
  removeKeymap(id: string): boolean
  replace(s: Pick<FitState, 'settings' | 'runs' | 'profiles' | 'keymaps'>): void
  reset(): void
}

/** Runs kept per project: the latest, enough to see a trend. */
const RUNS_KEPT = 12

export const useFit = create<FitState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  runs: [],
  profiles: [],
  keymaps: [],
  setSettings: (p) => set({ settings: { ...get().settings, ...p } }),
  addRun: (run) => {
    const n = (get().runs.at(-1)?.n ?? 0) + 1
    const full = { ...run, n }
    set({ runs: [...get().runs, full].slice(-RUNS_KEPT) })
    return full
  },
  saveProfile: (p) => set({ profiles: [...get().profiles.filter((x) => x.name !== p.name), p] }),
  removeProfile: (name) => {
    const before = get().profiles.length
    set({ profiles: get().profiles.filter((x) => x.name !== name) })
    return get().profiles.length < before
  },
  addKeymap: (k) => set({ keymaps: [...get().keymaps.filter((x) => x.id !== k.id), k] }),
  removeKeymap: (id) => {
    const before = get().keymaps.length
    set({ keymaps: get().keymaps.filter((x) => x.id !== id) })
    return get().keymaps.length < before
  },
  replace: (s) => set(s),
  reset: () => set({ settings: { ...DEFAULT_SETTINGS }, runs: [], profiles: [], keymaps: [] }),
}))
