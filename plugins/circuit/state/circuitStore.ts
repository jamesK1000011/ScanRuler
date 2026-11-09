// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › tscircuit's state: the settings, the project folder and its
// last build, the board read from a circuit.json, and what was last made of
// it in Reverse Engineer.

import { create } from 'zustand'
import type { Part } from '../core/boardSolids'
import type { CircuitBoard } from '../core/circuitJson'
import type { BoardStats } from '../core/geometry'
import type { NetOhms } from '../core/resistance'

export interface PartsOn {
  board: boolean
  copperTop: boolean
  copperBottom: boolean
  keepouts: boolean
}

export interface CircuitSettings {
  /** The conductor the resistance is estimated for. */
  conductor: string
  /** The trace's thickness for it, mm; null: the conductor's own. */
  thickness: number | null
  /** The copper solids' thickness, mm. */
  copper: number
  /** A keep-out's height where the file gives none, mm. */
  keepoutHeight: number
  parts: PartsOn
}

export interface ProjectRef {
  /** The project's folder on this computer, as the server names it. */
  folder: string | null
  entry: string | null
}

export interface LastBuild {
  job: string
  folder: string
  ok: boolean
  files: string[]
  errors: { type: string; message: string }[]
  warnings: number
  failed: string[]
  seconds: number | null
  /** Why the build failed, when its circuit.json holds errors. */
  failure?: string
}

export interface Loaded {
  name: string
  /** Where it came from: a build's job, a file, or text given. */
  from: { job?: string; path?: string }
  /** The circuit.json's text, as read — saved with the project. */
  text: string
  board: CircuitBoard
  stats: BoardStats
}

export interface MadeBodies {
  bodies: string[]
  parts: Part[]
  notes: string[]
}

export interface CircuitSetup {
  settings: CircuitSettings
  project: ProjectRef
  lastBuild: LastBuild | null
  loaded: Loaded | null
  made: MadeBodies | null
}

interface CircuitState extends CircuitSetup {
  busy: boolean
  status: string
  /** The last resistance estimate, for the panel. */
  resistance: { conductor: string; thickness: number; nets: NetOhms[] } | null
  /** What the server last said of tsci. */
  tools: { ready: boolean; version: string | null; path: string | null; howTo: string | null; checked: boolean }
  set(s: Partial<CircuitSetup & Pick<CircuitState, 'resistance' | 'tools'>>): void
  setSettings(s: Partial<CircuitSettings>): void
  reset(): void
}

export const DEFAULT_SETTINGS: CircuitSettings = { conductor: 'copper', thickness: null, copper: 0.035, keepoutHeight: 3, parts: { board: true, copperTop: true, copperBottom: true, keepouts: true } }
export const DEFAULT_SETUP: CircuitSetup = { settings: DEFAULT_SETTINGS, project: { folder: null, entry: null }, lastBuild: null, loaded: null, made: null }
const NO_TOOLS = { ready: false, version: null, path: null, howTo: null, checked: false }

export const useCircuit = create<CircuitState>((set) => ({
  ...DEFAULT_SETUP,
  busy: false,
  status: '',
  resistance: null,
  tools: NO_TOOLS,
  set: (s) => set(s),
  setSettings: (s) => set((st) => ({ settings: { ...st.settings, ...s, parts: { ...st.settings.parts, ...(s.parts ?? {}) } } })),
  reset: () => set({ ...DEFAULT_SETUP, busy: false, status: '', resistance: null }),
}))

export const setupOf = (s: CircuitSetup): CircuitSetup => ({ settings: s.settings, project: s.project, lastBuild: s.lastBuild, loaded: s.loaded, made: s.made })
