// SPDX-License-Identifier: AGPL-3.0-only
// The Mill page's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { MillPanel } from '../ui/MillPanel'

export function useMillPlugin(): PluginRuntime {
  return { panel: <MillPanel />, startPane: null }
}
