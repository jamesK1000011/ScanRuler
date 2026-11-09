// SPDX-License-Identifier: AGPL-3.0-only
// The printer's calibration as it stands, read from Fits' part of the
// session without importing Fits: a build without it stands.

import { readStateSection } from '../../src/commands/stateSections'
import { printerFitOf, type PrinterFit } from './printerFit'

/** The printer's calibration now, in the shared convention; null without
 *  Fits in the build or with Fits on its defaults. */
export function readPrinterFit(): PrinterFit | null {
  return printerFitOf((readStateSection('fits') as { calibration?: unknown } | undefined)?.calibration)
}
