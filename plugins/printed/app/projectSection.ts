// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › Printed wiring's part of a project file: the settings,
// and the circuits made — which body is the traces, the features, each
// net's resistance, a channel's pause. Not the plan, planned again in a
// moment; the solids themselves are Reverse Engineer's features, saved
// with it.

import type { ProjectSection } from '../../../src/app/projectSections'
import { MATERIALS } from '../core/materials'
import { DEFAULT_SETTINGS, type Settings } from '../core/plan'
import { type Made, settingsOf, usePrinted } from '../state/printedStore'

interface SavedPrinted {
  version: 1
  settings: Settings
  made?: Made[]
}

const fin = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi
const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max

/** What a file holds, taken where it is in range and the default where not. */
export function settingsFrom(u: Record<string, unknown>): Settings {
  const d = DEFAULT_SETTINGS
  const ids = [...MATERIALS.map((m) => m.id), 'custom']
  return {
    material: typeof u.material === 'string' && ids.includes(u.material) ? u.material : d.material,
    along: fin(u.along, 1e-9, 1e9) ? u.along : d.along,
    through: u.through === null ? null : fin(u.through, 1e-9, 1e9) ? u.through : d.through,
    nozzle: fin(u.nozzle, 0.1, 2) ? u.nozzle : d.nozzle,
    layerHeight: fin(u.layerHeight, 0.01, 2) ? u.layerHeight : d.layerHeight,
    clearance: fin(u.clearance, 0, 50) ? u.clearance : d.clearance,
    width: fin(u.width, 0.05, 100) ? u.width : d.width,
    thickness: fin(u.thickness, 0.01, 50) ? u.thickness : d.thickness,
    depth: fin(u.depth, -50, 100) ? u.depth : d.depth,
    current: fin(u.current, 0, 1000) ? u.current : d.current,
    heatWarn: fin(u.heatWarn, 0, 1e6) ? u.heatWarn : d.heatWarn,
    copper: fin(u.copper, 1e-9, 1e-6) ? u.copper : d.copper,
    wireClearance: fin(u.wireClearance, 0, 5) ? u.wireClearance : d.wireClearance,
    tapeClearance: fin(u.tapeClearance, 0, 5) ? u.tapeClearance : d.tapeClearance,
    roofLayers: Number.isInteger(u.roofLayers) && fin(u.roofLayers, 1, 50) ? u.roofLayers : d.roofLayers,
  }
}

/** The circuits a file holds: each whole and in range, or left out. */
export function madeFrom(u: unknown): Made[] {
  if (!Array.isArray(u)) return []
  const out: Made[] = []
  for (const m of u.slice(0, 500) as Record<string, unknown>[]) {
    if (!m || typeof m !== 'object') continue
    if (!text(m.id, 20) || !text(m.body, 200) || (m.method !== 'trace' && m.method !== 'channel')) continue
    if (out.some((x) => x.id === m.id)) continue
    const features = Array.isArray(m.features) ? m.features.filter((f): f is string => text(f, 200)) : []
    const nets = Array.isArray(m.nets) ? (m.nets as Record<string, unknown>[]).filter((n) => n && text(n.name, 200) && fin(n.resistance, 0, 1e15)).map((n) => ({ name: n.name as string, resistance: n.resistance as number })) : []
    const p = m.pause as Record<string, unknown> | undefined
    const pause = p && fin(p.top, -1e5, 1e5) && text(p.what, 80) ? { top: p.top, what: p.what, recorded: p.recorded === true } : undefined
    out.push({ id: m.id, method: m.method, body: m.body, ...(text(m.traces, 200) ? { traces: m.traces } : {}), ...(text(m.filament, 200) ? { filament: m.filament } : {}), features, nets, ...(pause ? { pause } : {}) })
  }
  return out
}

export const printedSection: ProjectSection<SavedPrinted> = {
  key: 'printed',
  collect() {
    const s = settingsOf(usePrinted.getState())
    const made = usePrinted.getState().made
    if (JSON.stringify(s) === JSON.stringify(settingsOf(DEFAULT_SETTINGS)) && made.length === 0) return undefined
    return { version: 1, settings: s, ...(made.length ? { made } : {}) }
  },
  prepare(value) {
    if (value === undefined) return () => usePrinted.getState().reset()
    const v = value as SavedPrinted
    if (!v || v.version !== 1 || !v.settings || typeof v.settings !== 'object') throw new Error('The printed-circuits part of the project is not one this ScanRuler reads.')
    const settings = settingsFrom(v.settings as unknown as Record<string, unknown>)
    const made = madeFrom(v.made)
    return () => {
      usePrinted.getState().reset()
      usePrinted.getState().set(settings)
      usePrinted.getState().setMade(made)
    }
  },
  hasContent: () => true,
  watch(changed) {
    const keys = ['material', 'along', 'through', 'nozzle', 'layerHeight', 'clearance', 'width', 'thickness', 'depth', 'current', 'heatWarn', 'copper', 'wireClearance', 'tapeClearance', 'roofLayers', 'made'] as const
    return usePrinted.subscribe((s, prev) => {
      if (keys.some((k) => s[k] !== prev[k])) changed()
    })
  },
}
