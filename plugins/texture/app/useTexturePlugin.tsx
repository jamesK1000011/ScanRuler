// SPDX-License-Identifier: AGPL-3.0-only
// The Texture workspace's part in the app for one render — see
// src/plugins/api.ts: its panel, the marking it arms for painting where a
// texture goes, the textured mesh standing in for the scan while shown.
// The panel's buttons run the workspace's commands, so a click and an
// agent take the same path.

import { useEffect } from 'react'
import type { PluginHost, PluginRuntime } from '../../../src/plugins/api'
import { runCommand } from '../../../src/commands/registry'
import { useShell } from '../../../src/state/shellStore'
import { useStore } from '../../../src/state/store'
import { useMark } from '../../../src/state/markStore'
import { saveFile } from '../../../src/app/exports'
import type { FileOut } from '../../../src/commands/types'
import { useTexture } from '../state/textureStore'
import { TexturePanel } from '../ui/TexturePanel'
import { MASK_COLOR } from './textureReadout'
import { bindTextureHost, disposeStage, hideResult } from './textureSession'

const report = (e: unknown) => useStore.setState({ errorText: e instanceof Error ? e.message : String(e) })
const run = (name: string, input: Record<string, unknown> = {}) => runCommand(`texture.${name}`, input).catch(report)

export function useTexturePlugin(host: PluginHost): PluginRuntime {
  const workspace = useShell((s) => s.workspace)
  const shownResult = useTexture((s) => s.previewShown)
  const fileName = useStore((s) => s.fileName)
  const onScreen = workspace === 'texture'

  useEffect(() => bindTextureHost(host), [host])
  useEffect(() => () => disposeStage(), [])
  // A new scan: what was textured was the old one's.
  useEffect(() => {
    hideResult()
    useTexture.setState({ result: null })
  }, [fileName])
  // Off the workspace, the scan is back on the stage.
  useEffect(() => {
    if (!onScreen && useTexture.getState().previewShown) hideResult()
  }, [onScreen])

  return {
    startPane: {
      title: 'Texturing a part',
      blurb:
        'Open a part — a scan, or a model you rebuilt and exported — and give its surfaces a printable texture with BumpMesh’s engine: knurling or stipple on a grip, a pattern on a panel, a logo stamped once. Paint the surfaces that must stay as they are, preview it, and export STL or 3MF. Everything stays in this browser.',
    },
    hideScan: onScreen && shownResult,
    marking: onScreen ? { color: MASK_COLOR, gestures: true } : null,
    canSave: useTexture((s) => s.layers.some((L) => L.texture !== null || L.mask !== null)),
    panel: (
      <TexturePanel
        onPickTexture={(name) => void run('set', { texture: name })}
        onImage={(file) => void file.arrayBuffer().then((b) => run('image', { bytes: new Uint8Array(b), name: file.name }))}
        onSettings={(settings) => void run('set', { settings })}
        onMaskMode={(mode) => void run('mask', { mode, op: 'clear' })}
        onUseMarking={(op) => void run('mask', { op, region: 'marked' })}
        onShowMask={() => void run('show_mask')}
        onClearMask={() => void run('mask', { op: 'clear' })}
        onClearMarking={() => {
          host.sceneRef.current?.clearPaint()
          useMark.getState().setCount(0)
        }}
        onPreview={() => void run('preview')}
        onExport={(format) =>
          void runCommand('texture.export', { format })
            .then((r) => {
              const file = (r as { file: FileOut }).file
              saveFile(file.name, new Blob([file.bytes as BlobPart], { type: file.mimeType }))
            })
            .catch(report)
        }
        onStop={() => void run('stop')}
        onShow={(what) => void run('show', { what })}
      />
    ),
  }
}
