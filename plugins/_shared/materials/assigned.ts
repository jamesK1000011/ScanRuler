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
import { isBundledMaterial, libraryMaterial, materialsFor, useMaterialLibrary, type Material } from './index'
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

/** A body's material now, or null when none is set — or when it is a
 *  FreeCAD card not loaded yet: await assignedReady() first. */
export function materialOfBody(body: BodyKey | { id: number } | number): ResolvedMaterial | null {
  const key = typeof body === 'object' ? String(body.id) : String(body)
  return resolveAssignment(useAssigned.getState().assigned[key])
}

/** The library names an assignment needs: its id, or its base. */
function namesOf(a: Assignment | undefined | null): string[] {
  if (a === undefined || a === null) return []
  if (typeof a === 'string') return [a]
  return a.custom.base ? [a.custom.base] : []
}

/** Ready to resolve the bodies' materials (and any other names given): at
 *  once when each is the fork's own, else once FreeCAD's cards are loaded
 *  (../materials materialsFor). A command awaits it before materialOfBody,
 *  so a body of steel is never taken for one with no material. */
export function assignedReady(extra: Iterable<unknown> = []): Promise<void> {
  return materialsFor([...Object.values(useAssigned.getState().assigned).flatMap(namesOf), ...extra])
}

/** Whether assignedReady() has anything to wait for: a body set to a
 *  FreeCAD card not loaded yet. A command that must not yield before it
 *  reads its state (Mass keys a reading by the setup at its start) awaits
 *  only then. */
export function assignedWaiting(): boolean {
  if (useMaterialLibrary.getState().status === 'loaded') return false
  return Object.values(useAssigned.getState().assigned).some((a) => namesOf(a).some((n) => !isBundledMaterial(n)))
}

/** A workspace's commands, each waiting for the bodies' materials before it
 *  runs (assignedReady): for commands that read materialOfBody deep inside. */
export function awaitingMaterials<C extends { run: (...args: never[]) => Promise<unknown> }>(commands: C[]): C[] {
  return commands.map((c) => ({
    ...c,
    run: async (...args: Parameters<C['run']>) => {
      if (assignedWaiting()) await assignedReady()
      return c.run(...args)
    },
  }))
}

// Whenever who has what changes — a project opened, an undo, a set — the
// cards a body now needs start loading, so a readout that cannot wait (a
// setup's tolerance, a panel) has them as soon as may be. A failure stays
// in the library's state; the command that needs them says it.
useAssigned.subscribe((s, was) => {
  if (s.assigned !== was.assigned) assignedReady().catch(() => undefined)
})
