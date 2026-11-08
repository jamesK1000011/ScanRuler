// SPDX-License-Identifier: AGPL-3.0-only
// The Boards workspace's line to the agent's server, which runs KiCad's
// kicad-cli on this computer (the page cannot start a program): an ask goes
// as a notice (pcb.kicad), how far it has got comes back as pcb.progress,
// the answer as pcb.answer — with a file's bytes where there is one (the
// board's STEP, the fab package).

import { notifyAgent } from '../../../src/plugins/api'
import { useAgentLink } from '../../../src/commands/agentLink'

export type Action = 'tools' | 'read' | 'import' | 'fab' | 'drc'
type Answer = { req: string; ok: boolean; result?: unknown; error?: string; bytes?: Uint8Array }

export class Cancelled extends Error {
  constructor() {
    super('Stopped.')
  }
}

const waiting = new Map<string, { resolve(v: { result: unknown; bytes?: Uint8Array }): void; reject(e: Error): void; progress?: (phase: string, detail: string) => void }>()
let n = 0

/** Ask the server; signal (Stop) ends the wait and tells the server to
 *  stop. Resolves with the result and the bytes that came with it. */
export function askServer(action: Action, data: Record<string, unknown> = {}, { signal, timeoutMs = 900_000, progress }: { signal?: AbortSignal; timeoutMs?: number; progress?: (phase: string, detail: string) => void } = {}): Promise<{ result: unknown; bytes?: Uint8Array }> {
  const link = useAgentLink.getState()
  if (link.status !== 'connected') return Promise.reject(new Error('KiCad runs on your computer through the agent connection: switch it on in Settings → Agents.'))
  if (!link.server?.features?.includes('pcb.kicad')) return Promise.reject(new Error('The agent’s server running now is older than this page and does not run KiCad. Quit the agent app completely and open it again, then reload this page.'))
  if (signal?.aborted) return Promise.reject(new Cancelled())
  const req = `p${Date.now().toString(36)}${(n++).toString(36)}`
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer)
      waiting.delete(req)
      signal?.removeEventListener('abort', cancel)
      unlink()
    }
    const stopServer = () => notifyAgent('pcb.kicad', { req: `${req}x`, action: 'cancel', of: req })
    const cancel = () => {
      done()
      stopServer()
      reject(new Cancelled())
    }
    const timer = setTimeout(() => {
      done()
      stopServer()
      reject(new Error(`KiCad gave no answer in ${Math.round(timeoutMs / 60_000)} min.`))
    }, timeoutMs)
    const unlink = useAgentLink.subscribe((s) => {
      if (s.status === 'connected') return
      done()
      reject(new Error('The agent connection closed before KiCad answered.'))
    })
    signal?.addEventListener('abort', cancel, { once: true })
    waiting.set(req, { resolve: (v) => (done(), resolve(v)), reject: (e) => (done(), reject(e)), progress })
    notifyAgent('pcb.kicad', { req, action, ...data })
  })
}

export function answered(a: Answer): boolean {
  const w = waiting.get(a.req)
  if (!w) return false
  if (a.ok) w.resolve({ result: a.result, ...(a.bytes ? { bytes: a.bytes } : {}) })
  else w.reject(new Error(a.error || 'KiCad did not answer.'))
  return true
}

export function progressed(p: { req: string; phase: string; detail?: string }): boolean {
  const w = waiting.get(p.req)
  if (!w) return false
  w.progress?.(p.phase, p.detail ?? '')
  return true
}
