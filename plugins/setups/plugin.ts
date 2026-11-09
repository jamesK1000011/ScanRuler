// SPDX-License-Identifier: AGPL-3.0-only
// Setups: how each part of a build is made. A setup records a process —
// print today; cut, mill and a board ordered to come — and the bodies made
// by it, with that process's settings, as Fusion's setups do. The Make tab
// lists them over its pages, which are the chosen setup's type's. No
// workspace of its own: the pages are the other plugins'. Its commands go
// under setup. See README.md and plugins/_shared/setups.ts.

import { registerProjectSection } from '../../src/app/projectSections'
import { registerCommands, registerGuide, registerHostHeader, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerHistory } from '../../src/state/historyStore'
import { MAKE } from '../_shared/workspaces'
import { setupsSection } from './app/projectSection'
import { setupCommands } from './app/setupCommands'
import { useSetups } from './state/setupsStore'
import { MakeHeader } from './ui/MakeHeader'

const plugin: ScanRulerPlugin = {
  id: 'setups',
  name: 'Setups',
  install() {
    registerProjectSection(setupsSection)
    registerCommands('setup', setupCommands)
    // What the workspaces read through plugins/_shared/setups.ts.
    registerStateSection('setups', () => ({ setups: useSetups.getState().setups, selected: useSetups.getState().selected }))
    registerHistory({
      sections: [{ key: 'setups', capture: () => useSetups.getState().setups, apply: (v) => useSetups.getState().replace(v as ReturnType<typeof useSetups.getState>['setups']), compare: 'identity' }],
    })
    registerHostHeader({ host: MAKE.id, Header: MakeHeader })
    registerGuide({
      id: 'setups',
      title: 'How each part is made: setups',
      when: 'deciding or recording how a part is made — printed, cut, machined, ordered — and the printer, nozzle, layers and fit calibration of a printed one',
      text: () => import('./guides/setups.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
