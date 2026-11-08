// SPDX-License-Identifier: AGPL-3.0-only
// The Fits workspace's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { FitsPanel } from '../ui/FitsPanel'

export function useFitsPlugin(): PluginRuntime {
  return {
    panel: <FitsPanel />,
    startPane: { title: 'Fits', blurb: 'Size a hole and shaft for a slip or press fit, design a snap-fit hook or a print-in-place hinge, add up a tolerance stack — and print a test coupon to calibrate it all to your printer.' },
  }
}
