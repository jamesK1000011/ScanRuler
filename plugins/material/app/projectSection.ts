// SPDX-License-Identifier: AGPL-3.0-only
// Materials' part of a project file, under `materials`: each body's, by its
// Reverse Engineer id — a library id, or { custom } for one of the
// person's own. An id this build's library does not know is kept as it
// was, and reads as unknown, so a project passed through an older build
// loses nothing.

import type { ProjectSection } from '../../../src/app/projectSections'
import { useAssigned, type Assignment } from '../../_shared/materials/assigned'

interface SavedMaterials {
  version: 1
  bodies: Record<string, Assignment>
}

const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x)

function assignmentOf(v: unknown): Assignment | null {
  if (typeof v === 'string' && v.trim() && v.length <= 120) return v
  const c = v && typeof v === 'object' ? (v as { custom?: Record<string, unknown> }).custom : undefined
  if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name.trim()) return null
  const out: Record<string, unknown> = { name: c.name.slice(0, 80) }
  if (typeof c.base === 'string') out.base = c.base
  for (const k of ['density', 'youngsMPa', 'poisson', 'yieldMPa', 'ultimateMPa']) if (num(c[k])) out[k] = c[k]
  return { custom: out as { name: string } }
}

export const materialsSection: ProjectSection<SavedMaterials> = {
  key: 'materials',
  collect() {
    const bodies = useAssigned.getState().assigned
    return Object.keys(bodies).length ? { version: 1, bodies: { ...bodies } } : undefined
  },
  prepare(value) {
    if (value === undefined) return () => useAssigned.getState().reset()
    const v = value as SavedMaterials
    if (!v || v.version !== 1 || !v.bodies || typeof v.bodies !== 'object') throw new Error('The materials part of the project is not one this ScanRuler reads.')
    const bodies: Record<string, Assignment> = {}
    for (const [k, a] of Object.entries(v.bodies)) {
      if (!/^\d+$/.test(k)) throw new Error(`The materials part of the project names a body "${k}": not a body's id.`)
      const read = assignmentOf(a)
      if (!read) throw new Error(`The material of body ${k} in the project does not read.`)
      bodies[k] = read
    }
    return () => useAssigned.setState({ assigned: bodies })
  },
  hasContent: (v) => Object.keys(v.bodies).length > 0,
  watch(changed) {
    return useAssigned.subscribe((s, prev) => {
      if (s.assigned !== prev.assigned) changed()
    })
  },
}
