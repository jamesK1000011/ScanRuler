// SPDX-License-Identifier: AGPL-3.0-only
// wear-repair: a worn or damaged part brought back to what it should be —
// from its own other half mirrored, or its CAD or a twin aligned in the
// Deviation workspace — and a print pre-warped so it comes out true. No
// workspace of its own: its commands (wear.*) work on the scan.

import { registerProjectSection } from '../../src/app/projectSections'
import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { wearCommands } from './app/wearCommands'
import { wearSection } from './app/projectSection'
import { useWear } from './state/wearStore'

const plugin: ScanRulerPlugin = {
  id: 'wear-repair',
  name: 'Wear repair',
  install() {
    registerProjectSection(wearSection)
    registerCommands('wear', wearCommands)
    registerStateSection('wear', () => {
      const s = useWear.getState()
      return { settings: s.settings, tags: s.tags.map((t) => ({ name: t.name, kind: t.kind })), reference: s.reference, runs: s.runs }
    })
    registerGuide({
      id: 'wear-repair',
      title: 'Repairing a worn part and pre-warping a print',
      when: 'a scanned part is worn, dented or damaged and should be brought back to shape from its own symmetry, a twin or its CAD; or a print keeps coming out distorted and the model should be pre-warped against it',
      text: () => import('./guides/wear-repair.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
