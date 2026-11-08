// SPDX-License-Identifier: AGPL-3.0-only
// The FEA workspace's line to the agent's server, which meshes and solves
// the part on this computer (Gmsh and CalculiX, as FreeCAD ships them): an
// ask goes as a notice (fea.solve), how far it has got comes back as
// fea.progress, the answer as fea.answer.

import { notifyAgent } from '../../../src/plugins/api'
import { useAgentLink } from '../../../src/commands/agentLink'

type Answer = { req: string; ok: boolean; result?: unknown; error?: string }

export class Cancelled extends Error {
  constructor() {
    super('Cancelled.')
  }
}

const waiting = new Map<string, { resolve(v: unknown): void; reject(e: Error): void; progress?: (phase: string, detail: string) => void }>()
let n = 0

/** Ask the server; signal (the panel's Cancel) stops waiting and tells the
 *  server to stop. A solve may take minutes: the wait is long, and ends at
 *  once if the connection closes. */
export function askServer<T>(action: 'tools' | 'solve', data: Record<string, unknown> = {}, { signal, timeoutMs = 1_900_000, progress }: { signal?: AbortSignal; timeoutMs?: number; progress?: (phase: string, detail: string) => void } = {}): Promise<T> {
  const link = useAgentLink.getState()
  if (link.status !== 'connected') return Promise.reject(new Error('The part is solved on your computer through the agent connection: switch it on in Settings → Agents.'))
  if (!link.server?.features?.includes('fea.solve')) return Promise.reject(new Error('The agent’s server running now is older than this page and does not solve FEA. Quit the agent app completely and open it again, then reload this page.'))
  if (signal?.aborted) return Promise.reject(new Cancelled())
  const req = `f${Date.now().toString(36)}${(n++).toString(36)}`
  return new Promise<T>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer)
      waiting.delete(req)
      signal?.removeEventListener('abort', cancel)
      unlink()
    }
    const stopServer = () => notifyAgent('fea.solve', { req: `${req}x`, action: 'cancel', of: req })
    const cancel = () => {
      done()
      stopServer()
      reject(new Cancelled())
    }
    const timer = setTimeout(() => {
      done()
      stopServer()
      reject(new Error(`No answer in ${Math.round(timeoutMs / 60_000)} min — try a coarser mesh.`))
    }, timeoutMs)
    const unlink = useAgentLink.subscribe((s) => {
      if (s.status === 'connected') return
      done()
      reject(new Error('The agent connection closed before the answer came.'))
    })
    signal?.addEventListener('abort', cancel, { once: true })
    waiting.set(req, { resolve: (v) => (done(), resolve(v as T)), reject: (e) => (done(), reject(e)), progress })
    notifyAgent('fea.solve', { req, action, ...data })
  })
}

export function answered(a: Answer): boolean {
  const w = waiting.get(a.req)
  if (!w) return false
  if (a.ok) w.resolve(a.result)
  else w.reject(new Error(a.error || 'The solver did not answer.'))
  return true
}

export function progressed(p: { req: string; phase: string; detail?: string }): boolean {
  const w = waiting.get(p.req)
  if (!w) return false
  w.progress?.(p.phase, p.detail ?? '')
  return true
}
