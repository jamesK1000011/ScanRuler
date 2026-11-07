// SPDX-License-Identifier: AGPL-3.0-only
// library-pack: a finished part bundled for sharing — model files, renders,
// a README, licence and attribution — with each upstream part's licence
// checked and personal details scrubbed out. It builds a zip on this
// computer; the person uploads it. Its commands are pack.*.

import { registerProjectSection } from '../../src/app/projectSections'
import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { packCommands } from './app/packCommands'
import { packSection } from './app/projectSection'
import { usePack } from './state/packStore'
import { usePackPlugin } from './app/usePackPlugin'

const plugin: ScanRulerPlugin = {
  id: 'library-pack',
  name: 'Library pack',
  workspace: {
    id: 'pack',
    label: 'Share',
    title: 'Pack a finished part to share: licences checked, remixes credited, personal details taken out — a zip you upload yourself',
    icon: 'save',
    order: 42,
  },
  usePlugin: usePackPlugin,
  install() {
    registerProjectSection(packSection)
    registerCommands('pack', packCommands)
    registerStateSection('pack', () => {
      const s = usePack.getState()
      return { title: s.settings.title, licence: s.settings.licence, platform: s.settings.platform, upstream: s.upstream.length, added: s.added.map((a) => a.name) }
    })
    registerGuide({
      id: 'library-pack',
      title: 'Packing a part to share',
      when: 'the user wants to share or publish a part — on Printables, Thangs, MakerWorld, Thingiverse or anywhere — with its files, renders, README, licence and credit to the parts it remixes, and nothing private left in the files',
      text: () => import('./guides/library-pack.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
