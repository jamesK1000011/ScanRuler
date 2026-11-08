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
  volume: number
  area: number
  mass: number
  com: V3
  inertia: M3
  principal: { moments: V3; axes: [V3, V3, V3] }
  closed: boolean
}

export interface Reading {
  at: string
  bodies: BodyMass[]
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
  fits: boolean
  why?: string
}

export interface MassState extends MassSetup {
  reading: Reading | null
  pocket: Pocket | null
  busy: string | null
  set(p: Partial<MassSetup>): void
  reset(): void
}

export const DEFAULT_MASS: MassSetup = { material: 'pla', infill: 15, walls: 2, lineMm: 0.42, scale: 1, target: null, filler: 'steel-bb' }

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
