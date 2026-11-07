// SPDX-License-Identifier: AGPL-3.0-only
// From what the print did to what to change: each parameter the fit read,
// whether it is worth changing — larger than three of its standard errors
// and than the smallest step a slicer setting is worth moving — and, for a
// slicer's key map, the new value of each setting from the one in use.

import type { Estimate, Solution } from './solve'

export type Quantity = 'contour' | 'hole' | 'foot' | 'scaleXY' | 'scaleZ'

export interface KeySpec {
  key: string | null
  section?: string
  kind: 'add' | 'percentMeasured' | 'percentShrink' | 'objectScale' | 'unsupported'
  sign?: 1 | -1
  note?: string
}

export interface Keymap {
  id: string
  label: string
  checked?: string
  keys: Partial<Record<Quantity, KeySpec>>
}

export interface Correction {
  quantity: Quantity
  /** What the print did: mm for offsets, measured/nominal for scales. */
  read: number
  se: number
  change: boolean
  why: string
}

export interface SlicerChange {
  quantity: Quantity
  key: string | null
  section?: string
  from: number | null
  to: number | null
  unit: string
  note?: string
}

/** The least worth changing: a slicer offset of under 0.02 mm, a scale of
 *  under 0.1 %, moves nothing a person can measure. */
const STEP_MM = 0.02
const STEP_SCALE = 0.001

const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d

export function corrections(sol: Solution): Correction[] {
  const out: Correction[] = []
  const judge = (quantity: Quantity, e: Estimate, step: number, base: number, words: string) => {
    const off = e.value - base
    if (!e.determined) {
      out.push({ quantity, read: r(e.value, 4), se: r(e.se, 4), change: false, why: `not separable on this part: ${words}` })
      return
    }
    const big = Math.abs(off) >= Math.max(3 * e.se, step)
    out.push({
      quantity,
      read: r(e.value, 4),
      se: r(e.se, 4),
      change: big,
      why: big ? `${r(Math.abs(off) / e.se, 1)} standard errors from ${base === 1 ? 'true scale' : 'zero'}` : Math.abs(off) < step ? `under the ${base === 1 ? '0.1 %' : '0.02 mm'} worth changing` : `within what this scan resolves (±${r(3 * e.se, 4)})`,
    })
  }
  const sx = sol.scale.x, sy = sol.scale.y
  const xy: Estimate = { value: (sx.value + sy.value) / 2, se: Math.hypot(sx.se, sy.se) / 2, determined: sx.determined && sy.determined }
  judge('scaleXY', xy, STEP_SCALE, 1, 'scale needs features far apart (hole centres) or of different sizes')
  judge('scaleZ', sol.scale.z, STEP_SCALE, 1, 'Z scale needs two or more flat floors or tops at different heights')
  judge('contour', sol.contour, STEP_MM, 0, 'the contour offset needs outer walls or bosses beside features that pin the scale')
  judge('hole', sol.hole, STEP_MM, 0, 'the hole offset needs at least one hole')
  if (sol.foot) {
    const e = sol.foot
    const big = Math.abs(e.value) >= Math.max(3 * e.se, STEP_MM)
    out.push({ quantity: 'foot', read: r(e.value, 4), se: r(e.se, 4), change: big && e.value > 0, why: e.value <= 0 ? 'the first layer is not wider than the wall above it' : big ? `${r(e.value / e.se, 1)} standard errors out` : 'within what this scan resolves' })
  } else out.push({ quantity: 'foot', read: 0, se: 0, change: false, why: 'no wall stands on the bed in the scan' })
  return out
}

/** The new value of each setting the key map names, from the current ones
 *  (the slicer's defaults where none is given). */
export function slicerChanges(cs: Correction[], map: Keymap, current: Record<string, number> = {}): SlicerChange[] {
  const out: SlicerChange[] = []
  for (const c of cs) {
    const spec = map.keys[c.quantity]
    if (!spec) continue
    if (!c.change) continue
    if (spec.kind === 'unsupported' || spec.kind === 'objectScale' || !spec.key) {
      const pct = spec.kind === 'objectScale' ? r(100 / c.read, 3) : null
      out.push({ quantity: c.quantity, key: null, from: null, to: pct, unit: pct === null ? '' : '% object scale', ...(spec.note ? { note: spec.note } : {}) })
      continue
    }
    const sign = spec.sign ?? 1
    let from: number, to: number, unit: string
    if (spec.kind === 'add') {
      from = current[spec.key] ?? 0
      to = r(from + sign * c.read, 3)
      unit = 'mm'
    } else if (spec.kind === 'percentMeasured') {
      from = current[spec.key] ?? 100
      to = r(from * c.read, 2)
      unit = '%'
    } else {
      from = current[spec.key] ?? 0
      to = r(100 * (1 - c.read * (1 - from / 100)), 2)
      unit = '%'
    }
    out.push({ quantity: c.quantity, key: spec.key, ...(spec.section ? { section: spec.section } : {}), from, to, unit, ...(spec.note ? { note: spec.note } : {}) })
  }
  return out
}

/** The changes as a fragment of the slicer's config, one key a line. */
export function iniFragment(changes: SlicerChange[], map: Keymap, header: string): string {
  const lines = [`; ${header}`, `; ${map.label} keys${map.checked ? ` (${map.checked})` : ''}`]
  for (const c of changes) {
    if (c.key && c.to !== null) lines.push(`${c.key} = ${c.unit === '%' ? `${c.to}%` : c.to}`)
    else if (c.note) lines.push(`; ${c.quantity}: ${c.note}${c.to !== null ? ` (${c.to}${c.unit})` : ''}`)
  }
  return lines.join('\n') + '\n'
}
