// SPDX-License-Identifier: AGPL-3.0-only
// The Print workspace's part in the app, and the start card kept on top of
// every workspace while a request waits.

import { useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PluginRuntime } from '../../../src/plugins/api'
import { AskCard, PrintPanel } from '../ui/AskCard'

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
  return { startPane: null, panel: <PrintPanel /> }
}
