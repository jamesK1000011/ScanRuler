// SPDX-License-Identifier: AGPL-3.0-only
// The Circuit workspace's part of a project file: the settings, the project
// folder and its last build, what was made, and the open board's
// circuit.json — kept in the archive as circuit/circuit.json, so the board
// opens again without the computer it was built on. The bodies made are
// Reverse Engineer's Import feature, saved with it.

import type { ProjectSection } from '../../../src/app/projectSections'
import { readCircuitJson } from '../core/circuitJson'
import { netsOf, piecesOf, statsOf } from '../core/geometry'
import { conductorOf } from '../core/resistance'
import { DEFAULT_SETTINGS, setupOf, useCircuit, type CircuitSettings, type LastBuild, type MadeBodies, type ProjectRef } from '../state/circuitStore'

const MEMBER = 'circuit/circuit.json'

interface SavedCircuit {
  version: 1
  settings: CircuitSettings
  project: ProjectRef
  lastBuild: LastBuild | null
  made: MadeBodies | null
  /** The open board: its name and where it came from; its text is the member. */
  loaded: { name: string; from: { job?: string; path?: string }; member: string } | null
}

const posOr = (v: unknown, d: number, max: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max ? v : d)

/** What of saved settings still reads; the rest are the defaults. */
export function settingsIn(u: unknown): CircuitSettings {
  const o = u && typeof u === 'object' ? (u as Record<string, unknown>) : {}
  const p = o.parts && typeof o.parts === 'object' ? (o.parts as Record<string, unknown>) : {}
  const b = (k: keyof CircuitSettings['parts']) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : DEFAULT_SETTINGS.parts[k])
  return {
    conductor: typeof o.conductor === 'string' && conductorOf(o.conductor) ? o.conductor : DEFAULT_SETTINGS.conductor,
    thickness: o.thickness === null || o.thickness === undefined ? null : posOr(o.thickness, 0, 20) || null,
    copper: posOr(o.copper, DEFAULT_SETTINGS.copper, 10),
    keepoutHeight: posOr(o.keepoutHeight, DEFAULT_SETTINGS.keepoutHeight, 200),
    parts: { board: b('board'), copperTop: b('copperTop'), copperBottom: b('copperBottom'), keepouts: b('keepouts') },
  }
}

export const circuitSection: ProjectSection<SavedCircuit> = {
  key: 'circuit',
  collect(ctx) {
    const s = setupOf(useCircuit.getState())
    const empty = !s.loaded && !s.lastBuild && !s.project.folder && !s.made && JSON.stringify(s.settings) === JSON.stringify(DEFAULT_SETTINGS)
    if (empty) return undefined
    if (s.loaded) ctx.addMember(MEMBER, new TextEncoder().encode(s.loaded.text))
    return { version: 1, settings: s.settings, project: s.project, lastBuild: s.lastBuild, made: s.made, loaded: s.loaded ? { name: s.loaded.name, from: s.loaded.from, member: MEMBER } : null }
  },
  members: (v) => (v.loaded ? [v.loaded.member] : []),
  prepare(value, ctx) {
    if (value === undefined) return () => useCircuit.getState().reset()
    const v = value as SavedCircuit
    if (!v || v.version !== 1 || typeof v !== 'object') throw new Error('The Circuit part of the project is not one this ScanRuler reads.')
    const settings = settingsIn(v.settings)
    const project: ProjectRef = { folder: typeof v.project?.folder === 'string' ? v.project.folder : null, entry: typeof v.project?.entry === 'string' ? v.project.entry : null }
    let loaded = null
    if (v.loaded) {
      const bytes = ctx.members.get(v.loaded.member)
      if (!bytes) throw new Error(`The project names ${v.loaded.member}, which is not in it.`)
      const text = new TextDecoder().decode(bytes)
      const board = readCircuitJson(text)
      const pieces = piecesOf(board)
      loaded = { name: String(v.loaded.name ?? 'circuit.json'), from: v.loaded.from && typeof v.loaded.from === 'object' ? v.loaded.from : {}, text, board, stats: statsOf(board, pieces, netsOf(pieces)) }
    }
    const lastBuild = v.lastBuild && typeof v.lastBuild === 'object' && typeof v.lastBuild.job === 'string' ? v.lastBuild : null
    const made = v.made && Array.isArray(v.made.bodies) ? v.made : null
    return () => {
      useCircuit.getState().reset()
      useCircuit.setState({ settings, project, lastBuild, made, loaded })
    }
  },
  hasContent: (v) => !!(v.loaded || v.lastBuild || v.project.folder),
  watch(changed) {
    return useCircuit.subscribe((s, prev) => {
      if (s.settings !== prev.settings || s.project !== prev.project || s.lastBuild !== prev.lastBuild || s.loaded !== prev.loaded || s.made !== prev.made) changed()
    })
  },
}
