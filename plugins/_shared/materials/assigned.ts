// SPDX-License-Identifier: AGPL-3.0-only
// Which material each body is made of: a property of the part, kept here so
// every workspace reads it alike — Mass weighs a body in it, Strength
// solves in it, Reverse Engineer's body list shows and sets it. The
// material plugin (plugins/material) saves it with the project, answers
// its commands and puts each change in the undo history; a build without
// that plugin has every body unassigned, and each workspace does what it
// did before materials were per part.
//
// Bodies are keyed by their Reverse Engineer id as text (../setups.ts
// bodyKeyOf): a rename leaves it.

import { create } from 'zustand'
import { libraryMaterial, type Material } from './index'
import type { BodyKey } from '../setups'

/** A material of the person's own, or a library one with their figures
 *  over it (base). Units as the library's. */
export interface CustomMaterial {
  name: string
  base?: string
  density?: number
  youngsMPa?: number
  poisson?: number
  yieldMPa?: number
  ultimateMPa?: number
}

/** A body's material: a library id, or one of the person's own. */
export type Assignment = string | { custom: CustomMaterial }

export interface AssignedState {
  /** The material plugin is in the build: assignments are saved and offered. */
  installed: boolean
  assigned: Readonly<Record<BodyKey, Assignment>>
  /** Put materials on bodies (null takes a body's off): one undo step. */
  assign(patch: Readonly<Record<BodyKey, Assignment | null>>): void
  reset(): void
}

export const useAssigned = create<AssignedState>((set) => ({
  installed: false,
  assigned: {},
  assign: (patch) =>
    set((s) => {
      const next: Record<BodyKey, Assignment> = { ...s.assigned }
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k]
        else next[k] = v
      }
      return { assigned: next }
    }),
  reset: () => set({ assigned: {} }),
}))

/** A material as a workspace uses it: the library's entry, or a custom one
 *  made whole over its base. */
export interface ResolvedMaterial extends Omit<Material, 'source'> {
  custom?: true
  source?: Material['source']
}

const CUSTOM_KEYS = ['density', 'youngsMPa', 'poisson', 'yieldMPa', 'ultimateMPa'] as const

/** An assignment resolved, or null for an id the library does not know. */
export function resolveAssignment(a: Assignment | undefined | null): ResolvedMaterial | null {
  if (a === undefined || a === null) return null
  if (typeof a === 'string') return libraryMaterial(a) ?? null
  const c = a.custom
  const base = c.base ? libraryMaterial(c.base) : undefined
  const own: Partial<ResolvedMaterial> = {}
  for (const k of CUSTOM_KEYS) if (typeof c[k] === 'number') own[k] = c[k]
  const { source: _s, machining: _m, ...from } = base ?? ({ category: 'thermoplast' } as Material)
  void _s
  void _m
  return { ...from, ...own, id: 'custom', name: c.name, custom: true, ...(base ? { bulkFrom: base.id } : {}) }
}

/** A body's material now, or null when none is set. */
export function materialOfBody(body: BodyKey | { id: number } | number): ResolvedMaterial | null {
  const key = typeof body === 'object' ? String(body.id) : String(body)
  return resolveAssignment(useAssigned.getState().assigned[key])
}
