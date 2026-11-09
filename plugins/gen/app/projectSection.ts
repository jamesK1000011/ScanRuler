// SPDX-License-Identifier: AGPL-3.0-only
// The Generate workspace's part of a project file: the generator picked and
// the values set. The parts made are Reverse Engineer's Import features,
// saved with it.

import type { ProjectSection } from '../../../src/app/projectSections'
import { generatorOf, valuesOf, type Value } from '../core/generators'
import { boardIn, type BoardSpec } from '../core/boardBox'
import { DEFAULT_GEN, setupOf, useGen, type GenSetup } from '../state/genStore'

interface SavedGen {
  version: 1
  setup: GenSetup
}

/** What of a saved setup still reads: unknown generators and values that
 *  no longer check are dropped, not refused. */
export function setupIn(u: unknown): GenSetup {
  const o = u && typeof u === 'object' ? (u as Record<string, unknown>) : {}
  const generator = typeof o.generator === 'string' && generatorOf(o.generator) ? o.generator : DEFAULT_GEN.generator
  const values: Record<string, Record<string, Value>> = {}
  const vs = o.values && typeof o.values === 'object' ? (o.values as Record<string, unknown>) : {}
  for (const [id, raw] of Object.entries(vs)) {
    const g = Object.hasOwn(vs, id) ? generatorOf(id) : undefined
    if (!g || !raw || typeof raw !== 'object') continue
    const kept: Record<string, Value> = {}
    // Each value against those kept so far, round again while one more is
    // kept: a value that needs another first (a floor a taller bin allows)
    // is kept wherever it stands.
    const entries = Object.entries(raw as Record<string, unknown>)
    for (let more = true; more; ) {
      more = false
      for (const [k, v] of entries) {
        if (Object.hasOwn(kept, k)) continue
        try {
          valuesOf(g, { [k]: v }, { ...g.defaults, ...kept })
          kept[k] = v as Value
          more = true
        } catch {
          // Dropped, unless a later round keeps it: a value this version does not take.
        }
      }
    }
    try {
      valuesOf(g, kept)
    } catch {
      continue
    }
    if (Object.keys(kept).length) values[id] = kept
  }
  let board: BoardSpec | null = null
  try {
    board = o.board ? boardIn(o.board) : null
  } catch {
    // A board this version does not read: dropped, the values kept.
  }
  return { generator, values, board, printerFit: typeof o.printerFit === 'boolean' ? o.printerFit : DEFAULT_GEN.printerFit }
}

export const genSection: ProjectSection<SavedGen> = {
  key: 'gen',
  collect() {
    const s = setupOf(useGen.getState())
    return JSON.stringify(s) === JSON.stringify(DEFAULT_GEN) ? undefined : { version: 1, setup: s }
  },
  prepare(value) {
    if (value === undefined) return () => useGen.getState().reset()
    const v = value as SavedGen
    if (!v || v.version !== 1 || !v.setup || typeof v.setup !== 'object') throw new Error('The Generate part of the project is not one this ScanRuler reads.')
    const setup = setupIn(v.setup)
    return () => {
      useGen.getState().reset()
      useGen.getState().set(setup)
    }
  },
  hasContent: (v) => Object.keys(v.setup.values ?? {}).length > 0 || !!v.setup.board,
  watch(changed) {
    return useGen.subscribe((s, prev) => {
      if (s.generator !== prev.generator || s.values !== prev.values || s.board !== prev.board || s.printerFit !== prev.printerFit) changed()
    })
  },
}
