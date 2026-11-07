// SPDX-License-Identifier: AGPL-3.0-only
// thread-match: a scanned thread named against the standards, or the honest
// answer that this scan can't tell two of them apart and the measurement
// that would. No workspace of its own: its commands (thread.*) work on the
// scan and on Reverse Engineer bodies, through reverse.thread.read.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { threadCommands } from './app/threadCommands'
import { useThreadMatch } from './state/threadStore'

const plugin: ScanRulerPlugin = {
  id: 'thread-match',
  name: 'Thread match',
  install() {
    registerCommands('thread', threadCommands)
    registerStateSection('thread', () => {
      const s = useThreadMatch.getState()
      return { families: s.families, pitchFloor: s.pitchFloor, last: s.last }
    })
    registerGuide({
      id: 'thread-match',
      title: 'Identifying a scanned thread',
      when: 'naming a thread on a scanned bore or boss (metric, UNC/UNF/UNEF, NPT, G/BSPP, R/BSPT, trapezoidal, ACME, 3D-print form), telling close sizes apart, and asking the person for the one measurement that settles it',
      text: () => import('./guides/thread-match.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
