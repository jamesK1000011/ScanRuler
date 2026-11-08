// SPDX-License-Identifier: AGPL-3.0-only
// fit-comp: a scanned print read against the CAD it was printed from, and
// what to change — slicer settings, or a pre-compensated model — so the next
// print fits. Its page is the Fits tab's Calibrate from a scan; the
// Deviation workspace opens and aligns the two, and fit.* reads them. A run
// that fits well becomes the printer's one calibration, the one Fits'
// Design page sizes holes and shafts with.

import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { registerProjectSection } from '../../src/app/projectSections'
import { fitCommands } from './app/fitCommands'
import { fitSection } from './app/projectSection'
import { useFit } from './state/fitStore'
import { useFitCompPlugin } from './app/useFitCompPlugin'
import { FITS } from '../_shared/workspaces'

const plugin: ScanRulerPlugin = {
  id: 'fit-comp',
  name: 'Print fit',
  workspace: {
    // A page of the Fits tab, beside Design (fits).
    id: 'fit-scan',
    label: 'Calibrate from a scan',
    title: 'Measure a scanned print against its CAD',
    icon: 'compare',
    order: 2,
    host: FITS,
  },
  usePlugin: useFitCompPlugin,
  install() {
    registerProjectSection(fitSection)
    registerCommands('fit', fitCommands)
    registerStateSection('fit', () => {
      const s = useFit.getState()
      const last = s.runs.at(-1)
      return {
        settings: { up: s.settings.up, slicer: s.settings.slicer, printer: s.settings.printer, material: s.settings.material, inner: s.settings.inner, ignore: s.settings.ignore },
        runs: s.runs.length,
        ...(last ? { last: { run: last.n, reference: last.reference, fit: last.solution.fit, scaleXY: Math.round(((last.solution.scale.x.value + last.solution.scale.y.value) / 2) * 1e5) / 1e5, contourOffset: Math.round(last.solution.contour.value * 1e4) / 1e4, holeOffset: Math.round(last.solution.hole.value * 1e4) / 1e4 } } : {}),
        profiles: s.profiles.map((p) => p.name),
      }
    })
    registerGuide({
      id: 'fit-comp',
      title: 'Making prints fit: from a scanned print to slicer settings',
      when: 'a printed part came out too big, too small, with tight holes or an elephant foot, and you have its CAD and a scan of the print: measuring scale, contour and hole offsets and the first layer, and turning them into OrcaSlicer, Bambu Studio or PrusaSlicer settings or a pre-compensated model',
      text: () => import('./guides/fit-comp.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
