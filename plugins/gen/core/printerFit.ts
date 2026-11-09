// SPDX-License-Identifier: AGPL-3.0-only
// The printer's fit calibration (plugins/_shared/printerFit.ts) as the
// generators' defaults. Their built-in holes, gaps and margins suit the
// typical printer the shared convention names; a calibration moves each by
// its difference from that — a hole by the hole figure, a gap between two
// printed walls (a lid's lip in its box) by both walls' share, a gap round
// a bought part (a board, a connector) by the printed wall's alone. A
// value set by hand is the person's and is never moved. Pure.

import { gapShift, holeShift, pocketShift, type PrinterFit } from '../../_shared/printerFit'
import type { Generator } from './generators'

/** By parameter key: what the calibration adds to its default. */
const SHIFTS: Record<string, (f: PrinterFit) => number> = {
  holes: holeShift,
  clearance: gapShift,
  gap: pocketShift,
  margin: pocketShift,
}

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0

/** The defaults the calibration sets for a generator: each hole, gap and
 *  margin it has, moved and kept within its range. Empty without one. */
export function calibratedDefaults(g: Generator, fit: PrinterFit | null): Record<string, number> {
  if (!fit) return {}
  const out: Record<string, number> = {}
  for (const p of g.params) {
    const shift = SHIFTS[p.key]
    const d = g.defaults[p.key]
    if (!shift || p.kind !== 'num' || typeof d !== 'number') continue
    out[p.key] = r3(Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, d + shift(fit))))
  }
  return out
}
