// SPDX-License-Identifier: AGPL-3.0-only
// slicer-loop: slicing from ScanRuler, with the slicers on this computer.
// The work is the MCP server's (slicer_* tools in mcp/src/extras, listed
// when SCANRULER_MCP_EXTRAS names "slicer"): a page cannot start a program.
// What the page carries is the guide an agent reads before slicing.

import { registerGuide, type ScanRulerPlugin } from '../../src/plugins/api'

const plugin: ScanRulerPlugin = {
  id: 'slicer-loop',
  name: 'Slicing',
  install() {
    registerGuide({
      id: 'slicer-loop',
      title: 'Slicing with OrcaSlicer, Bambu Studio or PrusaSlicer',
      when: 'slicing a part from ScanRuler with a slicer on this computer — setting it up, choosing profiles, overriding settings (fit-comp’s corrections), reading time, filament and layers back, and comparing two runs',
      text: () => import('./guides/slicer-loop.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
