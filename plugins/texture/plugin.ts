// SPDX-License-Identifier: AGPL-3.0-only
// The Texture workspace, as the app finds it: BumpMesh's texturing engine
// (CNC Kitchen's surface-texture tool, vendored in bumpmesh/ by
// scripts/sync-engine.mjs) on the part ScanRuler has open, with ScanRuler's
// regions for where it goes. See src/plugins/api.ts for what each part of
// this is to the app.

import { registerBusy, registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerHistory, pick } from '../../src/state/historyStore'
import { registerProjectSection } from '../../src/app/projectSections'
import { useTexture } from './state/textureStore'
import { textureBusy, textureCommands } from './app/textureCommands'
import { briefTexture, describeTexture } from './app/textureReadout'
import { textureSection } from './app/projectSection'
import { stopTexture, runningNow } from './app/textureSession'
import { useTexturePlugin } from './app/useTexturePlugin'
import { TextureNotices } from './ui/TextureNotices'
import './ui/texture.css'

const plugin: ScanRulerPlugin = {
  id: 'texture',
  name: 'Texture',
  workspace: {
    id: 'texture',
    label: 'Texture',
    title: 'A printable surface texture on the surfaces you choose, with BumpMesh’s engine',
    icon: 'surface',
    order: 16,
    group: 'model',
  },
  notices: TextureNotices,
  usePlugin: useTexturePlugin,
  install() {
    registerProjectSection(textureSection)
    registerCommands('texture', textureCommands)
    registerStateSection('texture', describeTexture, briefTexture)
    registerBusy('texture', textureBusy, [useTexture], async (done) => {
      stopTexture()
      await done.catch(() => {})
      await runningNow()?.catch(() => {})
    })
    registerHistory({
      sections: [
        {
          key: 'texture',
          capture: () => pick(useTexture.getState(), ['active', 'output', 'refineChosen', 'nextId']),
          apply: (value) => useTexture.setState(value as Partial<ReturnType<typeof useTexture.getState>>),
        },
        {
          // The layers are replaced whole on every change, masks and all.
          key: 'texture-layers',
          capture: () => useTexture.getState().layers,
          apply: (value) => useTexture.setState({ layers: value as ReturnType<typeof useTexture.getState>['layers'] }),
          compare: 'identity',
        },
      ],
      actions: [
        {
          store: useTexture,
          label: 'Texture',
          names: ['setLayerSettings', 'setTexture', 'setMask', 'setMaskMode', 'setOutput', 'addLayer', 'removeLayer', 'setActive', 'setVisible', 'setBlend'],
        },
      ],
      blocked: () => useTexture.getState().status === 'running',
    })
    registerGuide({
      id: 'texture',
      title: 'Texturing a part for printing',
      when: 'giving a part a printable surface texture with the Texture workspace (BumpMesh’s engine): choosing textures, depth and tile size for the printer, painting where it goes from ScanRuler’s regions, keeping fit surfaces untouched, previewing, exporting and proving the result',
      text: () => import('./guides/texture.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
