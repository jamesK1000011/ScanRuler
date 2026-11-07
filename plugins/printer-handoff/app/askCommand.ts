// SPDX-License-Identifier: AGPL-3.0-only
// printer.ask: how the agent's server puts a start request in front of the
// person in ScanRuler, with SCANRULER_CONFIRM=app. It shows a card; only the
// person's Start on it starts the print. It can't start one itself.

import { obj, str } from '../../../src/commands/schema'
import { type Command, CommandError } from '../../../src/plugins/api'
import { useAsks } from '../state/askStore'

export const askCommand: Command<{ request: string; printer: string; file: string; summary?: Record<string, string>; answer: string }> = {
  name: 'ask',
  title: 'Show a print start request',
  description: 'Used by the agent’s server (printer_start with SCANRULER_CONFIRM=app): shows the person a card in ScanRuler with the printer and file, and Start and Cancel. Only the person’s Start starts the print; this cannot.',
  input: obj({ request: str(), printer: str(), file: str(), summary: { type: 'object', description: 'time, filament, size' }, answer: str('The server’s one-time address for the answer.') }, ['request', 'printer', 'file', 'answer']),
  readOnly: true,
  history: false,
  internal: true,
  run: async ({ request, printer, file, summary, answer }) => {
    if (!/^http:\/\/127\.0\.0\.1:\d+\/confirm\/[A-Za-z0-9_-]{20,}$/.test(answer)) throw new CommandError('invalid_input', 'Not an answer address of this computer’s server.')
    useAsks.getState().add({ request, printer, file, summary: summary ?? {}, answer, status: 'waiting', at: new Date().toISOString() })
    return { shown: true }
  },
}
