// SPDX-License-Identifier: AGPL-3.0-only
// The Generate workspace: parametric parts made to a standard — Gridfinity
// bins and baseplates, a project box and lid — built as solids and brought
// into Reverse Engineer to finish, check and export. See README.md.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerHistory } from '../../src/state/historyStore'
import { describeGen, genCommands } from './app/genCommands'
import { genSection } from './app/projectSection'
import { useGenPlugin } from './app/useGenPlugin'
import { setupOf, useGen } from './state/genStore'

const plugin: ScanRulerPlugin = {
  id: 'gen',
  name: 'Generate',
  workspace: {
    id: 'gen',
    label: 'Generate',
    title: 'Parametric parts — Gridfinity bins and baseplates, a project box — made as solids to finish in Reverse Engineer',
    icon: 'pattern',
    order: 15,
    group: 'model',
  },
  usePlugin: useGenPlugin,
  install() {
    registerProjectSection(genSection)
    registerCommands('gen', genCommands)
    registerStateSection('gen', describeGen)
    registerHistory({
      sections: [{ key: 'gen', capture: () => setupOf(useGen.getState()), apply: (v) => useGen.setState(v as Partial<ReturnType<typeof useGen.getState>>) }],
      actions: [{ store: useGen, label: 'Generate', names: ['set', 'setValues'] }],
    })
    registerGuide({
      id: 'gen',
      title: 'Generated parts',
      when: 'asked for a Gridfinity bin or baseplate, a storage bin on a grid, or a project box or enclosure with a lid — a standard part made to size rather than modelled by hand',
      text: () => import('./guides/gen.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
