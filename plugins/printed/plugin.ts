// SPDX-License-Identifier: AGPL-3.0-only
// Electronics' Printed wiring page: circuits made inside a printed part —
// traces of conductive filament as a body of their own, cut out of the
// part, for a two-filament print; or channels for copper wire, tape or
// paint, open or closed with a pause to lay the wire — each net's
// resistance worked out, along and through the layers. See README.md.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerHistory } from '../../src/state/historyStore'
import { describePrinted, printedCommands } from './app/printedCommands'
import { printedSection } from './app/projectSection'
import { usePrintedPlugin } from './app/usePrintedPlugin'
import { settingsOf, usePrinted } from './state/printedStore'
import { ELECTRONICS } from '../_shared/workspaces'

const plugin: ScanRulerPlugin = {
  id: 'printed',
  name: 'Printed circuits',
  workspace: {
    // A page of Electronics; the id it has always had, which projects keep.
    id: 'printed',
    label: 'Printed wiring',
    title: 'Conductive traces or copper channels inside a print',
    icon: 'spline',
    order: 3,
    host: ELECTRONICS,
  },
  usePlugin: usePrintedPlugin,
  install() {
    registerProjectSection(printedSection)
    registerCommands('printed', printedCommands)
    registerStateSection('printed', describePrinted)
    registerHistory({
      sections: [{ key: 'printed', capture: () => ({ ...settingsOf(usePrinted.getState()), made: usePrinted.getState().made }), apply: (v) => usePrinted.setState(v as Partial<ReturnType<typeof usePrinted.getState>>) }],
      actions: [{ store: usePrinted, label: 'Circuits', names: ['set', 'setMade'], labels: { setMade: 'circuits made' } }],
    })
    registerGuide({
      id: 'printed',
      title: 'Printed circuits',
      when: 'asked to put a circuit, traces, wiring or conductors inside a printed part — conductive filament (Protopasta, Electrifi) printed with a second filament, or channels and tunnels for copper wire, copper tape or conductive paint — or the resistance of a printed trace or a wire by gauge',
      text: () => import('./guides/printed.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
