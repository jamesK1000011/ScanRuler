// SPDX-License-Identifier: AGPL-3.0-only
// patent-kit: a starting draft to take to a patent attorney — line drawings
// with reference numerals laid out to 37 CFR 1.84, and a draft description
// tied to the same numerals. Everything stays in the project and on this
// computer: no filing, no upload, no network. Its commands (patent.*) work
// on the bodies in Reverse Engineer.

import { pick, registerHistory } from '../../src/state/historyStore'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { patentCommands } from './app/patentCommands'
import { patentSection } from './app/projectSection'
import { usePatent } from './state/patentStore'
import { usePatentPlugin } from './app/usePatentPlugin'
import { DOCS } from '../_shared/workspaces'

const plugin: ScanRulerPlugin = {
  id: 'patent-kit',
  name: 'Patent kit',
  workspace: {
    id: 'patent',
    label: 'Patent',
    title: 'Patent drawings with numerals, and a draft',
    icon: 'patent',
    order: 2,
    group: 'share',
    host: DOCS,
  },
  usePlugin: usePatentPlugin,
  install() {
    registerProjectSection(patentSection)
    // The panel's edits and the agent's are steps of the app's undo, like
    // any other: Ctrl+Z takes back the last of them, not a body elsewhere.
    registerHistory({
      sections: [{ key: 'patent-kit', capture: () => pick(usePatent.getState(), ['settings', 'figures', 'numerals', 'draft']), apply: (v) => usePatent.setState(v as Partial<ReturnType<typeof usePatent.getState>>) }],
      actions: [{ store: usePatent, label: 'Patent', names: ['set'] }],
    })
    registerCommands('patent', patentCommands)
    registerStateSection('patent', () => {
      const s = usePatent.getState()
      return { figures: s.figures.length, numerals: s.numerals.length, draftSections: Object.keys(s.draft), paper: s.settings.paper }
    })
    registerGuide({
      id: 'patent-kit',
      title: 'Patent drawings and a draft description for an attorney',
      when: 'the user wants patent drawings, reference numerals, or a draft patent description or claims for a part built in Reverse Engineer',
      text: () => import('./guides/patent-kit.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
