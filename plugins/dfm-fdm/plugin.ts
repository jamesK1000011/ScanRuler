// SPDX-License-Identifier: AGPL-3.0-only
// dfm-fdm: a part checked for FDM printing against a rule pack you can read
// and change, stacked from nozzle, material and printer profiles and the
// project's own changes. No workspace of its own: its commands (dfm.*) work
// on the scan or the reference part.

import { registerProjectSection } from '../../src/app/projectSections'
import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { dfmCommands } from './app/dfmCommands'
import { dfmSection } from './app/projectSection'
import { useDfm } from './state/dfmStore'

const plugin: ScanRulerPlugin = {
  id: 'dfm-fdm',
  name: 'Printability check',
  install() {
    registerProjectSection(dfmSection)
    registerCommands('dfm', dfmCommands)
    registerStateSection('dfm', () => {
      const s = useDfm.getState()
      const open = s.findings.filter((f) => !f.waived)
      return {
        settings: s.settings,
        overrides: Object.keys(s.overrides),
        waivers: s.waivers.length,
        ...(s.checkedAt ? { last: { at: s.checkedAt, errors: open.filter((f) => f.severity === 'error').length, warnings: open.filter((f) => f.severity === 'warning').length, waived: s.findings.length - open.length } } : {}),
      }
    })
    registerGuide({
      id: 'dfm-fdm',
      title: 'Checking a part for FDM printing',
      when: 'before printing a part, or when a print failed: thin walls, overhangs and ledges, bridges, small holes, bed contact, tall thin parts, cavities and broken meshes, against rules set for the nozzle, material and printer',
      text: () => import('./guides/dfm-fdm.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
