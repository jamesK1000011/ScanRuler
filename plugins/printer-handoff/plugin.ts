// SPDX-License-Identifier: AGPL-3.0-only
// printer-handoff: a sliced job onto a printer, from ScanRuler. The work is
// the MCP server's (printer_* tools in mcp/src/extras, listed when
// SCANRULER_MCP_EXTRAS names "printer"): a page cannot reach a printer's
// MQTT or FTPS, and a start must be the person's own. What the page carries
// is the guide an agent reads first, and — with SCANRULER_CONFIRM=app —
// the card that asks the person to start a print, in ScanRuler itself.

import { registerCommands, registerGuide, type ScanRulerPlugin } from '../../src/plugins/api'
import { askCommand } from './app/askCommand'
import { usePrinterPlugin } from './app/usePrinterPlugin'

const plugin: ScanRulerPlugin = {
  id: 'printer-handoff',
  name: 'Printer hand-off',
  workspace: {
    id: 'print',
    label: 'Print',
    title: 'Start requests from the agent, and their answers: a print starts only on your Start',
    icon: 'model',
    order: 43,
  },
  usePlugin: usePrinterPlugin,
  install() {
    registerCommands('printer', [askCommand])
    registerGuide({
      id: 'printer-handoff',
      title: 'Sending a print to a printer',
      when: 'putting a sliced job on a printer — setting one up (Bambu Lab on the LAN or through Bambu Studio, Klipper, OctoPrint, PrusaLink, an SD card), uploading, asking the person to start it, and watching, pausing or stopping it',
      text: () => import('./guides/printer-handoff.md?raw').then((m) => m.default),
    })
  },
}

export default plugin
