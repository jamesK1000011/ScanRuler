// SPDX-License-Identifier: AGPL-3.0-only
// What the Mass commands reach outside the plugin, faked for their test:
// the command registry (Reverse Engineer's export.stl and feature.add as a
// test sets them), the schema builders, the session's state sections (the
// setups among them), the undo history (a step run as it is), and
// CommandError.

export const handlers: Record<string, (input: never) => unknown> = {}
export const calls: { name: string; input: Record<string, unknown> }[] = []
export async function runCommand(name: string, input: Record<string, unknown>): Promise<unknown> {
  calls.push({ name, input })
  const h = handlers[name]
  if (!h) throw new CommandError('unknown_command', `There is no command "${name}".`)
  return h(input as never)
}

const schema = (..._args: unknown[]) => ({})
export const arr = schema, enumOf = schema, int = schema, num = schema, obj = schema, str = schema, vec3 = schema, anyObject = schema, bool = schema

export const sections: { reverse?: () => unknown; hw?: () => unknown; setups?: () => unknown } = {}
export const readStateSections = () => ({ reverse: sections.reverse?.(), hw: sections.hw?.(), setups: sections.setups?.() }) as Record<string, unknown>
export const readStateSection = (id: string) => readStateSections()[id]

export class CommandError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** A change run within another, as the registry does it. */
export const runWithin = runCommand

/** An undo step: the job run, as the history runs it. */
export const historyAsync = (_label: string, job: () => Promise<void>) => job()
