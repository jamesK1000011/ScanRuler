// SPDX-License-Identifier: AGPL-3.0-only
// dfm-fdm's choices, the project's own rule overrides, the waivers and the
// last check's findings.

import { create } from 'zustand'
import type { Finding } from '../core/checks'
import type { Up } from '../core/frame'
import type { Guide, Override } from '../core/rules'

export interface DfmSettings {
  up: Up
  printer: string | null
  material: string | null
  nozzle: string | null
  /** A published guide's numbers, stacked over the profiles. */
  guide: string | null
  /** The scan, the reference part, or a Reverse Engineer body as it
   *  stands now. */
  target: 'scan' | 'reference' | 'body'
  /** For target body: which, by name or id; null for the one shown. */
  body: string | number | null
}

/** What the last check read: the part's name, the body's stamp when it was
 *  a body, and why it was an older copy when it was one. */
export interface Checked {
  target: DfmSettings['target']
  part: string
  stamp?: string
  stale?: string
  /** On a CAD part: the least wall read (null: none within reach), one
   *  extrusion line and the minimum wall, mm. */
  wall?: { least: number | null; line?: number; limit: number }
}

export interface Waiver {
  rule: string
  /** Where the finding was, mm, rounded to the millimetre: a finding at the
   *  same place under the same rule is waived again at the next check. */
  at: [number, number, number]
  reason: string
}

export interface NumberedFinding extends Finding {
  id: string
  waived?: string
}

export const DEFAULT_DFM: DfmSettings = { up: '+z', printer: null, material: null, nozzle: '0.4', guide: null, target: 'scan', body: null }

interface DfmState {
  settings: DfmSettings
  overrides: Record<string, Override>
  waivers: Waiver[]
  /** Guides imported into this project. */
  guides: Guide[]
  findings: NumberedFinding[]
  skipped: { rule: string; why: string }[]
  checkedAt: string | null
  checked: Checked | null
  set(p: Partial<DfmSettings>): void
  setOverride(rule: string, o: Override | null): void
  addGuide(g: Guide): void
  removeGuide(id: string): void
  waive(w: Waiver): void
  unwaive(rule: string, at: [number, number, number]): boolean
  result(findings: NumberedFinding[], skipped: { rule: string; why: string }[], checked?: Checked | null): void
  replace(s: Pick<DfmState, 'settings' | 'overrides' | 'waivers'> & { guides?: Guide[] }): void
  reset(): void
}

export const atKey = (at: readonly number[]): [number, number, number] => [Math.round(at[0]), Math.round(at[1]), Math.round(at[2])]

export const useDfm = create<DfmState>((set, get) => ({
  settings: { ...DEFAULT_DFM },
  overrides: {},
  waivers: [],
  guides: [],
  findings: [],
  skipped: [],
  checkedAt: null,
  checked: null,
  set: (p) => set({ settings: { ...get().settings, ...p } }),
  setOverride: (rule, o) => {
    const next = { ...get().overrides }
    if (o) next[rule] = o
    else delete next[rule]
    set({ overrides: next })
  },
  addGuide: (g) => set({ guides: [...get().guides.filter((x) => x.id !== g.id), g] }),
  removeGuide: (id) => set({ guides: get().guides.filter((x) => x.id !== id), settings: get().settings.guide === id ? { ...get().settings, guide: null } : get().settings }),
  waive: (w) => set({ waivers: [...get().waivers.filter((x) => !(x.rule === w.rule && x.at.join() === w.at.join())), w] }),
  unwaive: (rule, at) => {
    const before = get().waivers.length
    set({ waivers: get().waivers.filter((x) => !(x.rule === rule && x.at.join() === at.join())) })
    return get().waivers.length < before
  },
  result: (findings, skipped, checked = null) => set({ findings, skipped, checked, checkedAt: new Date().toISOString() }),
  replace: (s) => set(s),
  reset: () => set({ settings: { ...DEFAULT_DFM }, overrides: {}, waivers: [], guides: [], findings: [], skipped: [], checkedAt: null, checked: null }),
}))
