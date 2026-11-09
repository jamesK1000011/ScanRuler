// SPDX-License-Identifier: AGPL-3.0-only
// The printer's fit calibration (plugins/_shared/printerFit.ts) applied to
// the hole allowances. The built-in allowances suit the typical printer the
// shared convention names (holes 0.2 small); a calibration moves each one
// left at its default by its difference from that. An allowance set to
// anything else is the person's own and stays. Pure.

import { holeShift, type PrinterFit } from '../../_shared/printerFit'
import { KINDS, type Kind } from './hardware'
import { DEFAULT_SETTINGS, r3, type Settings } from './plan'

/** The kinds whose allowance the calibration sets: those at their default. */
export const calibratedKinds = (s: Settings): Kind[] => KINDS.filter((k) => s.allowance[k] === DEFAULT_SETTINGS.allowance[k])

/** The settings holes are sized with: the allowances left at their default
 *  moved by the calibration, when there is one and printerFit is on. */
export function withPrinterFit(s: Settings, fit: PrinterFit | null): Settings {
  if (!fit || !s.printerFit) return s
  const shift = holeShift(fit)
  const allowance = { ...s.allowance }
  for (const k of calibratedKinds(s)) allowance[k] = r3(Math.min(2, Math.max(-1, DEFAULT_SETTINGS.allowance[k] + shift))) + 0
  return { ...s, allowance }
}
