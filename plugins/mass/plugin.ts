// SPDX-License-Identifier: AGPL-3.0-only
// The Mass workspace: what a printed part weighs, where it balances and how
// it turns, from its Reverse Engineer bodies — and the ballast pocket that
// brings it to a target. See README.md.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerHistory } from '../../src/state/historyStore'
import { describeMass, massCommands } from './app/massCommands'
import { massSection } from './app/projectSection'
import { useMassPlugin } from './app/useMassPlugin'
import { setupOf, useMass } from './state/massStore'

const plugin: ScanRulerPlugin = {
  id: 'mass',
  name: 'Mass and balance',
  workspace: {
    id: 'mass',
    label: 'Mass',
    title: 'Weight, balance point and inertia as printed; ballast to match a target',
    icon: 'count',
    order: 33,
    group: 'make',
  },
  usePlugin: useMassPlugin,
  install() {
    registerProjectSection(massSection)
    registerCommands('mass', massCommands)
    registerStateSection('mass', describeMass)
    registerHistory({
      sections: [{ key: 'mass', capture: () => setupOf(useMass.getState()), apply: (v) => useMass.setState(v as Partial<ReturnType<typeof useMass.getState>>) }],
      actions: [{ store: useMass, label: 'Mass', names: ['set'] }],
    })
    registerGuide({
      id: 'mass',
      title: 'Weight, balance and ballast',
      when: 'asked what a printed part will weigh, where it balances, its inertia, or how to make a replica weigh and balance like the real thing — ballast pockets for BBs, lead or tungsten',
      text: () => import('./guides/mass.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
