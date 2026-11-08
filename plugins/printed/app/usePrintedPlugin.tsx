// SPDX-License-Identifier: AGPL-3.0-only
// The Printed circuits workspace's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { PrintedPanel } from '../ui/PrintedPanel'

export function usePrintedPlugin(): PluginRuntime {
  return {
    panel: <PrintedPanel />,
    startPane: { title: 'Circuits', blurb: 'Build or import the part in Reverse Engineer, then lay circuits in it: traces of conductive filament printed as a second body, or channels for copper wire, tape or paint — each net’s resistance worked out.' },
  }
}
