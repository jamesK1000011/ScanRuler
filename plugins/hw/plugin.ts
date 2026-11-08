// SPDX-License-Identifier: AGPL-3.0-only
// The Hardware workspace: holes in a printed part for the hardware it takes
// — screw clearances with counterbores or countersinks, nut traps and side
// slots, heat-set inserts, pilots, magnets and bearings — sized from the
// standards with a printing allowance and cut into Reverse Engineer bodies
// as editable features. See README.md.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerHistory } from '../../src/state/historyStore'
import { describeHw, hwCommands } from './app/hwCommands'
import { hwSection } from './app/projectSection'
import { useHwPlugin } from './app/useHwPlugin'
import { settingsOf, useHw } from './state/hwStore'

const plugin: ScanRulerPlugin = {
  id: 'hw',
  name: 'Hardware',
  workspace: {
    id: 'hw',
    label: 'Hardware',
    title: 'Holes for screws, nuts, inserts, magnets and bearings, sized for printing',
    icon: 'hole',
    order: 34,
    group: 'make',
  },
  usePlugin: useHwPlugin,
  install() {
    registerProjectSection(hwSection)
    registerCommands('hw', hwCommands)
    registerStateSection('hw', describeHw)
    registerHistory({
      sections: [{ key: 'hw', capture: () => settingsOf(useHw.getState()), apply: (v) => useHw.setState(v as Partial<ReturnType<typeof useHw.getState>>) }],
      actions: [{ store: useHw, label: 'Hardware', names: ['set'] }],
    })
    registerGuide({
      id: 'hw',
      title: 'Holes for hardware',
      when: 'asked to put holes in a printed part for screws, bolts, nuts, heat-set inserts, magnets or bearings — clearance, counterbore, countersink, nut trap, insert or press-fit sizes — or what an existing hole fits',
      text: () => import('./guides/hw.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
