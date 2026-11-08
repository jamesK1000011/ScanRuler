// SPDX-License-Identifier: AGPL-3.0-only
// snapshot: a camera button over every workspace that takes a picture of
// this tab — panels, stage, dialogs, as the person sees them — for an
// agent to look at when something is wrong. The browser asks the person
// for the tab each time; the shots stay in the page's memory; an agent
// reads them (snapshot.latest, snapshot.list) and can never take one.

import { registerCommands, registerGuide, type ScanRulerPlugin } from '../../src/plugins/api'
import { shotCommands } from './app/shotCommands'
import { useSnapshotPlugin } from './app/useSnapshotPlugin'

const plugin: ScanRulerPlugin = {
  id: 'snapshot',
  name: 'Screenshot for the agent',
  usePlugin: useSnapshotPlugin,
  install() {
    registerCommands('snapshot', shotCommands)
    registerGuide({
      id: 'snapshot',
      title: 'Seeing what the person sees',
      when: 'the person says something looks wrong, or that they took a screenshot, or asks you to look at their screen',
      text: () => import('./guides/snapshot.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
