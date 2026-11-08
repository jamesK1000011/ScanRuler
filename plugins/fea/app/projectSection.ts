// SPDX-License-Identifier: AGPL-3.0-only
// The FEA study's part of a project file: the study set up. Not its
// answer — solved again in seconds, and a mesh's worth of numbers.

import type { ProjectSection } from '../../../src/app/projectSections'
import { MATERIAL_IDS } from './feaCommands'
import { DEFAULT_SETUP, setupOf, useFea, type FacePick, type FeaSetup } from '../state/feaStore'

interface SavedFea {
  version: 1
  setup: FeaSetup
}

const isVec = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
const OVERRIDE_KEYS = ['Exy', 'Ez', 'nuXY', 'nuZ', 'Gxy', 'Gz', 'Xt', 'Xc', 'Zt', 'Zc', 'S', 'Sz']

/** A pick as a file holds it, cleaned: indices that are indices, or a
 *  query; the triangles kept only whole and finite. Null when neither. */
function pickIn(p: Record<string, unknown>): FacePick | null {
  const faces = Array.isArray(p.faces) && p.faces.length > 0 && p.faces.every((x) => Number.isInteger(x) && (x as number) >= 0) ? (p.faces as number[]) : null
  const where = !faces && p.where && typeof p.where === 'object' && !Array.isArray(p.where) ? (p.where as Record<string, unknown>) : null
  if (!faces && !where) return null
  const tris = Array.isArray(p.triangles) && p.triangles.length % 9 === 0 && p.triangles.length <= 9 * 200_000 && p.triangles.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (p.triangles as number[]) : undefined
  return { ...(faces ? { faces } : { where: where! }), ...(faces && tris ? { triangles: tris } : {}), ...(typeof p.bodyKey === 'string' ? { bodyKey: p.bodyKey } : {}), ...(Number.isInteger(p.count) ? { count: p.count as number } : {}) }
}

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
    const named = (x: unknown) => {
      const seen = new Set<string>()
      return (Array.isArray(x) ? x : []).filter((p): p is Record<string, unknown> => {
        if (!p || typeof p !== 'object' || typeof (p as { name?: unknown }).name !== 'string') return false
        const n = (p as { name: string }).name
        if (seen.has(n)) return false
        seen.add(n)
        return true
      })
    }
    const holds = named(u.holds).flatMap((p) => {
      const pick = pickIn(p)
      return pick ? [{ name: String(p.name), ...pick }] : []
    })
    const loads = named(u.loads).flatMap((p) => {
      const pick = pickIn(p)
      const force = isVec(p.force) && p.force.some((x) => x !== 0) ? p.force : null
      const pressure = typeof p.pressure === 'number' && Number.isFinite(p.pressure) && p.pressure !== 0 ? p.pressure : null
      return pick && (force || pressure !== null) ? [{ name: String(p.name), ...pick, ...(force ? { force } : { pressure: pressure! }) }] : []
    })
    const setup: FeaSetup = {
      ...DEFAULT_SETUP,
      body: typeof u.body === 'string' ? u.body : null,
      build: isVec(u.build) && u.build.some((x) => x !== 0) ? u.build : DEFAULT_SETUP.build,
      material: typeof u.material === 'string' && (MATERIAL_IDS as readonly string[]).includes(u.material) ? u.material : DEFAULT_SETUP.material,
      overrides:
        u.overrides && typeof u.overrides === 'object' && !Array.isArray(u.overrides)
          ? Object.fromEntries(Object.entries(u.overrides).filter(([k, x]) => OVERRIDE_KEYS.includes(k) && typeof x === 'number' && Number.isFinite(x) && (k.startsWith('nu') ? x > -1 && x < 0.5 : x > 0)))
          : {},
      holds,
      loads,
      fineness: u.fineness === 'coarse' || u.fineness === 'fine' ? u.fineness : 'medium',
      ...(typeof u.size === 'number' && u.size >= 0.05 ? { size: u.size } : {}),
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
