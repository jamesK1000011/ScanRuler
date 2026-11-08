// SPDX-License-Identifier: AGPL-3.0-only
// What the Mass commands reach outside the plugin, faked for their test:
// the command registry (Reverse Engineer's export.stl and feature.add as a
// test sets them), the schema builders, the session's state sections, and
// CommandError.

export const handlers: Record<string, (input: never) => unknown> = {}
export const calls: { name: string; input: Record<string, unknown> }[] = []
export async function runCommand(name: string, input: Record<string, unknown>): Promise<unknown> {
  calls.push({ name, input })
  const h = handlers[name]
  if (!h) throw new Error(`No command ${name}.`)
  return h(input as never)
}

const schema = (..._args: unknown[]) => ({})
export const arr = schema, enumOf = schema, int = schema, num = schema, obj = schema, str = schema, vec3 = schema, anyObject = schema, bool = schema

export const sections: { reverse?: () => unknown } = {}
export const readStateSections = () => ({ reverse: sections.reverse?.() }) as Record<string, unknown>

export class CommandError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
