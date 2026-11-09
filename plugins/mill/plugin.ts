// SPDX-License-Identifier: AGPL-3.0-only
// mill: parts machined on a CNC mill — basic, no toolpaths. It brings the
// mill setup (registerSetupType: its settings, the check part.review runs
// on a part in it, the IT grade Fits sizes with) and its page on the Make
// tab, Mill; its commands (mill.*) run headless, on Reverse Engineer's
// bodies through its commands. See README.md.

import { registerCommands, registerGuide, type ScanRulerPlugin } from '../../src/plugins/api'
import { MAKE } from '../_shared/workspaces'
import { registerSetupType } from '../_shared/setups'
import { millCommands } from './app/millCommands'
import { MILL_SETUP } from './app/millSchemas'
import { useMillPlugin } from './app/useMillPlugin'

const plugin: ScanRulerPlugin = {
  id: 'mill',
  name: 'CNC milling',
  workspace: {
    id: 'mill',
    label: 'Mill',
    title: 'Milled parts: reach, corners, depth; STEP and setup sheet',
    icon: 'opCut',
    order: 5,
    host: MAKE,
  },
  usePlugin: useMillPlugin,
  install() {
    registerSetupType(MILL_SETUP)
    registerCommands('mill', millCommands)
    registerGuide({
      id: 'mill',
      title: 'Machining a part on a CNC mill',
      when: 'a part milled on a 3-axis or 3+2 machine: undercuts and the tool directions, inside corners and the least tool, deep holes and pockets, thin walls, the stock, the IT grade fits are sized with, and the STEP and setup sheet for the machinist',
      text: () => import('./guides/mill.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
