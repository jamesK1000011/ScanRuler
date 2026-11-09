// SPDX-License-Identifier: AGPL-3.0-only
// scanner-profiles (shown as Scanner noise): which scanner a scan came from,
// with its usual noise, and this scan's noise as the scan check reads it —
// the larger is what plugins that read scans plan with
// (plugins/_shared/scanNoise.ts). A section of the 3D Measure panel runs its
// commands. Not 2D Measure's scanner profiles, which keep a flatbed's scale.

import { registerProjectSection } from '../../src/app/projectSections'
import { registerCommands, registerGuide, registerPanelSection, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { scannerCommands, scannerState } from './app/scannerCommands'
import { scannerSection } from './app/projectSection'
import { ScannerSection } from './ui/ScannerSection'

const plugin: ScanRulerPlugin = {
  id: 'scanner-profiles',
  name: 'Scanner noise',
  install() {
    registerProjectSection(scannerSection)
    registerCommands('scanner', scannerCommands)
    registerPanelSection({ id: 'scanner-profiles', slot: 'measure', order: 10, Section: ScannerSection })
    registerStateSection('scanner', scannerState)
    registerGuide({
      id: 'scanner-profiles',
      title: 'Scanner noise',
      when: 'naming the scanner a scan came from, or reading how noisy the scan is, before choosing tolerances or thresholds — and with the scan-to-CAD guide, for its noise floor',
      text: () => import('./guides/scanner-profiles.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
