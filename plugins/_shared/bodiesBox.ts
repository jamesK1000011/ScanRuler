// SPDX-License-Identifier: AGPL-3.0-only
// The box round the Reverse Engineer bodies standing now, read from its
// state section — what a new part is kept clear of (clear.ts).

import { readStateSections } from '../../src/commands/stateSections'
import { type Box3, join } from './clear'

/** The box round every visible Reverse Engineer body with bounds, or null. */
export function bodiesBox(): Box3 | null {
  const bs = ((readStateSections().reverse as { bodies?: { visible?: boolean; bounds?: { min: number[]; max: number[] } | null }[] } | undefined)?.bodies) ?? []
  let out: Box3 | null = null
  for (const b of bs) {
    const x = b.bounds
    if (b.visible === false || !x || x.min?.length !== 3 || x.max?.length !== 3 || ![...x.min, ...x.max].every(Number.isFinite)) continue
    out = out ? join(out, x as Box3) : { min: [...x.min] as Box3['min'], max: [...x.max] as Box3['max'] }
  }
  return out
}

