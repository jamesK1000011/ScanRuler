// SPDX-License-Identifier: AGPL-3.0-only
// What the Boards commands reach outside the plugin, faked for their test:
// the command registry (Reverse Engineer's and Generate's commands as a test
// sets them), the schema builders, the state sections, CommandError, and the
// line to the agent's server — asks the test answers.

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
export const arr = schema, enumOf = schema, int = schema, num = schema, obj = schema, str = schema, vec3 = schema, anyObject = schema, bool = schema, bytes = schema, oneOf = schema

export const sections: { reverse?: () => unknown } = {}
export const readStateSections = () => ({ reverse: sections.reverse?.() }) as Record<string, unknown>

export class CommandError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}
export const notifyAgent = () => {}

/** The server's answers, by action: a function of what was asked. */
export const server: Record<string, (data: Record<string, unknown>) => { result: unknown; bytes?: Uint8Array } | Promise<{ result: unknown; bytes?: Uint8Array }>> = {}
export const asked: { action: string; data: Record<string, unknown> }[] = []
export class Cancelled extends Error {
  constructor() {
    super('Stopped.')
  }
}
export async function askServer(action: string, data: Record<string, unknown> = {}, opts: { signal?: AbortSignal; progress?: (p: string, d: string) => void } = {}) {
  asked.push({ action, data })
  const h = server[action]
  if (!h) throw new Error(`The server does not ${action}.`)
  opts.progress?.(action, `${action}…`)
  return new Promise<{ result: unknown; bytes?: Uint8Array }>((resolve, reject) => {
    opts.signal?.addEventListener('abort', () => reject(new Cancelled()), { once: true })
    Promise.resolve(h(data)).then(resolve, reject)
  })
}
export const answered = () => false
export const progressed = () => false
