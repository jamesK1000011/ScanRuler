// SPDX-License-Identifier: AGPL-3.0-only
// Setups, read: how each part is made. A setup is a process — print, cut,
// mill, a board — and the bodies it makes; a body's material is its own
// (materials/), the setup says what the process does to it. The project
// keeps them in its `setups` section, an array of
//   { id, type: 'print' | 'cut' | 'mill' | 'pcb', name, bodies: BodyKey[], …the type's settings }
// The workspace that edits them owns that section and reports it as the
// session readout's `setups` part (an array, or { setups: [...] }); this is
// the reader every other workspace shares, so a build without setups reads
// none and every body as made by no process.
//
// A body is keyed by its Reverse Engineer id as text — the id of the
// feature that made it, which a rename leaves alone.

import { readStateSection } from '../../src/commands/stateSections'

export type SetupType = 'print' | 'cut' | 'mill' | 'pcb'

/** A body's key: its Reverse Engineer id, as text. */
export type BodyKey = string

export interface Setup {
  id: string
  type: SetupType
  name: string
  bodies: BodyKey[]
  [setting: string]: unknown
}

export const bodyKeyOf = (body: { id: number } | number | string): BodyKey => String(typeof body === 'object' ? body.id : body)

const isSetup = (x: unknown): x is Setup => {
  const s = x as Partial<Setup> | null
  return !!s && typeof s === 'object' && typeof s.id === 'string' && typeof s.type === 'string' && Array.isArray(s.bodies)
}

/** The setups in a state — the `setups` section as saved, the readout's
 *  part, or { setups } around either — or, given nothing, the session's
 *  now. Malformed entries are left out; bodies always as keys. */
export function setupsOf(state?: unknown): Setup[] {
  const raw = state === undefined ? readStateSection('setups') : state
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { setups?: unknown }).setups) ? (raw as { setups: unknown[] }).setups : []
  return list.filter(isSetup).map((s) => ({ ...s, bodies: s.bodies.map((b) => bodyKeyOf(b as unknown as string)) }))
}

/** The setup a body is made in, or null. A body in more than one (it
 *  should not be) is taken by the first. */
export function setupFor(body: BodyKey | { id: number } | number, state?: unknown): Setup | null {
  const key = bodyKeyOf(body)
  return setupsOf(state).find((s) => s.bodies.includes(key)) ?? null
}

/** Whether a body is printed: in a print setup. */
export const isPrinted = (body: BodyKey | { id: number } | number, state?: unknown): boolean => setupFor(body, state)?.type === 'print'
