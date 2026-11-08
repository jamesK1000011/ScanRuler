// SPDX-License-Identifier: AGPL-3.0-only
// What the Circuit commands reach outside the plugin, faked for their test:
// the command registry (other workspaces' commands as a test sets them, and
// the Circuit commands themselves), the schema builders, the session's
// state sections, CommandError, the line to the agent's server — asks
// answered as the test says — and the solids worker's client.
import type { SolidsAnswer, SolidsAsk } from '../core/circuitWorker'

export const handlers: Record<string, (input: never) => unknown> = {}
export const calls: { name: string; input: Record<string, unknown> }[] = []
export async function runCommand(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
  calls.push({ name, input })
  const h = handlers[name]
  if (!h) throw new Error(`No command ${name}.`)
  return h(input as never)
}
/** A change run within another, as the registry does it. */
export const runWithin = runCommand

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

// ---- the server ----
export class Cancelled extends Error {
  constructor() {
    super('Cancelled.')
  }
}
export const asked: { action: string; args: Record<string, unknown> }[] = []
export const answers: Record<string, (args: Record<string, unknown>) => unknown> = {}
export function askServer<T>(action: string, args: Record<string, unknown> = {}, opts: { signal?: AbortSignal; progress?: (p: string, d: string) => void } = {}): Promise<T> {
  asked.push({ action, args })
  return new Promise<T>((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Cancelled())
    opts.signal?.addEventListener('abort', () => reject(new Cancelled()), { once: true })
    const a = answers[action]
    if (!a) return // Waits until stopped.
    opts.progress?.('build', 'tsci build')
    Promise.resolve()
      .then(() => a(args))
      .then((v) => resolve(v as T), reject)
  })
}
export const answered = () => true
export const progressed = () => true

// ---- the worker ----
export const solids: { ask: Omit<SolidsAsk, 'id'> }[] = []
export let solidsAnswer: SolidsAnswer | null = null
export const setSolidsAnswer = (a: SolidsAnswer | null) => (solidsAnswer = a)
export async function build(ask: Omit<SolidsAsk, 'id'>): Promise<SolidsAnswer> {
  solids.push({ ask })
  if (!solidsAnswer) throw new Error('no answer set')
  return solidsAnswer
}
export function stop(): void {}
export const busy = () => false
