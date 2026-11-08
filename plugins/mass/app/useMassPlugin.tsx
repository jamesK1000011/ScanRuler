// SPDX-License-Identifier: AGPL-3.0-only
// The Mass workspace's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { MassPanel } from '../ui/MassPanel'

export function useMassPlugin(): PluginRuntime {
  return {
    // The panel's frame: the column the app's own panels stand in.
    panel: (
      <aside className="panel">
        <MassPanel />
      </aside>
    ),
    startPane: { title: 'Mass and balance', blurb: 'Build or import the part in Reverse Engineer, then weigh it here as it will print — walls, infill and material — find where it balances, and plan the ballast that makes it weigh and sit like the real thing.' },
  }
}
