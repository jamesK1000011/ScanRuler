// SPDX-License-Identifier: AGPL-3.0-only
// The Generate workspace's part of a project file: the generator picked and
// the values set. The parts made are Reverse Engineer's Import features,
// saved with it.

import type { ProjectSection } from '../../../src/app/projectSections'
import { generatorOf, valuesOf, type Value } from '../core/generators'
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
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      try {
        valuesOf(g, { [k]: v }, { ...g.defaults, ...kept })
        kept[k] = v as Value
      } catch {
        // Dropped: a value this version does not take.
      }
    }
    try {
      valuesOf(g, kept)
    } catch {
      continue
    }
    if (Object.keys(kept).length) values[id] = kept
  }
  return { generator, values }
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
  hasContent: (v) => Object.keys(v.setup.values ?? {}).length > 0,
  watch(changed) {
    return useGen.subscribe((s, prev) => {
      if (s.generator !== prev.generator || s.values !== prev.values) changed()
    })
  },
}
