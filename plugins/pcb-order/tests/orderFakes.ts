// SPDX-License-Identifier: AGPL-3.0-only
// What the Order commands reach outside the plugin, faked for their test:
// the command registry (Electronics' and Reverse Engineer's commands as a
// test answers them), the schema builders, the session's parts (setups,
// KiCad's, tscircuit's, Reverse Engineer's bodies) and CommandError.

export const handlers: Record<string, (input: never) => unknown> = {}
export const calls: { name: string; input: Record<string, unknown> }[] = []
export async function runCommand(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  calls.push({ name, input })
  const h = handlers[name]
  if (!h) throw new CommandError('unknown_command', `There is no command "${name}".`)
  return h(input as never)
}
export const runWithin = runCommand

const schema = (..._args: unknown[]) => ({})
export const arr = schema, enumOf = schema, int = schema, num = schema, obj = schema, str = schema, anyObject = schema, bool = schema, bytes = schema, oneOf = schema

export const sections: Record<string, () => unknown> = {}
export const readStateSection = (id: string) => sections[id]?.()
export const readStateSections = () => Object.fromEntries(Object.entries(sections).map(([k, f]) => [k, f()]))

export class CommandError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
