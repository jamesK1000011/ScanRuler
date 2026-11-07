// SPDX-License-Identifier: AGPL-3.0-only
// dfm-fdm's choices, the project's own rule overrides, the waivers and the
// last check's findings.

import { create } from 'zustand'
import type { Finding } from '../core/checks'
import type { Up } from '../core/frame'
import type { Override } from '../core/rules'

export interface DfmSettings {
  up: Up
  printer: string | null
  material: string | null
  nozzle: string | null
  target: 'scan' | 'reference'
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

export const DEFAULT_DFM: DfmSettings = { up: '+z', printer: null, material: null, nozzle: '0.4', target: 'scan' }

interface DfmState {
  settings: DfmSettings
  overrides: Record<string, Override>
  waivers: Waiver[]
  findings: NumberedFinding[]
  skipped: { rule: string; why: string }[]
  checkedAt: string | null
  set(p: Partial<DfmSettings>): void
  setOverride(rule: string, o: Override | null): void
  waive(w: Waiver): void
  unwaive(rule: string, at: [number, number, number]): boolean
  result(findings: NumberedFinding[], skipped: { rule: string; why: string }[]): void
  replace(s: Pick<DfmState, 'settings' | 'overrides' | 'waivers'>): void
  reset(): void
}

export const atKey = (at: readonly number[]): [number, number, number] => [Math.round(at[0]), Math.round(at[1]), Math.round(at[2])]

export const useDfm = create<DfmState>((set, get) => ({
  settings: { ...DEFAULT_DFM },
  overrides: {},
  waivers: [],
  findings: [],
  skipped: [],
  checkedAt: null,
  set: (p) => set({ settings: { ...get().settings, ...p } }),
  setOverride: (rule, o) => {
    const next = { ...get().overrides }
    if (o) next[rule] = o
    else delete next[rule]
    set({ overrides: next })
  },
  waive: (w) => set({ waivers: [...get().waivers.filter((x) => !(x.rule === w.rule && x.at.join() === w.at.join())), w] }),
  unwaive: (rule, at) => {
    const before = get().waivers.length
    set({ waivers: get().waivers.filter((x) => !(x.rule === rule && x.at.join() === at.join())) })
    return get().waivers.length < before
  },
  result: (findings, skipped) => set({ findings, skipped, checkedAt: new Date().toISOString() }),
  replace: (s) => set(s),
  reset: () => set({ settings: { ...DEFAULT_DFM }, overrides: {}, waivers: [], findings: [], skipped: [], checkedAt: null }),
}))
