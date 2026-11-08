// SPDX-License-Identifier: AGPL-3.0-only
// The Hardware workspace's part of a project file: the settings that size
// its holes. Not the plan or the check — read again in a moment — nor the
// cuts, which are Reverse Engineer's features and saved with it.

import type { ProjectSection } from '../../../src/app/projectSections'
import { FITS, type Fit, type Kind, KINDS } from '../core/hardware'
import { DEFAULT_SETTINGS, type Settings } from '../core/plan'
import { settingsOf, useHw } from '../state/hwStore'

interface SavedHw {
  version: 1
  settings: Settings
}

const fin = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi

/** What a file holds, taken where it is in range and the default where not. */
export function settingsFrom(u: Record<string, unknown>): Settings {
  const d = DEFAULT_SETTINGS
  const a = u.allowance && typeof u.allowance === 'object' ? (u.allowance as Record<string, unknown>) : {}
  return {
    allowance: Object.fromEntries(KINDS.map((k) => [k, fin(a[k], -1, 2) ? a[k] : d.allowance[k]])) as Record<Kind, number>,
    fit: typeof u.fit === 'string' && (FITS as readonly string[]).includes(u.fit) ? (u.fit as Fit) : d.fit,
    headMargin: fin(u.headMargin, 0, 3) ? u.headMargin : d.headMargin,
    headSink: fin(u.headSink, 0, 5) ? u.headSink : d.headSink,
    teardrop: typeof u.teardrop === 'boolean' ? u.teardrop : d.teardrop,
    bridgeLayer: fin(u.bridgeLayer, 0, 1) ? u.bridgeLayer : d.bridgeLayer,
    insertExtra: fin(u.insertExtra, 0, 5) ? u.insertExtra : d.insertExtra,
    magnetExtra: fin(u.magnetExtra, 0, 3) ? u.magnetExtra : d.magnetExtra,
  }
}

export const hwSection: ProjectSection<SavedHw> = {
  key: 'hw',
  collect() {
    const s = settingsOf(useHw.getState())
    return JSON.stringify(s) === JSON.stringify(settingsOf(DEFAULT_SETTINGS)) ? undefined : { version: 1, settings: s }
  },
  prepare(value) {
    if (value === undefined) return () => useHw.getState().reset()
    const v = value as SavedHw
    if (!v || v.version !== 1 || !v.settings || typeof v.settings !== 'object') throw new Error('The hardware part of the project is not one this ScanRuler reads.')
    const settings = settingsFrom(v.settings as unknown as Record<string, unknown>)
    return () => {
      useHw.getState().reset()
      useHw.getState().set(settings)
    }
  },
  hasContent: () => true,
  watch(changed) {
    const keys = ['allowance', 'fit', 'headMargin', 'headSink', 'teardrop', 'bridgeLayer', 'insertExtra', 'magnetExtra'] as const
    return useHw.subscribe((s, prev) => {
      if (keys.some((k) => s[k] !== prev[k])) changed()
    })
  },
}
