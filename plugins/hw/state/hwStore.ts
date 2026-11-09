// SPDX-License-Identifier: AGPL-3.0-only
// The Hardware workspace's state: the settings (allowances, clearance class,
// head and bridge figures, the layers it prints at), the last hole planned
// — what it was asked as, and what it comes to — the last cut made, the
// last hole checked, and the parts encased in the print: where each
// pocket's top is, for the pause that lets it go in.

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
  /** An encased pocket: what hw.apply records for its pause. */
  embed?: EmbedPlan
}

/** A pocket closed in the part, as hw.embed plans it. */
export interface EmbedPlan {
  kind: string
  label: string
  what: string
  /** Each copy's pocket top, Z in the part's frame, mm. */
  tops: number[]
  roof: number | null
  minRoof: number
  span: number
  /** The pause each top takes at the settings' layers, where the body's
   *  place on the bed is known. */
  pauses?: { layer: number; z: number; printZ: number; onBoundary: boolean }[]
  /** The body's lowest Z as planned, where known. */
  bedZ?: number
}

/** A part encased in the print: the pocket it goes in, and where the print
 *  pauses for it. */
export interface Embed {
  id: string
  body: string
  kind: string
  label: string
  /** What goes in, in words. */
  what: string
  /** The pocket's top, Z in the part's frame, mm. */
  top: number
  /** Material over it, mm; null where it was not measured. */
  roof: number | null
  /** The least roof asked for, mm. */
  minRoof: number
  /** The widest span its roof bridges, mm. */
  span: number
  /** How many pockets at this height. */
  count: number
  /** The Reverse Engineer features that cut it; none where it was only
   *  recorded. */
  features: string[]
  /** Where it came from, when not cut here: "mass". */
  source?: string
  /** Its body's lowest Z when it was cut or recorded: a body moved since
   *  takes its pocket with it, the top recorded here not. */
  bedZ?: number
}

export interface HwState extends Settings {
  plan: PlanOut | null
  made: { label: string; body: string; features: string[] } | null
  check: { diameter: number; depth?: number; body?: string; face?: number; matches: Match[] } | null
  embeds: Embed[]
  busy: string | null
  set(p: Partial<Settings>): void
  setEmbeds(e: Embed[]): void
  reset(): void
}

export const settingsOf = (s: Settings): Settings => ({
  allowance: { ...s.allowance },
  printerFit: s.printerFit,
  fit: s.fit,
  headMargin: s.headMargin,
  headSink: s.headSink,
  teardrop: s.teardrop,
  bridgeLayer: s.bridgeLayer,
  insertExtra: s.insertExtra,
  magnetExtra: s.magnetExtra,
  roofLayers: s.roofLayers,
  layerHeight: s.layerHeight,
  firstLayer: s.firstLayer,
  bridgeMax: s.bridgeMax,
  dropClearance: s.dropClearance,
  dropHeadroom: s.dropHeadroom,
})

export const useHw = create<HwState>((set) => ({
  ...settingsOf(DEFAULT_SETTINGS),
  plan: null,
  made: null,
  check: null,
  embeds: [],
  busy: null,
  set: (p) => set(p),
  setEmbeds: (embeds) => set({ embeds }),
  reset: () => set({ ...settingsOf(DEFAULT_SETTINGS), plan: null, made: null, check: null, embeds: [] }),
}))
