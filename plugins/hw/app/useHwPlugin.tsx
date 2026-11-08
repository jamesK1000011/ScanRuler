// SPDX-License-Identifier: AGPL-3.0-only
// The Hardware workspace's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { HwPanel } from '../ui/HwPanel'

export function useHwPlugin(): PluginRuntime {
  return {
    // The panel's frame: the column the app's own panels stand in.
    panel: (
      <aside className="panel">
        <HwPanel />
      </aside>
    ),
    startPane: { title: 'Hardware', blurb: 'Build or import the part in Reverse Engineer, then put holes in it for the hardware it takes — screws with their heads, nut traps, heat-set inserts, magnets and bearings — sized for printing, as features you can still edit.' },
  }
}
