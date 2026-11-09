// SPDX-License-Identifier: AGPL-3.0-only
// Make › Order: a circuit board ordered from a board house — the PCB order
// setup, its page and its commands (pcbo.check, pcbo.package). The board is
// Electronics' (KiCad or tscircuit), reached through their commands; the
// board's enclosure is a part of its own, made by a print, cut or mill
// setup. See README.md.

import { registerCommands, registerGuide, type ScanRulerPlugin } from '../../src/plugins/api'
import { MAKE } from '../_shared/workspaces'
import { registerSetupType } from '../_shared/setups'
import { PCB_ORDER_SETUP } from './app/orderSetup'
import { OrderSettings } from './ui/OrderSettings'
import { pcboCommands } from './app/pcboCommands'
import { usePcbOrderPlugin } from './app/usePcbOrderPlugin'

/** The setup type with its settings on the Make tab. */
const SETUP = { ...PCB_ORDER_SETUP, Settings: OrderSettings }

const plugin: ScanRulerPlugin = {
  id: 'pcb-order',
  name: 'Board order',
  workspace: {
    // A PCB order setup's one page on the Make tab.
    id: 'pcbo',
    label: 'Order',
    title: 'A board from a board house: check it, package it',
    icon: 'board',
    order: 20,
    host: MAKE,
  },
  usePlugin: usePcbOrderPlugin,
  install() {
    registerSetupType(SETUP)
    registerCommands('pcbo', pcboCommands)
    registerGuide({
      id: 'pcb-order',
      title: 'Ordering a circuit board',
      when: 'ordering a KiCad or tscircuit board from a board house (JLCPCB, PCBWay, OSH Park): checking it against the fab, its Gerbers, drill files, BOM and CPL for assembly, and the order sheet',
      text: () => import('./guides/pcb-order.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
