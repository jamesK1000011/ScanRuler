// SPDX-License-Identifier: AGPL-3.0-only
// The Boards workspace's part of a project file: the board file's path,
// what was read of it, what its import measured, and the settings — so an
// enclosure can be made again without KiCad. The bodies themselves are
// Reverse Engineer's, saved with it.

import type { ProjectSection } from '../../../src/app/projectSections'
import { boardIn, boxesIn, type KicadBoard } from '../core/boardSpec'
import { DEFAULT_PCB, setupOf, usePcb, type Imported, type PcbSetup } from '../state/pcbStore'

type Saved = ReturnType<typeof setupOf>

interface SavedPcb {
  version: 1
  setup: Saved
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** What of a saved section still reads: a part that does not is dropped,
 *  not refused. */
export function setupIn(u: unknown): Saved {
  const o = u && typeof u === 'object' ? (u as Record<string, unknown>) : {}
  const enclosure: Record<string, number | boolean> = {}
  if (o.enclosure && typeof o.enclosure === 'object') for (const [k, v] of Object.entries(o.enclosure as Record<string, unknown>)) if (Object.hasOwn(o.enclosure as object, k) && /^[a-z]\w{0,30}$/i.test(k) && (fin(v) || typeof v === 'boolean')) enclosure[k] = v
  let board: KicadBoard | null = null
  try {
    board = o.board ? boardIn(o.board) : null
  } catch {
    board = null
  }
  let imported: Imported | null = null
  const i = o.imported as Imported | undefined
  if (i && typeof i === 'object' && fin(i.above) && fin(i.below) && Array.isArray(i.offset) && i.offset.length === 3 && i.offset.every(fin) && i.boxes && typeof i.boxes === 'object') {
    imported = { at: String(i.at ?? ''), body: typeof i.body === 'string' ? i.body : null, bodies: fin(i.bodies) ? i.bodies : 0, components: i.components !== false, above: i.above, below: i.below, offset: i.offset as [number, number, number], boxes: boxesIn(i.boxes), kicad: typeof i.kicad === 'string' ? i.kicad : null, warnings: Array.isArray(i.warnings) ? i.warnings.filter((w) => typeof w === 'string').slice(0, 30) : [] }
  }
  const made = o.enclosureMade as { at?: unknown; bodies?: unknown } | undefined
  return {
    path: typeof o.path === 'string' ? o.path : DEFAULT_PCB.path,
    components: typeof o.components === 'boolean' ? o.components : DEFAULT_PCB.components,
    subst: typeof o.subst === 'boolean' ? o.subst : DEFAULT_PCB.subst,
    naming: o.naming === 'kicad' ? 'kicad' : 'fab',
    enclosure,
    above: fin(o.above) && o.above >= 0 ? o.above : null,
    below: fin(o.below) && o.below >= 0 ? o.below : null,
    skip: Array.isArray(o.skip) ? o.skip.filter((x): x is string => typeof x === 'string').slice(0, 64) : [],
    board,
    imported: board ? imported : null,
    enclosureMade: made && Array.isArray(made.bodies) ? { at: String(made.at ?? ''), bodies: made.bodies.filter((b): b is string => typeof b === 'string') } : null,
  }
}

const isDefault = (s: Saved) => !s.board && JSON.stringify({ ...s, board: undefined, imported: undefined, enclosureMade: undefined }) === JSON.stringify({ ...DEFAULT_PCB, board: undefined, imported: undefined, enclosureMade: undefined })

export const pcbSection: ProjectSection<SavedPcb> = {
  key: 'pcb',
  collect() {
    const s = setupOf(usePcb.getState())
    return isDefault(s) ? undefined : { version: 1, setup: s }
  },
  prepare(value) {
    if (value === undefined) return () => usePcb.getState().reset()
    const v = value as SavedPcb
    if (!v || v.version !== 1 || !v.setup || typeof v.setup !== 'object') throw new Error('The Boards part of the project is not one this ScanRuler reads.')
    const setup = setupIn(v.setup)
    return () => {
      usePcb.getState().reset()
      usePcb.getState().set(setup as Partial<PcbSetup>)
    }
  },
  hasContent: (v) => !!v.setup.board || !!v.setup.path,
  watch(changed) {
    return usePcb.subscribe((s, p) => {
      if (s.path !== p.path || s.board !== p.board || s.imported !== p.imported || s.enclosure !== p.enclosure || s.components !== p.components || s.subst !== p.subst || s.naming !== p.naming || s.above !== p.above || s.below !== p.below || s.skip !== p.skip || s.enclosureMade !== p.enclosureMade) changed()
    })
  },
}
