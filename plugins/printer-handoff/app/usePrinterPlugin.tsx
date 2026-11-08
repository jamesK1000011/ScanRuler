// SPDX-License-Identifier: AGPL-3.0-only
// The Print workspace's part in the app, and the start card kept on top of
// every workspace while a request waits.

import { useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PluginRuntime } from '../../../src/plugins/api'
import { AskCard, PrintPanel } from '../ui/AskCard'
import { useAsks } from '../state/askStore'

let root: Root | null = null

export function usePrinterPlugin(): PluginRuntime {
  useEffect(() => {
    if (root) return
    const el = document.createElement('div')
    el.id = 'scanruler-print-ask'
    document.body.appendChild(el)
    root = createRoot(el)
    root.render(<AskCard />)
  }, [])
  // While the Print workspace is open its panel shows the request, so the
  // card over the workspace steps aside rather than offer a second Start.
  useEffect(() => {
    useAsks.getState().setInPrint(true)
    return () => useAsks.getState().setInPrint(false)
  }, [])
  return { startPane: null, panel: <PrintPanel /> }
}
