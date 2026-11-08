// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › Printed wiring's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { PrintedPanel } from '../ui/PrintedPanel'

export function usePrintedPlugin(): PluginRuntime {
  return {
    // The panel's frame: the column the app's own panels stand in.
    panel: (
      <aside className="panel">
        <PrintedPanel />
      </aside>
    ),
    startPane: { title: 'Circuits', blurb: 'Build or import the part in Reverse Engineer, then lay circuits in it: traces of conductive filament printed as a second body, or channels for copper wire, tape or paint — each net’s resistance worked out.' },
  }
}
