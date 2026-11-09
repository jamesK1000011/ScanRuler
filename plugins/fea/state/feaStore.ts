// SPDX-License-Identifier: AGPL-3.0-only
// The FEA workspace's state: the study set up — which body, the way it is
// printed, its material, what holds it and what loads it — and the last
// answer, with which of its fields is on the part.

import { create } from 'zustand'

/** Faces of a Reverse Engineer body: by index, or by a query as
 *  reverse.body.describe takes it. */
export interface FacePick {
  faces?: number[]
  where?: Record<string, unknown>
  /** The faces' triangles as picked (xyz × 9 each), and the body's key then:
   *  a pick by index is held by where it was, not by a number the body's
   *  next rebuild may give another face. */
  triangles?: number[]
  bodyKey?: string
  /** How many faces it came to when picked. */
  count?: number
}

export interface Hold extends FacePick {
  name: string
}

export interface Load extends FacePick {
  name: string
  /** Total force on the faces, N, part frame. */
  force?: [number, number, number]
  /** Or a pressure pushing on them, MPa. */
  pressure?: number
}

export type Fineness = 'coarse' | 'medium' | 'fine'

export interface FeaSetup {
  body: string | null
  /** The build direction: the layers' normal, part frame. */
  build: [number, number, number]
  material: string
  overrides: Record<string, number>
  holds: Hold[]
  loads: Load[]
  fineness: Fineness
  /** The element size, mm; the fineness's when not given. */
  size?: number
  /** The safety factor asked for: the result says whether it is met. */
  target: number
  /** The part's own weight as a load, when on. */
  gravity?: Gravity
}

/** The part's own weight: the way it pulls (part frame, a unit vector), how
 *  many g, and what it weighs by — the Mass workspace's weighing (walls,
 *  infill and calibration) or the solid material. */
export interface Gravity {
  direction: [number, number, number]
  g: number
  from: 'mass' | 'material'
}

export type Field = 'safety' | 'vonMises' | 'displacement' | 'across' | 'shear'

export interface FeaAnswer {
  solver: { gmsh: string | null; calculix: string | null }
  mesh: { elements: number; nodes: number; size: number }
  material: Record<string, unknown>
  build: number[]
  /** The own weight solved: density g/cm³, mass g, weight N; from says what weighed it. */
  gravity?: { direction: number[]; g: number; density: number; mass: number; weight: number; from?: 'mass' | 'material'; /** g of it encased parts: a magnet in a pocket. */ embedded?: number }
  groups: { fixtures: { name: string; faces: number }[]; loads: { name: string; faces: number; force?: number[]; pressure?: number }[] }
  worst: {
    safety: number | null
    at: number[] | null
    mode: string | null
    atAHold: boolean
    atALoad?: boolean
    awayFromHolds?: { safety: number; at: number[]; mode: string | null }
    vonMises: number
    displacement: number
    displacementAt: number[] | null
  }
  /** Things worth knowing about the answer (part of a hold not found, large strain…). */
  warnings?: string[]
  /** The outside, decoded: the surface's nodes, triangles over them, and each field at each node. */
  surface: { positions: Float32Array; index: Uint32Array; fields: Record<Field, Float32Array> }
}

/** The answer as the server sends it: the surface as base64 little-endian arrays. */
export type FeaWire = Omit<FeaAnswer, 'surface'> & {
  surface: { encoding: string; vertices: number; triangles: number; positions: string; index: string; fields: Record<Field, string> }
}

export interface FeaState extends FeaSetup {
  /** What is under way: its words, since when, and the solver's phase. */
  busy: string | null
  since: number | null
  phase: string | null
  /** materialKey: the body's material and setup as solved (feaMaterial);
   *  built: the build direction solved — a print setup's way up, or the
   *  study's. */
  result: (FeaAnswer & { at: string; setup: FeaSetup; bodyKey: string | null; materialKey?: string; built?: number[] }) | null
  /** Bumped by reset: an answer for an older study is dropped. */
  gen: number
  field: Field
  shown: boolean
  set(patch: Partial<FeaSetup>): void
  reset(): void
}

export const DEFAULT_SETUP: FeaSetup = { body: null, build: [0, 0, 1], material: 'pla', overrides: {}, holds: [], loads: [], fineness: 'medium', target: 2 }

export const setupOf = (s: FeaSetup): FeaSetup => ({ body: s.body, build: s.build, material: s.material, overrides: s.overrides, holds: s.holds, loads: s.loads, fineness: s.fineness, ...(s.size ? { size: s.size } : {}), target: s.target, ...(s.gravity ? { gravity: s.gravity } : {}) })

export const useFea = create<FeaState>((set) => ({
  ...DEFAULT_SETUP,
  busy: null,
  since: null,
  phase: null,
  result: null,
  gen: 0,
  field: 'safety',
  shown: false,
  set: (patch) => set(patch),
  reset: () => set((s) => ({ ...DEFAULT_SETUP, size: undefined, gravity: undefined, result: null, shown: false, field: 'safety', gen: s.gen + 1 })),
}))
