// SPDX-License-Identifier: AGPL-3.0-only
// The Boards workspace: a KiCad circuit board brought into Reverse
// Engineer, an enclosure made round it, and its fabrication package and
// design rule check — KiCad's own kicad-cli doing the KiCad work, on this
// computer, through the agent's server. See README.md.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerHistory } from '../../src/state/historyStore'
import { describePcb, pcbCommands } from './app/pcbCommands'
import { pcbSection } from './app/projectSection'
import { usePcbPlugin } from './app/usePcbPlugin'
import { setupOf, usePcb } from './state/pcbStore'

const plugin: ScanRulerPlugin = {
  id: 'pcb',
  name: 'Boards',
  workspace: {
    id: 'pcb',
    label: 'Boards',
    title: 'Circuit boards from KiCad — brought in as solids, boxed, and sent to the board house',
    icon: 'hole',
    order: 35,
    group: 'model',
  },
  usePlugin: usePcbPlugin,
  install() {
    registerProjectSection(pcbSection)
    registerCommands('pcb', pcbCommands)
    registerStateSection('pcb', describePcb)
    registerHistory({
      sections: [{ key: 'pcb', capture: () => setupOf(usePcb.getState()), apply: (v) => usePcb.setState(v as Partial<ReturnType<typeof usePcb.getState>>) }],
      actions: [{ store: usePcb, label: 'Boards', names: ['set'] }],
    })
    registerGuide({
      id: 'pcb',
      title: 'Circuit boards',
      when: 'asked about a KiCad board (.kicad_pcb): bringing it in as a 3D body, a case or enclosure for it, its Gerbers or fabrication files for JLCPCB or PCBWay, its DRC, or electronic parts’ 3D models',
      text: () => import('./guides/pcb.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
