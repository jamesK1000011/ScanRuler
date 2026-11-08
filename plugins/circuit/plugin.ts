// SPDX-License-Identifier: AGPL-3.0-only
// Electronics' tscircuit page: circuit boards written as code with tscircuit,
// built on this computer by its command line through the agent's server,
// read back from their Circuit JSON, measured, and brought into Reverse
// Engineer as solids — the board, its copper, the parts' keep-outs. See
// README.md.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerHistory } from '../../src/state/historyStore'
import { circuitCommands, describeCircuit } from './app/circuitCommands'
import { circuitSection } from './app/projectSection'
import { useCircuitPlugin } from './app/useCircuitPlugin'
import { setupOf, useCircuit } from './state/circuitStore'
import { ELECTRONICS } from '../_shared/workspaces'

const plugin: ScanRulerPlugin = {
  id: 'circuit',
  name: 'Circuit',
  workspace: {
    // A page of Electronics; the id it has always had, which projects keep.
    id: 'circuit',
    label: 'tscircuit',
    title: 'Boards written as code with tscircuit, brought in as solids',
    icon: 'sheet',
    order: 2,
    host: ELECTRONICS,
  },
  usePlugin: useCircuitPlugin,
  install() {
    registerProjectSection(circuitSection)
    registerCommands('circuit', circuitCommands)
    registerStateSection('circuit', describeCircuit)
    registerHistory({
      sections: [{ key: 'circuit', capture: () => setupOf(useCircuit.getState()), apply: (v) => useCircuit.setState(v as Partial<ReturnType<typeof useCircuit.getState>>) }],
      actions: [{ store: useCircuit, label: 'Circuit', names: ['set', 'setSettings'] }],
    })
    registerGuide({
      id: 'circuit',
      title: 'Circuit boards with tscircuit',
      when: 'asked to design a circuit board or PCB in code, to build or export a tscircuit project (Gerbers, BOM, pick-and-place, KiCad, STEP), to fit a board to an enclosure, to bring a board into the model as solids, or to estimate a trace’s resistance in copper or a conductive filament',
      text: () => import('./guides/circuit.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
