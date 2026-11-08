// SPDX-License-Identifier: AGPL-3.0-only
// The Boards workspace's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { PcbPanel } from '../ui/PcbPanel'

export function usePcbPlugin(): PluginRuntime {
  return {
    panel: <PcbPanel />,
    startPane: { title: 'Boards', blurb: 'Open a KiCad board (.kicad_pcb), bring it into Reverse Engineer as solids, make an enclosure round it, and make its Gerbers and drill files for the board house — KiCad runs on your computer through the agent connection.' },
  }
}
