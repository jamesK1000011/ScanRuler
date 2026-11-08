// SPDX-License-Identifier: AGPL-3.0-only
// The Hardware workspace: holes in a printed part for the hardware it takes
// — screw clearances with counterbores or countersinks, nut traps and side
// slots, heat-set inserts, pilots, magnets and bearings — sized from the
// standards with a printing allowance and cut into Reverse Engineer bodies
// as editable features; parts encased mid-print, with the layer the print
// pauses at for each. See README.md.

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
    title: 'Holes for screws, nuts, inserts, magnets and bearings, sized for printing; parts encased mid-print',
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
      sections: [{ key: 'hw', capture: () => ({ ...settingsOf(useHw.getState()), embeds: useHw.getState().embeds }), apply: (v) => useHw.setState(v as Partial<ReturnType<typeof useHw.getState>>) }],
      actions: [{ store: useHw, label: 'Hardware', names: ['set', 'setEmbeds'], labels: { setEmbeds: 'encased parts' } }],
    })
    registerGuide({
      id: 'hw',
      title: 'Holes for hardware',
      when: 'asked to put holes in a printed part for screws, bolts, nuts, heat-set inserts, magnets or bearings — clearance, counterbore, countersink, nut trap, insert or press-fit sizes — or what an existing hole fits; or to encase a nut, magnet, bearing, insert, weight, tag or other part inside a print, with a pause to drop it in',
      text: () => import('./guides/hw.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
