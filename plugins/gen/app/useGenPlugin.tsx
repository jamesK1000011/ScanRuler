// SPDX-License-Identifier: AGPL-3.0-only
// The Generate workspace's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { GenPanel } from '../ui/GenPanel'

export function useGenPlugin(): PluginRuntime {
  return {
    // The panel's frame: the column the app's own panels stand in.
    panel: (
      <aside className="panel">
        <GenPanel />
      </aside>
    ),
    startPane: { title: 'Generate', blurb: 'Pick a part — a Gridfinity bin or baseplate, a project box — set its sizes, and make it: it comes into Reverse Engineer as solid bodies, to cut, fillet and export like any other.' },
  }
}
