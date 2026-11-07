// SPDX-License-Identifier: AGPL-3.0-only
// The assembly as declared: what each step adds, the bill of materials,
// what is missing or placed twice, and the view a step is best seen from.

import { camera, dot, type Camera, type V3, type ViewName } from '../../_shared/lineart/views'
import type { Part, Step } from './model'

export interface Issue {
  level: 'error' | 'warn' | 'note'
  step?: number
  part?: string
  message: string
}

export interface BomRow {
  item: number
  name: string
  qty: number
  kind: Part['kind']
  designation?: string
  source?: string
}

/** Parts alike (one designation, or one name less its number) come as one
 *  row with a count; others a row each. */
export function bom(parts: Part[]): BomRow[] {
  const rows: BomRow[] = []
  const keyOf = (p: Part) => (p.designation ? `d:${p.designation}` : `n:${p.name.replace(/\s*\d+$/, '')}:${p.kind}:${p.body ? 'b' : ''}`)
  const seen = new Map<string, BomRow>()
  for (const p of parts) {
    const key = p.kind === 'hardware' || p.designation ? keyOf(p) : `n:${p.name}`
    const row = seen.get(key)
    if (row) {
      row.qty += p.qty ?? 1
      continue
    }
    const r: BomRow = { item: rows.length + 1, name: p.designation ? p.name.replace(/\s*\d+$/, '') : p.name, qty: p.qty ?? 1, kind: p.kind, ...(p.designation ? { designation: p.designation } : {}), ...(p.source ? { source: p.source } : {}) }
    seen.set(key, r)
    rows.push(r)
  }
  return rows
}

/** The BOM item a part belongs to. */
export function itemOf(parts: Part[], name: string): number {
  const rows = bom(parts)
  const p = parts.find((x) => x.name === name)
  if (!p) return 0
  const want = p.designation ? p.name.replace(/\s*\d+$/, '') : p.name
  return rows.find((r) => r.name === want && (r.designation ?? '') === (p.designation ?? ''))?.item ?? 0
}

export function issues(parts: Part[], steps: Step[], bodies: string[]): Issue[] {
  const out: Issue[] = []
  const placedIn = new Map<string, number[]>()
  steps.forEach((s, i) => {
    if (!s.place.length) out.push({ level: 'warn', step: i + 1, message: `Step ${i + 1} places nothing.` })
    for (const pl of s.place) {
      placedIn.set(pl.part, [...(placedIn.get(pl.part) ?? []), i + 1])
      if (!parts.some((p) => p.name === pl.part)) out.push({ level: 'error', step: i + 1, part: pl.part, message: `Step ${i + 1} places "${pl.part}", which is not in the parts list (asm.parts).` })
      if (Math.hypot(...pl.move) < 1e-9) out.push({ level: 'error', step: i + 1, part: pl.part, message: `Step ${i + 1}: "${pl.part}" has no direction to move in.` })
    }
    if (!s.text) out.push({ level: 'note', step: i + 1, message: `Step ${i + 1} has no instructions yet (asm.text).` })
  })
  for (const p of parts) {
    const at = placedIn.get(p.name)
    if (!at && p.body) out.push({ level: 'warn', part: p.name, message: `"${p.name}" is never placed.` })
    if (at && at.length > 1) out.push({ level: 'error', part: p.name, message: `"${p.name}" is placed in steps ${at.join(' and ')}; a part goes in once.` })
    if (p.body && !bodies.includes(p.body)) out.push({ level: 'error', part: p.name, message: `"${p.name}" is body "${p.body}", which is not in Reverse Engineer now.` })
    if (p.kind === 'hardware' && !p.designation) out.push({ level: 'note', part: p.name, message: `"${p.name}" is hardware with no designation ("M3×10 ISO 4762"); the bill of materials can't say what to buy.` })
  }
  return out
}

/** The view that shows a step's moves best: a perspective from above, or
 *  from below for parts that go in upward, turned so the moves run across
 *  the paper rather than toward the viewer. */
export function bestView(moves: V3[]): ViewName | { toward: V3 } {
  const up = moves.reduce((s, m) => s + m[2] / (Math.hypot(...m) || 1), 0) > 0.5
  const candidates: { toward: V3 }[] = []
  for (const x of [1, -1]) for (const y of [1, -1]) candidates.push({ toward: [x / Math.sqrt(3), y / Math.sqrt(3), (up ? -1 : 1) / Math.sqrt(3)] })
  let best = candidates[0]
  let score = -Infinity
  for (const c of candidates) {
    const s = moves.reduce((acc, m) => {
      const l = Math.hypot(...m) || 1
      const along = dot([m[0] / l, m[1] / l, m[2] / l], c.toward)
      return acc + Math.sqrt(Math.max(0, 1 - along * along))
    }, 0) + (c.toward[0] > 0 && c.toward[1] < 0 ? 0.01 : 0)
    if (s > score) {
      score = s
      best = c
    }
  }
  return best.toward[0] > 0 && best.toward[1] < 0 && best.toward[2] > 0 ? 'iso' : best
}

export function stepCamera(step: Step): Camera {
  return camera(step.view ?? bestView(step.place.map((p) => p.move)))
}

const NAMED: Record<string, V3> = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1], down: [0, 0, -1], up: [0, 0, 1] }

export function direction(d: V3 | string): V3 {
  if (Array.isArray(d)) return d
  const v = NAMED[d.toLowerCase()]
  if (!v) throw new Error(`"${d}" is not a direction: give [x, y, z], or one of ${Object.keys(NAMED).join(', ')}.`)
  return v
}
