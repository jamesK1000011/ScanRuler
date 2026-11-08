// SPDX-License-Identifier: AGPL-3.0-only
// The printer's one calibration: fit.measure hands a run worth trusting to
// Fits (fit.calibrate { from: "print-fit" }), inside its own change.

import { listCommands, runWithin } from '../../../src/commands/registry'
import type { Solution } from '../core/solve'

type Json = Record<string, unknown>

/** The printer has one calibration, the Fits tab's: a run worth trusting
 *  becomes it (fit.calibrate { from: "print-fit" }), so a print measured
 *  here sizes Fits' holes and shafts too, with no second calibration. A
 *  poor fit, or offsets this part cannot separate, leave it as it was —
 *  said, with why. Without Fits in the build there is nothing to share. */
export async function shareCalibration(s: Solution): Promise<Json> {
  if (!listCommands().some((c) => c.name === 'fit.calibrate')) return {}
  if (s.fit > 4) return { calibrationKept: 'The fit is poor: Fits keeps the calibration it had.' }
  if (!s.hole.determined || !s.contour.determined) return { calibrationKept: 'This part does not separate the hole and contour offsets: Fits keeps the calibration it had.' }
  const r = (await runWithin('fit.calibrate', { from: 'print-fit' })) as { calibration?: Json; note?: string }
  return { calibration: r.calibration, ...(r.note ? { calibrationNote: r.note } : {}) }
}
