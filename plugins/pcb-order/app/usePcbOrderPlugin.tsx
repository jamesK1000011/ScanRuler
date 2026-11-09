// SPDX-License-Identifier: AGPL-3.0-only
// Make › Order's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { OrderPanel } from '../ui/OrderPanel'

export function usePcbOrderPlugin(): PluginRuntime {
  return {
    panel: (
      <aside className="panel">
        <OrderPanel />
      </aside>
    ),
    startPane: { title: 'Board order', blurb: 'A circuit board from Electronics, checked against a board house’s typical figures and packaged for the order: Gerbers and drill files, BOM and CPL for assembly, STEP, and an order sheet.' },
  }
}
