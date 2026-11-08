// SPDX-License-Identifier: AGPL-3.0-only
// The FEA study's part of a project file: the study set up. Not its
// answer — solved again in seconds, and a mesh's worth of numbers.

import type { ProjectSection } from '../../../src/app/projectSections'
import { DEFAULT_SETUP, setupOf, useFea, type FeaSetup } from '../state/feaStore'

interface SavedFea {
  version: 1
  setup: FeaSetup
}

const isVec = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
const isPick = (p: Record<string, unknown>) => (Array.isArray(p.faces) && p.faces.every((x) => Number.isInteger(x) && x >= 0)) || (Boolean(p.where) && typeof p.where === 'object')

export const feaSection: ProjectSection<SavedFea> = {
  key: 'fea',
  collect() {
    const s = setupOf(useFea.getState())
    if (JSON.stringify(s) === JSON.stringify(DEFAULT_SETUP)) return undefined
    return { version: 1, setup: s }
  },
  prepare(value) {
    if (value === undefined) return () => useFea.getState().reset()
    const v = value as SavedFea
    if (!v || v.version !== 1 || !v.setup || typeof v.setup !== 'object') throw new Error('The FEA part of the project is not one this ScanRuler reads.')
    const u = v.setup as unknown as Record<string, unknown>
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string' && isPick(p as Record<string, unknown>)) : [])
    const setup: FeaSetup = {
      ...DEFAULT_SETUP,
      body: typeof u.body === 'string' ? u.body : null,
      build: isVec(u.build) ? u.build : DEFAULT_SETUP.build,
      material: typeof u.material === 'string' ? u.material : DEFAULT_SETUP.material,
      overrides: u.overrides && typeof u.overrides === 'object' ? Object.fromEntries(Object.entries(u.overrides).filter(([, x]) => typeof x === 'number' && Number.isFinite(x))) : {},
      holds: list(u.holds).map((p) => ({ name: String(p.name), ...(p.faces ? { faces: p.faces as number[] } : { where: p.where as Record<string, unknown> }) })),
      loads: list(u.loads)
        .filter((p) => isVec(p.force) || (typeof p.pressure === 'number' && Number.isFinite(p.pressure)))
        .map((p) => ({ name: String(p.name), ...(p.faces ? { faces: p.faces as number[] } : { where: p.where as Record<string, unknown> }), ...(isVec(p.force) ? { force: p.force } : { pressure: p.pressure as number }) })),
      fineness: u.fineness === 'coarse' || u.fineness === 'fine' ? u.fineness : 'medium',
      ...(typeof u.size === 'number' && u.size > 0 ? { size: u.size } : {}),
      target: typeof u.target === 'number' && u.target > 0 ? u.target : DEFAULT_SETUP.target,
    }
    return () => {
      useFea.getState().reset()
      useFea.getState().set(setup)
    }
  },
  hasContent: (v) => Boolean(v.setup.body) || v.setup.holds.length > 0 || v.setup.loads.length > 0,
  watch(changed) {
    const keys = ['body', 'build', 'material', 'overrides', 'holds', 'loads', 'fineness', 'size', 'target'] as const
    return useFea.subscribe((s, prev) => {
      if (keys.some((k) => s[k] !== prev[k])) changed()
    })
  },
}
