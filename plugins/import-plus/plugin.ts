// SPDX-License-Identifier: AGPL-3.0-only
// import-plus: GLB, glTF, FBX, 3DS, Collada, AMF and VRML opened as the scan
// or the reference part, read with three.js's loaders and handed to the
// app's own readers as STL. A .blend is converted on this computer by the
// MCP server's blender_convert tool first. No workspace of its own.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { importCommands } from './app/importCommands'
import { useImportDrop } from './app/useImportDrop'
import { useImportPlus } from './state/importStore'

const plugin: ScanRulerPlugin = {
  id: 'import-plus',
  name: 'More model formats',
  usePlugin: useImportDrop,
  install() {
    registerCommands('import', importCommands)
    registerStateSection('import', () => ({ last: useImportPlus.getState().last }))
    registerGuide({
      id: 'import-plus',
      title: 'Opening GLB, glTF, FBX, 3DS, Collada, AMF, VRML and Blender files',
      when: 'a model comes as .glb, .gltf, .fbx, .3ds, .dae, .amf, .wrl or .blend rather than STL, PLY, OBJ, 3MF or STEP: checking its units and parts, and opening it as the scan or the reference part',
      text: () => import('./guides/import-plus.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
