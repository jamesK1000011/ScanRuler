// SPDX-License-Identifier: AGPL-3.0-only
// The Fits workspace's part of a project file: the settings, the
// calibration, the panel's page and the values each tool was last given.
// The parts made are Reverse Engineer's Import features, saved with it.

import type { ProjectSection } from '../../../src/app/projectSections'
import { CLASSES, DEFAULT_CALIBRATION, type Calibration, type ClassOverride, type FitClass } from '../core/fits'
import { materialOf } from '../core/snap'
import { DEFAULT_SETTINGS, savedOf, TOOLS, useFits, type FitsSaved, type Inputs, type Tool } from '../state/fitsStore'

interface SavedFits {
  version: 1
  fits: FitsSaved
}

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
const objOf = (u: unknown): Record<string, unknown> => (u && typeof u === 'object' && !Array.isArray(u) ? (u as Record<string, unknown>) : {})

/** What of a saved part still reads: values this version does not take
 *  fall back to the defaults, not refused. */
export function savedIn(u: unknown): FitsSaved {
  const o = objOf(u)
  const s = objOf(o.settings)
  const classes: Partial<Record<FitClass, ClassOverride>> = {}
  for (const [k, v] of Object.entries(objOf(s.classes))) {
    const c = objOf(v)
    if ((CLASSES as readonly string[]).includes(k) && isNum(c.clearance, -2, 5) && isNum(c.at, 0.5, 500)) classes[k as FitClass] = { clearance: c.clearance, at: c.at }
  }
  const c = objOf(o.calibration)
  const calOk = isNum(c.hole, -1, 2) && isNum(c.shaft, -1, 2)
  const calibration: Calibration = calOk
    ? { hole: c.hole as number, shaft: c.shaft as number, source: (['default', 'entered', 'measured', 'print-fit'] as const).find((x) => x === c.source) ?? 'entered', ...(isNum(c.n, 1, 1e4) ? { n: c.n } : {}), ...(isNum(c.spread, 0, 10) ? { spread: c.spread } : {}), ...(typeof c.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.at) ? { at: c.at } : {}), ...(typeof c.profile === 'string' && c.profile.trim() ? { profile: c.profile.trim().slice(0, 80) } : {}) }
    : { ...DEFAULT_CALIBRATION }
  const inputs: Inputs = {}
  for (const [k, v] of Object.entries(objOf(o.inputs))) if ((TOOLS as readonly string[]).includes(k) && v && typeof v === 'object') inputs[k as Tool] = v as Record<string, unknown>
  return {
    settings: {
      tolerance: isNum(s.tolerance, 0.005, 2) ? s.tolerance : DEFAULT_SETTINGS.tolerance,
      material: (typeof s.material === 'string' && materialOf(s.material)?.id) || DEFAULT_SETTINGS.material,
      classes,
    },
    calibration,
    tool: (TOOLS as readonly string[]).includes(o.tool as string) ? (o.tool as Tool) : 'pair',
    inputs,
  }
}

const DEFAULT_SAVED: FitsSaved = { settings: DEFAULT_SETTINGS, calibration: DEFAULT_CALIBRATION, tool: 'pair', inputs: {} }

export const fitsSection: ProjectSection<SavedFits> = {
  key: 'fits',
  collect() {
    const s = savedOf(useFits.getState())
    return JSON.stringify(s) === JSON.stringify(DEFAULT_SAVED) ? undefined : { version: 1, fits: s }
  },
  prepare(value) {
    if (value === undefined) return () => useFits.getState().reset()
    const v = value as SavedFits
    if (!v || v.version !== 1 || !v.fits || typeof v.fits !== 'object') throw new Error('The Fits part of the project is not one this ScanRuler reads.')
    const saved = savedIn(v.fits)
    return () => {
      useFits.getState().reset()
      useFits.setState(saved)
    }
  },
  hasContent: (v) => JSON.stringify(v.fits.settings) !== JSON.stringify(DEFAULT_SETTINGS) || v.fits.calibration.source !== 'default',
  watch(changed) {
    return useFits.subscribe((s, prev) => {
      if (s.settings !== prev.settings || s.calibration !== prev.calibration || s.tool !== prev.tool || s.inputs !== prev.inputs) changed()
    })
  },
}
