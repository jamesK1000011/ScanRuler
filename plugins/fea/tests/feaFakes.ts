// SPDX-License-Identifier: AGPL-3.0-only
// The command registry as the FEA commands reach it, faked for their
// test: commands answered as a test sets them, one missing refused as the
// registry refuses it.

import { CommandError } from '../../../src/commands/types'

export const handlers: Record<string, (input: never) => unknown> = {}
export async function runCommand(name: string, input: Record<string, unknown>): Promise<unknown> {
  const h = handlers[name]
  if (!h) throw new CommandError('unknown_command', `There is no command "${name}".`)
  return h(input as never)
}
export const runWithin = runCommand
export const registerCommands = () => () => {}
export const registerSettle = () => () => {}
export const runningChange = () => null
