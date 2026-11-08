// SPDX-License-Identifier: AGPL-3.0-only
// The Hardware workspace's state: the settings (allowances, clearance class,
// head and bridge figures), the last hole planned — what it was asked as,
// and what it comes to — the last cut made and the last hole checked.

import { create } from 'zustand'
import type { Match } from '../core/check'
import type { Kind } from '../core/hardware'
import { DEFAULT_SETTINGS, type Settings } from '../core/plan'

/** A hole as it is asked for: hw.plan's input. */
export type PlanInput = Record<string, unknown> & { kind: Kind; size: string }

export interface PlanOut {
  input: PlanInput
  label: string
  steps: unknown[]
  notes: string[]
  centres: [number, number, number][]
  features: unknown[]
  /** The face it was planned on, as it stood: hw.apply checks it still is. */
  face?: { index: number; centroid: number[]; normal: number[] }
  /** The settings changed since: hw.apply plans it again with them. */
  stale?: boolean
}

export interface HwState extends Settings {
  plan: PlanOut | null
  made: { label: string; body: string; features: string[] } | null
  check: { diameter: number; depth?: number; body?: string; face?: number; matches: Match[] } | null
  busy: string | null
  set(p: Partial<Settings>): void
  reset(): void
}

export const settingsOf = (s: Settings): Settings => ({
  allowance: { ...s.allowance },
  fit: s.fit,
  headMargin: s.headMargin,
  headSink: s.headSink,
  teardrop: s.teardrop,
  bridgeLayer: s.bridgeLayer,
  insertExtra: s.insertExtra,
  magnetExtra: s.magnetExtra,
})

export const useHw = create<HwState>((set) => ({
  ...settingsOf(DEFAULT_SETTINGS),
  plan: null,
  made: null,
  check: null,
  busy: null,
  set: (p) => set(p),
  reset: () => set({ ...settingsOf(DEFAULT_SETTINGS), plan: null, made: null, check: null }),
}))
