// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › tscircuit's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { CircuitPanel } from '../ui/CircuitPanel'

export function useCircuitPlugin(): PluginRuntime {
  return {
    // The panel's frame: the column the app's own panels stand in.
    panel: (
      <aside className="panel">
        <CircuitPanel />
      </aside>
    ),
    startPane: { title: 'Circuit', blurb: 'Start a board from a template, build it with tscircuit on this computer, and bring it into Reverse Engineer as solids — the board, its copper, the parts’ keep-outs — to fit an enclosure round it.' },
  }
}
