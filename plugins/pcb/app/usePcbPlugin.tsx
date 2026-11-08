// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › KiCad's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { PcbPanel } from '../ui/PcbPanel'

export function usePcbPlugin(): PluginRuntime {
  return {
    // The panel's frame: the column the app's own panels stand in.
    panel: (
      <aside className="panel">
        <PcbPanel />
      </aside>
    ),
    startPane: { title: 'Boards', blurb: 'Open a KiCad board (.kicad_pcb), bring it into Reverse Engineer as solids, make an enclosure round it, and make its Gerbers and drill files for the board house — KiCad runs on your computer through the agent connection.' },
  }
}
