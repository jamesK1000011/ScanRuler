// SPDX-License-Identifier: AGPL-3.0-only
// The Mass workspace's part of a project file: how the part is printed,
// the calibration and the target. Not the reading — weighed again in a
// moment.

import type { ProjectSection } from '../../../src/app/projectSections'
import { FILLERS, MATERIALS, type V3 } from '../core/mass'
import { DEFAULT_MASS, setupOf, useMass, type MassSetup } from '../state/massStore'

interface SavedMass {
  version: 1
  setup: MassSetup
}

const fin = (x: unknown, lo: number, hi: number) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi
const vec = (v: unknown): v is V3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))

export const massSection: ProjectSection<SavedMass> = {
  key: 'mass',
  collect() {
    const s = setupOf(useMass.getState())
    return JSON.stringify(s) === JSON.stringify(setupOf(DEFAULT_MASS)) ? undefined : { version: 1, setup: s }
  },
  prepare(value) {
    if (value === undefined) return () => useMass.getState().reset()
    const v = value as SavedMass
    if (!v || v.version !== 1 || !v.setup || typeof v.setup !== 'object') throw new Error('The mass part of the project is not one this ScanRuler reads.')
    const u = v.setup as unknown as Record<string, unknown>
    const t = u.target && typeof u.target === 'object' ? (u.target as Record<string, unknown>) : null
    const setup: MassSetup = {
      material: typeof u.material === 'string' && u.material in MATERIALS ? u.material : DEFAULT_MASS.material,
      ...(fin(u.density, 0.01, 25) ? { density: u.density as number } : {}),
      infill: fin(u.infill, 0, 100) ? (u.infill as number) : DEFAULT_MASS.infill,
      walls: fin(u.walls, 0, 50) ? Math.round(u.walls as number) : DEFAULT_MASS.walls,
      lineMm: fin(u.lineMm, 0.05, 3) ? (u.lineMm as number) : DEFAULT_MASS.lineMm,
      scale: fin(u.scale, 0.2, 5) ? (u.scale as number) : 1,
      target: t && (fin(t.mass, 1e-6, 1e9) || vec(t.com)) ? { ...(fin(t.mass, 1e-6, 1e9) ? { mass: t.mass as number } : {}), ...(vec(t.com) ? { com: t.com } : {}) } : null,
      filler: typeof u.filler === 'string' && u.filler in FILLERS ? u.filler : DEFAULT_MASS.filler,
    }
    return () => {
      useMass.getState().reset()
      useMass.getState().set(setup)
    }
  },
  hasContent: (v) => v.setup.target !== null || v.setup.scale !== 1,
  watch(changed) {
    const keys = ['material', 'density', 'infill', 'walls', 'lineMm', 'scale', 'target', 'filler'] as const
    return useMass.subscribe((s, prev) => {
      if (keys.some((k) => s[k] !== prev[k])) changed()
    })
  },
}
