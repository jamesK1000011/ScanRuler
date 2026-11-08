// SPDX-License-Identifier: AGPL-3.0-only
// dfm-fdm: a part checked for FDM printing against a rule pack you can read
// and change, stacked from nozzle, material and printer profiles and the
// project's own changes, or a published guide's. The Printability
// workspace is its panel; its commands (dfm.*) work on the scan or the
// reference part from any workspace.

import { pick, registerHistory } from '../../src/state/historyStore'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { dfmCommands } from './app/dfmCommands'
import { dfmSection } from './app/projectSection'
import { useDfmPlugin } from './app/useDfmPlugin'
import { useDfm } from './state/dfmStore'

const plugin: ScanRulerPlugin = {
  id: 'dfm-fdm',
  name: 'Printability check',
  workspace: {
    id: 'dfm',
    label: 'Printability',
    title: 'Check a part for FDM printing against nozzle, material and printer rules, or a guide',
    icon: 'slice',
    order: 30,
    group: 'make',
  },
  usePlugin: useDfmPlugin,
  install() {
    registerProjectSection(dfmSection)
    // The panel's edits and the agent's are steps of the app's undo, like
    // any other: Ctrl+Z takes back the last of them, not a body elsewhere.
    registerHistory({
      sections: [{ key: 'dfm-fdm', capture: () => pick(useDfm.getState(), ['settings', 'overrides', 'waivers', 'guides']), apply: (v) => useDfm.setState(v as Partial<ReturnType<typeof useDfm.getState>>) }],
      actions: [{ store: useDfm, label: 'Printability', names: ['set', 'setOverride', 'addGuide', 'removeGuide', 'waive', 'unwaive'] }],
    })
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
