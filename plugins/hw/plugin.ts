// SPDX-License-Identifier: AGPL-3.0-only
// The Hardware workspace: holes in a printed part for the hardware it takes
// — screw clearances with counterbores or countersinks, nut traps and side
// slots, heat-set inserts, pilots, magnets and bearings — sized from the
// standards with a printing allowance and cut into Reverse Engineer bodies
// as editable features; parts encased mid-print, with the layer the print
// pauses at for each. See README.md.

import { registerCommands, registerGuide, registerPartDigest, registerStateSection, signatureOf, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { FITS } from '../_shared/workspaces'
import { registerHistory } from '../../src/state/historyStore'
import { describeHw, hwCommands } from './app/hwCommands'
import { hwSection } from './app/projectSection'
import { useHwPlugin } from './app/useHwPlugin'
import { settingsOf, useHw } from './state/hwStore'

const plugin: ScanRulerPlugin = {
  id: 'hw',
  name: 'Hardware',
  workspace: {
    // A page of the Fits tab, between Design and Calibrate from a scan: its
    // holes are sized by the same calibration. The id it has always had.
    id: 'hw',
    label: 'Hardware',
    title: 'Holes for screws, nuts, inserts, magnets, bearings',
    icon: 'hole',
    order: 2,
    host: FITS,
  },
  usePlugin: useHwPlugin,
  install() {
    registerProjectSection(hwSection)
    registerCommands('hw', hwCommands)
    registerStateSection('hw', describeHw)
    // The parts encased, for history.diff to tell one added, removed or moved.
    registerPartDigest('hw', () => ({ embeds: useHw.getState().embeds.map((e) => ({ id: `encased ${e.id}`, name: `${e.id} (${e.what} in ${e.body})`, sig: signatureOf(e) })) }))
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
