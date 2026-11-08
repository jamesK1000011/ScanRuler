// SPDX-License-Identifier: AGPL-3.0-only
// Calibrate from a scan's part in the app: its page of the Fits tab.

import type { PluginRuntime } from '../../../src/plugins/api'
import { ScanFitPanel } from '../ui/ScanFitPanel'

export function useFitCompPlugin(): PluginRuntime {
  return {
    panel: <ScanFitPanel />,
    startPane: {
      title: 'Calibrate from a scan',
      blurb: 'Open a scan of a printed part, then its CAD in Surface Deviation, and align them: the print’s scale, wall and hole offsets and elephant foot become slicer settings and the printer’s calibration.',
    },
  }
}
