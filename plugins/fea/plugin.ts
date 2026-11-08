// SPDX-License-Identifier: AGPL-3.0-only
// The FEA workspace: the strength of a printed part, by finite elements —
// a Reverse Engineer body meshed by Gmsh and solved by CalculiX on this
// computer through the agent's server, the material weaker across its
// layers than in them, and the answer on the part. See README.md.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { describeFea, feaCommands } from './app/feaCommands'
import { feaSection } from './app/projectSection'
import { useFeaPlugin } from './app/useFeaPlugin'

const plugin: ScanRulerPlugin = {
  id: 'fea',
  name: 'Strength (FEA)',
  workspace: {
    id: 'fea',
    label: 'Strength',
    title: 'Will it hold? FEA of a printed part, weaker across its layers',
    icon: 'wsThickness',
    order: 32,
    group: 'make',
  },
  usePlugin: useFeaPlugin,
  install() {
    registerProjectSection(feaSection)
    registerCommands('fea', feaCommands)
    registerStateSection('fea', describeFea)
    registerGuide({
      id: 'fea',
      title: 'Checking a printed part’s strength',
      when: 'asked whether a part will hold, how thick a wall or rib needs to be, how to orient a part on the bed for strength, or what material to print it in — a Reverse Engineer body under a load',
      text: () => import('./guides/fea.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
