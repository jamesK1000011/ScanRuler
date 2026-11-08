// SPDX-License-Identifier: AGPL-3.0-only
// The Slice step's part in the app: its panel, which needs no part open.

import type { PluginRuntime } from '../../../src/plugins/api'
import { SlicePanel } from '../ui/SlicePanel'

export function useSlicePlugin(): PluginRuntime {
  return { panel: <SlicePanel />, startPane: null }
}
