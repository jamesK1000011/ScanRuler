// SPDX-License-Identifier: AGPL-3.0-only
// The Assembly workspace's part in the app for one render: its panel, and
// the page drawn last laid over the stage while it is asked for.

import type { PluginRuntime } from '../../../src/plugins/api'
import { useShell } from '../../../src/state/shellStore'
import { useAsm } from '../state/asmStore'
import { AsmPage, AssemblyPanel, useAsmView } from '../ui/AssemblyPanel'

export function useAsmPlugin(): PluginRuntime {
  const onScreen = useShell((s) => s.workspace) === 'assembly'
  const url = useAsmView((s) => s.url)
  const onStage = useAsmView((s) => s.onStage)
  return {
    startPane: null,
    panel: <AssemblyPanel />,
    ...(onScreen && url && onStage ? { stage: <AsmPage />, hideViewport: true } : {}),
    canSave: useAsm((s) => s.parts.length > 0 || s.steps.length > 0),
  }
}
