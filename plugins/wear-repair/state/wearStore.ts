// SPDX-License-Identifier: AGPL-3.0-only
// wear-repair's settings, the regions tagged, the reference chosen and the
// pre-warp runs, kept with the project.

import { create } from 'zustand'
import type { Region } from '../core/geometry'
import type { Run } from '../core/prewarp'

export interface WearSettings {
  /** What counts as worn or as on target, mm. */
  tolerance: number
  /** How far outside a worn region a repair fades out, mm. */
  blendMm: number
  /** How far the reference may be from a point and still be its surface. */
  maxMm: number
  mode: 'add' | 'both'
}

export interface Tag {
  name: string
  kind: 'worn' | 'keep'
  region: Region
}

export type Reference = { source: 'mirror'; point: [number, number, number]; normal: [number, number, number] } | { source: 'deviation' }

export const DEFAULT_WEAR: WearSettings = { tolerance: 0.05, blendMm: 1, maxMm: 2, mode: 'add' }

interface WearState {
  settings: WearSettings
  tags: Tag[]
  reference: Reference | null
  runs: Run[]
  set(p: Partial<WearSettings>): void
  tag(t: Tag): void
  untag(name: string): boolean
  clearTags(): void
  setReference(r: Reference | null): void
  addRun(rms: number): Run
  clearRuns(): void
  replace(s: Pick<WearState, 'settings' | 'tags' | 'reference' | 'runs'>): void
  reset(): void
}

export const useWear = create<WearState>((set, get) => ({
  settings: { ...DEFAULT_WEAR },
  tags: [],
  reference: null,
  runs: [],
  set: (p) => set({ settings: { ...get().settings, ...p } }),
  tag: (t) => set({ tags: [...get().tags.filter((x) => x.name !== t.name), t] }),
  untag: (name) => {
    const before = get().tags.length
    set({ tags: get().tags.filter((x) => x.name !== name) })
    return get().tags.length < before
  },
  clearTags: () => set({ tags: [] }),
  setReference: (reference) => set({ reference }),
  addRun: (rms) => {
    const run = { n: (get().runs.at(-1)?.n ?? 0) + 1, rms, at: new Date().toISOString() }
    set({ runs: [...get().runs, run] })
    return run
  },
  clearRuns: () => set({ runs: [] }),
  replace: (s) => set(s),
  reset: () => set({ settings: { ...DEFAULT_WEAR }, tags: [], reference: null, runs: [] }),
}))
