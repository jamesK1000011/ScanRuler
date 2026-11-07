// SPDX-License-Identifier: AGPL-3.0-only
// catalog: which standard part a scan is, where to find a part's CAD, and
// where each file brought in came from. The page's part is offline; the
// downloads come in through the MCP server's catalog_* tools (extras,
// SCANRULER_MCP_EXTRAS=catalog).

import { registerProjectSection } from '../../src/app/projectSections'
import { registerCommands, registerGuide, registerStateSection, type ScanRulerPlugin } from '../../src/plugins/api'
import { catalogCommands } from './app/catalogCommands'
import { catalogSection } from './app/projectSection'
import { useCatalog } from './state/catalogStore'

const plugin: ScanRulerPlugin = {
  id: 'catalog',
  name: 'Parts catalog',
  install() {
    registerProjectSection(catalogSection)
    registerCommands('catalog', catalogCommands)
    registerStateSection('catalog', () => ({ parts: useCatalog.getState().parts.map((p) => ({ file: p.file, source: p.source, redistribute: p.redistribute, ...(p.url ? { url: p.url } : {}), ...(p.licence ? { licence: p.licence } : {}) })) }))
    registerGuide({
      id: 'catalog',
      title: 'Finding a part: standard sizes, catalogues and model libraries',
      when: 'naming a standard part from a scan (screw, nut, washer, bearing), finding a part’s CAD on TraceParts, McMaster, MISUMI, Printables, Thangs or GrabCAD, bringing the download into the project with its licence, and building a replacement or a repair from it',
      text: () => import('./guides/catalog.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
