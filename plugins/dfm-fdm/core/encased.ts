// SPDX-License-Identifier: AGPL-3.0-only
// A closed cavity that is meant: the pocket of a part encased at a print
// pause — a magnet, a nut, a bearing — which the Hardware workspace keeps
// (hw.embed cuts it, hw.record records one cut elsewhere, as Generate's
// Gridfinity magnets are). It prints closed on purpose and is filled by the
// part dropped in at the pause, so it is no trapped volume to fix: told
// apart by where it is, the cavity's middle within the part's reach of one
// of its centres.

import type { Finding } from './checks'

/** An encased part as hw.masses gives it: its id (E1 …), what it is, and
 *  each copy's centre and furthest point from it, mm, in the part's frame. */
export interface EncasedPart {
  id: string
  what: string
  count?: number
  centres: [number, number, number][]
  reach: number
}

/** How far past the part's reach a cavity's middle may lie, mm: the pocket
 *  is the part and its clearance, and the part rests at its low end. */
export const ENCASED_SLACK_MM = 1

const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d

/** The encased part whose pocket a cavity at `at` is, or null. */
export function pocketOf(at: readonly number[], parts: readonly EncasedPart[]): EncasedPart | null {
  let best: { part: EncasedPart; d: number } | null = null
  for (const part of parts) {
    const reach = (Number.isFinite(part.reach) && part.reach > 0 ? part.reach : 0) + ENCASED_SLACK_MM
    for (const c of part.centres) {
      const d = Math.hypot(at[0] - c[0], at[1] - c[1], at[2] - c[2])
      if (d <= reach && (!best || d < best.d)) best = { part, d }
    }
  }
  return best?.part ?? null
}

/** A trapped-volume finding (its `at` in the part's frame) that is an
 *  encased part's pocket, as info naming the part; any other finding as it
 *  is. */
export function asEncased<F extends Finding>(f: F, parts: readonly EncasedPart[]): F & { encased?: string } {
  if (f.rule !== 'trapped-volume' || parts.length === 0) return f
  const part = pocketOf(f.at, parts)
  if (!part) return f
  // units-ok: the agent's readout, in millimetres always
  return { ...f, severity: 'info', encased: part.id, says: `pocket for ${part.id}: ${part.what}, filled at the pause — a closed cavity of ${r(f.value, 1)} mm³ meant to be one, no vent needed` }
}
