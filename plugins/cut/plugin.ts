// SPDX-License-Identifier: AGPL-3.0-only
// cut: parts cut from sheet — laser, waterjet, plasma, or a router cutting
// through. It brings the cut setup (registerSetupType: its settings, the
// check part.review runs on a part in it, the kerf Fits sizes with) and
// its page on the Make tab, Cut; its commands (cut.*) run headless, on
// Reverse Engineer's bodies through its commands. See README.md.

import { registerCommands, registerGuide, type ScanRulerPlugin } from '../../src/plugins/api'
import { MAKE } from '../_shared/workspaces'
import { registerSetupType } from '../_shared/setups'
import { cutCommands } from './app/cutCommands'
import { CUT_SETUP } from './app/cutSchemas'
import { useCutPlugin } from './app/useCutPlugin'

const plugin: ScanRulerPlugin = {
  id: 'cut',
  name: 'Sheet cutting',
  workspace: {
    id: 'cut',
    label: 'Cut',
    title: 'Sheet parts: check, and outlines to cut as DXF or SVG',
    icon: 'sheet',
    order: 4,
    host: MAKE,
  },
  usePlugin: useCutPlugin,
  install() {
    registerSetupType(CUT_SETUP)
    registerCommands('cut', cutCommands)
    registerGuide({
      id: 'cut',
      title: 'Cutting parts from sheet',
      when: 'a part laser-, waterjet-, plasma- or router-cut from sheet: whether it is a sheet part, its thickness, kerf, narrow webs, slots and small holes, inside corners for a router, fitting the sheet, and the DXF or SVG to cut from',
      text: () => import('./guides/cut.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
