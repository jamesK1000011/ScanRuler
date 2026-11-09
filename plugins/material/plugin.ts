// SPDX-License-Identifier: AGPL-3.0-only
// Materials: what each part is made of, as a property of the part — a body
// of steel, one of PLA, a bought brass insert — whatever process makes it.
// The library is shared (plugins/_shared/materials), and so is who has
// what (_shared/materials/assigned.ts), which Mass, Strength and Reverse
// Engineer's body list read; this plugin saves it with the project, answers
// material.* and puts each change in the undo history. No workspace.
// See README.md.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerHistory } from '../../src/state/historyStore'
import { describeMaterials, materialCommands } from './app/materialCommands'
import { materialsSection } from './app/projectSection'
import { useAssigned } from '../_shared/materials/assigned'
import { MaterialNotices } from './ui/MaterialNotices'

const plugin: ScanRulerPlugin = {
  id: 'material',
  name: 'Materials',
  notices: MaterialNotices,
  install() {
    useAssigned.setState({ installed: true })
    registerProjectSection(materialsSection)
    registerCommands('material', materialCommands)
    registerStateSection('material', describeMaterials)
    registerHistory({
      sections: [{ key: 'materials', capture: () => useAssigned.getState().assigned, apply: (v) => useAssigned.setState({ assigned: (v ?? {}) as ReturnType<typeof useAssigned.getState>['assigned'] }), compare: 'identity' }],
    })
    registerGuide({
      id: 'material',
      title: 'What each part is made of',
      when: 'before weighing or solving a part, when a part is to be made of something other than a printing filament, or when the person names a material — choose it with them, then set it on the body',
      text: () => import('./guides/material.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
