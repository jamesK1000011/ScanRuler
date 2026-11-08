// SPDX-License-Identifier: AGPL-3.0-only
// assembly-manual: step-by-step build instructions from an assembly you
// declare — a line drawing a step, the parts and tools it takes, and short
// instructions in a controlled style — saved as HTML and PDF. Its commands
// (asm.*) work on the bodies in Reverse Engineer, in their assembled places.

import { pick, registerHistory } from '../../src/state/historyStore'
import { registerProjectSection } from '../../src/app/projectSections'
import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { asmCommands } from './app/asmCommands'
import { asmSection } from './app/projectSection'
import { useAsm } from './state/asmStore'
import { useAsmPlugin } from './app/useAsmPlugin'

const plugin: ScanRulerPlugin = {
  id: 'assembly-manual',
  name: 'Assembly manual',
  workspace: {
    id: 'assembly',
    label: 'Manual',
    title: 'Step-by-step build instructions: fit checked, steps drawn and worded, HTML and PDF',
    icon: 'manual',
    order: 40,
    group: 'share',
  },
  usePlugin: useAsmPlugin,
  install() {
    registerProjectSection(asmSection)
    // The panel's edits and the agent's are steps of the app's undo, like
    // any other: Ctrl+Z takes back the last of them, not a body elsewhere.
    registerHistory({
      sections: [{ key: 'assembly-manual', capture: () => pick(useAsm.getState(), ['settings', 'parts', 'steps', 'style']), apply: (v) => useAsm.setState(v as Partial<ReturnType<typeof useAsm.getState>>) }],
      actions: [{ store: useAsm, label: 'Manual', names: ['set'] }],
    })
    registerCommands('asm', asmCommands)
    registerStateSection('asm', () => {
      const s = useAsm.getState()
      return { parts: s.parts.length, steps: s.steps.length, style: s.style.name, title: s.settings.title }
    })
    registerGuide({
      id: 'assembly-manual',
      title: 'Writing assembly instructions',
      when: 'the user wants build or assembly instructions, an exploded step-by-step manual, or a bill of materials for parts modelled in Reverse Engineer',
      text: () => import('./guides/assembly-manual.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
