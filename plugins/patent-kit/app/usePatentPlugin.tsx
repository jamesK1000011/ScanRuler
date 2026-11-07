// SPDX-License-Identifier: AGPL-3.0-only
// The Patent workspace's part in the app for one render: its panel, and the
// sheet drawn last laid over the stage while it is asked for.

import type { PluginRuntime } from '../../../src/plugins/api'
import { useShell } from '../../../src/state/shellStore'
import { usePatent } from '../state/patentStore'
import { PatentPanel, PatentSheet, usePatentView } from '../ui/PatentPanel'

export function usePatentPlugin(): PluginRuntime {
  const onScreen = useShell((s) => s.workspace) === 'patent'
  const url = usePatentView((s) => s.url)
  const onStage = usePatentView((s) => s.onStage)
  const shown = onScreen && Boolean(url) && onStage
  return {
    startPane: null,
    panel: <PatentPanel />,
    ...(shown ? { stage: <PatentSheet />, hideViewport: true } : {}),
    canSave: usePatent((s) => s.figures.length > 0 || s.numerals.length > 0 || Object.keys(s.draft).length > 0),
  }
}
