// SPDX-License-Identifier: AGPL-3.0-only
// The Hardware workspace's part of a project file: the settings that size
// its holes, and the parts encased in the print — each pocket's top, for
// its pause. Not the plan or the check — read again in a moment — nor the
// cuts, which are Reverse Engineer's features and saved with it.

import type { ProjectSection } from '../../../src/app/projectSections'
import { FITS, type Fit, type Kind, KINDS } from '../core/hardware'
import { DEFAULT_SETTINGS, type Settings } from '../core/plan'
import { type Embed, settingsOf, useHw } from '../state/hwStore'

interface SavedHw {
  version: 1
  settings: Settings
  embeds?: Embed[]
}

const fin = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi

/** What a file holds, taken where it is in range and the default where not. */
export function settingsFrom(u: Record<string, unknown>): Settings {
  const d = DEFAULT_SETTINGS
  const a = u.allowance && typeof u.allowance === 'object' ? (u.allowance as Record<string, unknown>) : {}
  return {
    allowance: Object.fromEntries(KINDS.map((k) => [k, fin(a[k], -1, 2) ? a[k] : d.allowance[k]])) as Record<Kind, number>,
    printerFit: typeof u.printerFit === 'boolean' ? u.printerFit : d.printerFit,
    fit: typeof u.fit === 'string' && (FITS as readonly string[]).includes(u.fit) ? (u.fit as Fit) : d.fit,
    headMargin: fin(u.headMargin, 0, 3) ? u.headMargin : d.headMargin,
    headSink: fin(u.headSink, 0, 5) ? u.headSink : d.headSink,
    teardrop: typeof u.teardrop === 'boolean' ? u.teardrop : d.teardrop,
    bridgeLayer: fin(u.bridgeLayer, 0, 1) ? u.bridgeLayer : d.bridgeLayer,
    insertExtra: fin(u.insertExtra, 0, 5) ? u.insertExtra : d.insertExtra,
    magnetExtra: fin(u.magnetExtra, 0, 3) ? u.magnetExtra : d.magnetExtra,
    roofLayers: Number.isInteger(u.roofLayers) && fin(u.roofLayers, 1, 50) ? u.roofLayers : d.roofLayers,
    layerHeight: fin(u.layerHeight, 0.01, 2) ? u.layerHeight : d.layerHeight,
    firstLayer: fin(u.firstLayer, 0.01, 2) ? u.firstLayer : d.firstLayer,
    bridgeMax: fin(u.bridgeMax, 0, 200) ? u.bridgeMax : d.bridgeMax,
    dropClearance: fin(u.dropClearance, 0, 3) ? u.dropClearance : d.dropClearance,
    dropHeadroom: fin(u.dropHeadroom, 0, 5) ? u.dropHeadroom : d.dropHeadroom,
  }
}

const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length > 0 && x.length <= max

/** The encased parts a file holds: each one whole and in range, or left out. */
export function embedsFrom(u: unknown): Embed[] {
  if (!Array.isArray(u)) return []
  const out: Embed[] = []
  for (const e of u.slice(0, 500) as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object') continue
    if (!text(e.id, 20) || !text(e.body, 200) || !text(e.kind, 20) || !text(e.label, 80) || !text(e.what, 80)) continue
    if (!fin(e.top, -1e5, 1e5) || !fin(e.minRoof, 0, 100) || !fin(e.span, 0, 1e4) || !(Number.isInteger(e.count) && fin(e.count, 1, 10000))) continue
    if (!(e.roof === null || fin(e.roof, 0, 1e4))) continue
    const features = Array.isArray(e.features) ? e.features.filter((f): f is string => text(f, 200)) : []
    if (out.some((x) => x.id === e.id)) continue
    out.push({ id: e.id, body: e.body, kind: e.kind, label: e.label, what: e.what, top: e.top, roof: e.roof as number | null, minRoof: e.minRoof, span: e.span, count: e.count as number, features, ...(text(e.source, 20) ? { source: e.source } : {}), ...(fin(e.bedZ, -1e5, 1e5) ? { bedZ: e.bedZ } : {}) })
  }
  return out
}

export const hwSection: ProjectSection<SavedHw> = {
  key: 'hw',
  collect() {
    const s = settingsOf(useHw.getState())
    const embeds = useHw.getState().embeds
    if (JSON.stringify(s) === JSON.stringify(settingsOf(DEFAULT_SETTINGS)) && embeds.length === 0) return undefined
    return { version: 1, settings: s, ...(embeds.length ? { embeds } : {}) }
  },
  prepare(value) {
    if (value === undefined) return () => useHw.getState().reset()
    const v = value as SavedHw
    if (!v || v.version !== 1 || !v.settings || typeof v.settings !== 'object') throw new Error('The hardware part of the project is not one this ScanRuler reads.')
    const settings = settingsFrom(v.settings as unknown as Record<string, unknown>)
    const embeds = embedsFrom(v.embeds)
    return () => {
      useHw.getState().reset()
      useHw.getState().set(settings)
      useHw.getState().setEmbeds(embeds)
    }
  },
  hasContent: () => true,
  watch(changed) {
    const keys = ['allowance', 'printerFit', 'fit', 'headMargin', 'headSink', 'teardrop', 'bridgeLayer', 'insertExtra', 'magnetExtra', 'roofLayers', 'layerHeight', 'firstLayer', 'bridgeMax', 'dropClearance', 'dropHeadroom', 'embeds'] as const
    return useHw.subscribe((s, prev) => {
      if (keys.some((k) => s[k] !== prev[k])) changed()
    })
  },
}
