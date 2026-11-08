// SPDX-License-Identifier: AGPL-3.0-only
// The camera button, mounted once over the whole app.

import { useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { PluginRuntime } from '../../../src/plugins/api'
import { ShotButton } from '../ui/ShotButton'

let root: Root | null = null
const NONE: PluginRuntime = {}

export function useSnapshotPlugin(): PluginRuntime {
  useEffect(() => {
    if (root) return
    const el = document.createElement('div')
    el.id = 'scanruler-snapshot'
    document.body.appendChild(el)
    root = createRoot(el)
    root.render(<ShotButton />)
  }, [])
  return NONE
}
