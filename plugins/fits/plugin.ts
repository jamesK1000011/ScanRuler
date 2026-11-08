// SPDX-License-Identifier: AGPL-3.0-only
// The Fits workspace: fits between printed parts — a hole and shaft sized
// for a slip or press fit with the printer's allowance, a cantilever
// snap-fit hook worked out from the beam formulas, a print-in-place hinge,
// a pin and socket, a tolerance stack — calibrated to the printer with a
// test coupon, and made as solids in Reverse Engineer. Its commands sit
// under fit.*, beside Print fit's. See README.md.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerHistory } from '../../src/state/historyStore'
import { describeFits, fitsCommands, refreshAnswers } from './app/fitsCommands'
import { fitsSection } from './app/projectSection'
import { useFitsPlugin } from './app/useFitsPlugin'
import { historyOf, useFits } from './state/fitsStore'

const plugin: ScanRulerPlugin = {
  id: 'fits',
  name: 'Fits',
  workspace: {
    id: 'fits',
    label: 'Fits',
    title: 'Press, slip and snap fits, print-in-place hinges and tolerance stacks, calibrated to your printer',
    icon: 'concentric',
    order: 17,
    group: 'model',
  },
  usePlugin: useFitsPlugin,
  install() {
    registerProjectSection(fitsSection)
    // fit.* is shared with Print fit (fit-comp): the verbs differ.
    registerCommands('fit', fitsCommands)
    registerStateSection('fits', describeFits)
    registerHistory({
      sections: [{ key: 'fits', capture: () => historyOf(useFits.getState()), apply: (v) => useFits.setState(v as Partial<ReturnType<typeof useFits.getState>>) }],
      actions: [{ store: useFits, label: 'Fits', names: ['set'] }],
    })
    // The answers on show follow the settings and calibration, however
    // they change: a command, an undo, a project opened.
    useFits.subscribe((s, prev) => {
      if (s.settings !== prev.settings || s.calibration !== prev.calibration) refreshAnswers()
    })
    registerGuide({
      id: 'fits',
      title: 'Fits for printed parts',
      when: 'asked how big to make a hole or a peg so printed parts slide, turn or press together; to design a snap-fit hook or clip, a print-in-place hinge, or a pin and socket; to add up a tolerance stack; or to calibrate clearances to a printer with a test print',
      text: () => import('./guides/fits.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
