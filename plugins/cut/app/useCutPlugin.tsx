// SPDX-License-Identifier: AGPL-3.0-only
// The Cut page's part in the app: its panel.

import type { PluginRuntime } from '../../../src/plugins/api'
import { CutPanel } from '../ui/CutPanel'

export function useCutPlugin(): PluginRuntime {
  return { panel: <CutPanel />, startPane: null }
}
