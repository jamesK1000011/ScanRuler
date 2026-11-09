// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › KiCad's state: the board file and what was read of it,
// the last import and what it measured, the enclosure's settings, and what
// the last fab package and DRC said.

import { create } from 'zustand'
import type { Bounds, KicadBoard } from '../core/boardSpec'

export type Naming = 'fab' | 'kicad'
export type EnclosureValues = Record<string, number | boolean>

export interface Imported {
  at: string
  /** The board's body in Reverse Engineer, by name. */
  body: string | null
  /** How many bodies came in. */
  bodies: number
  components: boolean
  /** Measured from the bodies: the parts' reach above and below. */
  above: number
  below: number
  offset: [number, number, number]
  /** Each edge connector's 3D box, in the board's frame. */
  boxes: Record<string, Bounds>
  kicad: string | null
  warnings: string[]
  /** Parts with no 3D model, stood in for by a placeholder box each: by
   *  reference. Absent in projects saved before placeholders. */
  placeholders?: string[]
}

export interface PcbSetup {
  /** The .kicad_pcb on this computer. */
  path: string
  /** Import the parts with the board (else the bare board). */
  components: boolean
  /** STEP models in place of VRML ones of the same name. */
  subst: boolean
  naming: Naming
  /** The board enclosure's values (Generate's board_box) that differ from its defaults. */
  enclosure: EnclosureValues
  /** The parts' reach set by hand, mm; null: measured or guessed. */
  above: number | null
  below: number | null
  /** Edge connectors left without an opening. */
  skip: string[]
}

export interface Tools {
  found: boolean
  path: string | null
  version?: string | null
  major?: number | null
  ready: boolean
  note?: string
  commands?: Record<string, { ok: boolean; has: string[]; missing: string[] }>
}

export interface FabResult {
  at: string
  zip: string
  gerberZip: string
  job: string
  files: string[]
  naming: Naming
  drc: { clean: boolean; violations: number; unconnected: number } | null
  notes: string[]
}

export interface DrcResult {
  at: string
  clean: boolean
  violations: number
  unconnected: number
  bySeverity: Record<string, number>
  items: { type: string | null; severity: string | null; description: string }[]
  report: string
}

interface PcbState extends PcbSetup {
  board: KicadBoard | null
  imported: Imported | null
  enclosureMade: { at: string; bodies: string[] } | null
  tools: Tools | null
  fab: FabResult | null
  drc: DrcResult | null
  busy: string | null
  progress: string
  set(s: Partial<PcbSetup & { board: KicadBoard | null; imported: Imported | null; enclosureMade: { at: string; bodies: string[] } | null }>): void
  reset(): void
}

export const DEFAULT_PCB: PcbSetup = { path: '', components: true, subst: true, naming: 'fab', enclosure: {}, above: null, below: null, skip: [] }

export const usePcb = create<PcbState>((set) => ({
  ...DEFAULT_PCB,
  board: null,
  imported: null,
  enclosureMade: null,
  tools: null,
  fab: null,
  drc: null,
  busy: null,
  progress: '',
  set: (s) => set(s),
  reset: () => set({ ...DEFAULT_PCB, board: null, imported: null, enclosureMade: null, fab: null, drc: null, busy: null, progress: '' }),
}))

/** What is saved and undone: the setup, the board read, the import. */
export const setupOf = (s: PcbSetup & { board: KicadBoard | null; imported: Imported | null; enclosureMade: { at: string; bodies: string[] } | null }) => ({
  path: s.path,
  components: s.components,
  subst: s.subst,
  naming: s.naming,
  enclosure: s.enclosure,
  above: s.above,
  below: s.below,
  skip: s.skip,
  board: s.board,
  imported: s.imported,
  enclosureMade: s.enclosureMade,
})
