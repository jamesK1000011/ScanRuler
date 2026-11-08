// SPDX-License-Identifier: AGPL-3.0-only
// scanner-profiles: which scanner a scan came from and how noisy it is —
// read off the scan, or from a profile you keep — for the thresholds other
// plugins set as a multiple of the noise. A section of the 3D Measure
// panel runs its commands.

import { registerProjectSection } from '../../src/app/projectSections'
import { registerCommands, registerGuide, registerPanelSection, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { scannerCommands } from './app/scannerCommands'
import { scannerSection } from './app/projectSection'
import { noiseNow, useScanner } from './state/scannerStore'
import { ScannerSection } from './ui/ScannerSection'

const plugin: ScanRulerPlugin = {
  id: 'scanner-profiles',
  name: 'Scanner profiles',
  install() {
    registerProjectSection(scannerSection)
    registerCommands('scanner', scannerCommands)
    registerPanelSection({ id: 'scanner-profiles', slot: 'measure', order: 10, Section: ScannerSection })
    registerStateSection('scanner', () => ({ using: useScanner.getState().using?.name ?? null, profiles: useScanner.getState().profiles.map((p) => p.name), noise: noiseNow() }))
    registerGuide({
      id: 'scanner-profiles',
      title: 'Scanner profiles and scan noise',
      when: 'setting which scanner a scan came from, or how noisy it is, before choosing tolerances or thresholds',
      text: () => import('./guides/scanner-profiles.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
