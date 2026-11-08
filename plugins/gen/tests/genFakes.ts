// SPDX-License-Identifier: AGPL-3.0-only
// What the Generate commands reach outside the plugin, faked for their
// test: the command registry (Reverse Engineer's import.step and body.set
// as a test sets them), the schema builders, the session's state
// sections, CommandError, and the worker's client — builds that finish
// when the test says.
import type { GenAnswer, GenAsk } from '../core/genWorker'

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

/** Builds asked for, in order, each finished or failed by the test. */
export const builds: { ask: Omit<GenAsk, 'id'>; done(a: GenAnswer): void; fail(e: Error): void }[] = []
export function build(ask: Omit<GenAsk, 'id'>): Promise<GenAnswer> {
  return new Promise((done, fail) => builds.push({ ask, done, fail }))
}
export function stop(why = 'Stopped.'): void {
  for (const b of builds.splice(0)) b.fail(new Error(why))
}
export const busy = () => builds.length > 0
