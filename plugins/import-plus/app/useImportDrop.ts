// SPDX-License-Identifier: AGPL-3.0-only
// A model in one of import-plus's formats dropped on the page opens as the
// scan, as an STL or a 3MF would: caught before the app's own drop handler,
// which would refuse the extension, and opened through import.open. Any
// other drop goes on to the app untouched.

import { useEffect } from 'react'
import { runCommand } from '../../../src/commands/registry'
import type { PluginRuntime } from '../../../src/plugins/api'
import { useStore } from '../../../src/state/store'
import { formatOf } from '../core/convert'

const NONE: PluginRuntime = {}

/** A file picked in an Open picker (registerModelFormat), opened through
 *  import.open as the scan or the reference — said in the status line, as
 *  a drop is. */
export async function openPicked(file: File, as: 'scan' | 'reference', discard: boolean): Promise<void> {
  useStore.getState().setStatus(`Reading ${file.name}…`)
  const bytes = new Uint8Array(await file.arrayBuffer())
  await runCommand('import.open', { bytes, name: file.name, as, ...(discard ? { discard } : {}) })
  useStore.getState().setStatus(`${file.name} opened.`)
}

export function useImportDrop(): PluginRuntime {
  useEffect(() => {
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (files.length !== 1 || !formatOf(files[0].name)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      const file = files[0]
      useStore.getState().setStatus(`Reading ${file.name}…`)
      void file
        .arrayBuffer()
        .then((buf) => runCommand('import.open', { bytes: new Uint8Array(buf), name: file.name }))
        .then(() => useStore.getState().setStatus(`${file.name} opened.`))
        .catch((err: unknown) => useStore.getState().setStatus(`${file.name}: ${err instanceof Error ? err.message : String(err)}`))
    }
    window.addEventListener('drop', onDrop, { capture: true })
    return () => window.removeEventListener('drop', onDrop, { capture: true })
  }, [])
  return NONE
}
