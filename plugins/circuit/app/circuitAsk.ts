// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › tscircuit's line to the agent's server, which runs tscircuit's
// command line (tsci) on this computer: an ask goes as a notice
// (circuit.tsci), how far a build has got comes back as circuit.progress,
// the answer as circuit.answer (the internal commands of the same names).

import { notifyAgent } from '../../../src/plugins/api'
import { useAgentLink } from '../../../src/commands/agentLink'

export type Action = 'tools' | 'new' | 'build' | 'files' | 'read'
type Answer = { req: string; ok: boolean; result?: unknown; error?: string }

export class Cancelled extends Error {
  constructor() {
    super('Cancelled.')
  }
}

const waiting = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; progress?: (phase: string, detail: string) => void }>()
let n = 0

/** Ask the server; signal stops waiting and tells the server to stop. A
 *  build may take minutes: the wait is long, and ends at once if the
 *  connection closes. */
export function askServer<T>(action: Action, args: Record<string, unknown> = {}, { signal, timeoutMs = 15 * 60_000, progress }: { signal?: AbortSignal; timeoutMs?: number; progress?: (phase: string, detail: string) => void } = {}): Promise<T> {
  const link = useAgentLink.getState()
  if (link.status !== 'connected') return Promise.reject(new Error('tscircuit runs on your computer through the agent connection: switch it on in Settings → Agents.'))
  if (!link.server?.features?.includes('circuit.tsci')) return Promise.reject(new Error('The agent’s server running now is older than this page and does not run tscircuit. Quit the agent app completely and open it again, then reload this page.'))
  if (signal?.aborted) return Promise.reject(new Cancelled())
  const req = `c${Date.now().toString(36)}${(n++).toString(36)}`
  return new Promise<T>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer)
      waiting.delete(req)
      signal?.removeEventListener('abort', cancel)
      unlink()
    }
    const stopServer = () => notifyAgent('circuit.tsci', { req: `${req}x`, action: 'cancel', of: req })
    const cancel = () => {
      done()
      stopServer()
      reject(new Cancelled())
    }
    const timer = setTimeout(() => {
      done()
      stopServer()
      reject(new Error(`No answer in ${Math.round(timeoutMs / 60_000)} min.`))
    }, timeoutMs)
    const unlink = useAgentLink.subscribe((s) => {
      if (s.status === 'connected') return
      done()
      reject(new Error('The agent connection closed before the answer came.'))
    })
    signal?.addEventListener('abort', cancel, { once: true })
    waiting.set(req, { resolve: (v) => (done(), resolve(v as T)), reject: (e) => (done(), reject(e)), progress })
    notifyAgent('circuit.tsci', { req, action, args })
  })
}

export function answered(a: Answer): boolean {
  const w = waiting.get(a.req)
  if (!w) return false
  if (a.ok) w.resolve(a.result)
  else w.reject(Object.assign(new Error(a.error || 'tscircuit did not answer.'), { result: a.result }))
  return true
}

export function progressed(p: { req: string; phase: string; detail?: string }): boolean {
  const w = waiting.get(p.req)
  if (!w) return false
  w.progress?.(p.phase, p.detail ?? '')
  return true
}
