// SPDX-License-Identifier: AGPL-3.0-only
// The Printed circuits workspace's state: the settings (the conductive
// filament, the nozzle and layers, clearance, a trace's size, the current
// checked at, copper's figures), the last plan — what it was asked as, and
// what it comes to — and the circuits made: which body is the traces, and
// which features made them.

import { create } from 'zustand'
import type { NetOut } from '../core/plan'
import { DEFAULT_SETTINGS, type Settings } from '../core/plan'

export interface PlanKept {
  /** printed.plan's input, as asked (routed points filled in). */
  input: Record<string, unknown>
  method: 'trace' | 'channel'
  body: string
  name: string
  nets: NetOut[]
  warnings: string[]
  notes: string[]
  features: unknown[]
  /** A closed channel's top, Z part frame, for its pause. */
  pauseTop?: number | null
  /** The face planned on, as it stood: apply checks it still is. */
  face?: { index: number; centroid: number[]; normal: number[] }
  /** The settings changed since: apply plans it again with them. */
  stale?: boolean
}

export interface Made {
  id: string
  method: 'trace' | 'channel'
  /** The part. */
  body: string
  /** The traces' body (trace method). */
  traces?: string
  /** The filament it is printed in, in words (trace method). */
  filament?: string
  features: string[]
  nets: { name: string; resistance: number }[]
  /** A closed channel's pause: its top, Z part frame. */
  pause?: { top: number; what: string; recorded: boolean }
}

export interface PrintedState extends Settings {
  plan: PlanKept | null
  made: Made[]
  check: { current: number; nets: NetOut[]; warnings: string[] } | null
  busy: string | null
  set(p: Partial<Settings>): void
  setMade(m: Made[]): void
  reset(): void
}

export const settingsOf = (s: Settings): Settings => ({
  material: s.material,
  along: s.along,
  through: s.through,
  nozzle: s.nozzle,
  layerHeight: s.layerHeight,
  clearance: s.clearance,
  width: s.width,
  thickness: s.thickness,
  depth: s.depth,
  current: s.current,
  heatWarn: s.heatWarn,
  copper: s.copper,
  wireClearance: s.wireClearance,
  tapeClearance: s.tapeClearance,
  roofLayers: s.roofLayers,
})

export const usePrinted = create<PrintedState>((set) => ({
  ...settingsOf(DEFAULT_SETTINGS),
  plan: null,
  made: [],
  check: null,
  busy: null,
  set: (p) => set(p),
  setMade: (made) => set({ made }),
  reset: () => set({ ...settingsOf(DEFAULT_SETTINGS), plan: null, made: [], check: null }),
}))
