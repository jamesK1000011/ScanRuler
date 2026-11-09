// SPDX-License-Identifier: AGPL-3.0-only
// The printer's calibration as it stands, read from the session without
// importing Fits or the setups: a build without either stands. It is the
// print setup's machine property: for a body in a print setup that holds a
// calibration, that one; else Fits' own, the printer every printed hole is
// sized for by default.

import { readStateSection } from '../../src/commands/stateSections'
import { printerFitOf, type PrinterFit } from './printerFit'
import { setupValue } from './setups'

/** The printer's calibration now, in the shared convention — the print
 *  setup's when `body` is in one that holds one; null without Fits in the
 *  build or with Fits on its defaults, and no setup's. */
export function readPrinterFit(body?: string | number | null): PrinterFit | null {
  const own = printerFitOf(setupValue(body, 'fit')?.value)
  if (own) return own
  return printerFitOf((readStateSection('fits') as { calibration?: unknown } | undefined)?.calibration)
}
