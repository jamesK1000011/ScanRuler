// SPDX-License-Identifier: AGPL-3.0-only
// The Mass workspace's state: how the part is printed (material, infill,
// walls), the calibration from a weighed print, the target, the ballast
// chosen, and the last reading.

import { create } from 'zustand'
import type { M3, V3 } from '../core/mass'

export interface MassSetup {
  material: string
  /** g/cm³ in place of the material's, when given. */
  density?: number
  /** Infill, percent. */
  infill: number
  walls: number
  /** Line width, mm. */
  lineMm: number
  /** Weighed ÷ worked out, from a print on the scales: 1 until calibrated. */
  scale: number
  target: { mass?: number; com?: V3 } | null
  filler: string
}

export interface BodyMass {
  body: string
  /** What it was weighed in, and whether as printed or solid; assumed: no
   *  material of its own was set, so the Mass setup's was taken. */
  material?: string
  as?: 'printed' | 'solid'
  assumed?: boolean
  /** g/cm³, as weighed (the calibration on a printed one's). */
  density?: number
  volume: number
  area: number
  mass: number
  com: V3
  inertia: M3
  principal: { moments: V3; axes: [V3, V3, V3] }
  closed: boolean
}

/** Parts encased in a body (the Hardware workspace's): a nut, a magnet.
 *  Copies of one are one row. */
export interface EmbeddedMass {
  id: string
  body: string
  what: string
  count: number
  material: string
  /** g, all of them. */
  mass: number
  com: V3
  /** About their centre of mass, g·mm². */
  inertia: M3
}

export interface Reading {
  at: string
  /** The Reverse Engineer bodies as they were weighed: a reading of others is stale. */
  bodiesKey: string
  /** The encased parts as they were: a reading of others is stale. */
  embedsKey?: string
  /** The printed bodies alone. */
  bodies: BodyMass[]
  /** Parts encased in them, counted in the total. */
  embedded?: EmbeddedMass[]
  /** Bodies and encased parts together. */
  total: { mass: number; com: V3; inertia: M3 }
}

export interface Pocket {
  body: string
  at: V3
  size: V3
  volume: number
  fillerMass: number
  removedMass: number
  /** How many BBs, for steel BBs. */
  count?: number
  /** The walls the slicer lays round it, g. */
  wallMass?: number
  fits: boolean
  why?: string
  /** The bodies as they were when it was planned. */
  bodiesKey: string
}

export interface MassState extends MassSetup {
  reading: Reading | null
  pocket: Pocket | null
  busy: string | null
  set(p: Partial<MassSetup>): void
  reset(): void
}

export const DEFAULT_MASS: MassSetup = { material: 'pla', infill: 15, walls: 2, lineMm: 0.42, scale: 1, target: null, filler: 'steel-bb' }

/** The setup as the history keeps it: no density override is null, so
 *  that a step back to none clears one. */
export const historyOf = (s: MassSetup) => ({ ...setupOf(s), density: s.density ?? null })

export const setupOf = (s: MassSetup): MassSetup => ({
  material: s.material,
  ...(s.density ? { density: s.density } : {}),
  infill: s.infill,
  walls: s.walls,
  lineMm: s.lineMm,
  scale: s.scale,
  target: s.target,
  filler: s.filler,
})

export const useMass = create<MassState>((set) => ({
  ...DEFAULT_MASS,
  reading: null,
  pocket: null,
  busy: null,
  set: (p) => set(p),
  reset: () => set({ ...DEFAULT_MASS, density: undefined, reading: null, pocket: null }),
}))
