// SPDX-License-Identifier: AGPL-3.0-only
// The Pack workspace's part in the app for one render: its panel over the
// part as it stands.

import type { PluginRuntime } from '../../../src/plugins/api'
import { usePack } from '../state/packStore'
import { PackPanel } from '../ui/PackPanel'

export function usePackPlugin(): PluginRuntime {
  return {
    startPane: null,
    panel: <PackPanel />,
    canSave: usePack((s) => s.upstream.length > 0 || Boolean(s.settings.licence)),
  }
}
