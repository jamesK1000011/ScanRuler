// SPDX-License-Identifier: AGPL-3.0-only
// The page's side of the board solids' worker: started when first asked for,
// one build at a time.

import type { SolidsAnswer, SolidsAsk } from '../core/circuitWorker'

let worker: Worker | null = null
let next = 1
const waiting = new Map<number, { resolve(v: SolidsAnswer): void; reject(e: Error): void }>()

function start(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../core/circuitWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; result?: SolidsAnswer; error?: string }>) => {
    const w = waiting.get(e.data.id)
    if (!w) return
    waiting.delete(e.data.id)
    if (e.data.error !== undefined) w.reject(new Error(e.data.error))
    else w.resolve(e.data.result as SolidsAnswer)
  }
  worker.onerror = (e) => stop(e.message || 'The board builder stopped.')
  return worker
}

/** Stop the build running, if any: its callers are told why. */
export function stop(why = 'Stopped.'): void {
  for (const w of waiting.values()) w.reject(new Error(why))
  waiting.clear()
  worker?.terminate()
  worker = null
}

export const busy = () => waiting.size > 0

export function build(ask: Omit<SolidsAsk, 'id'>, signal?: AbortSignal): Promise<SolidsAnswer> {
  if (signal?.aborted) return Promise.reject(new Error('Stopped.'))
  const w = start()
  const id = next++
  return new Promise((resolve, reject) => {
    const onAbort = () => stop('Stopped.')
    signal?.addEventListener('abort', onAbort, { once: true })
    waiting.set(id, {
      resolve: (v) => (signal?.removeEventListener('abort', onAbort), resolve(v)),
      reject: (e) => (signal?.removeEventListener('abort', onAbort), reject(e)),
    })
    w.postMessage({ id, ...ask })
  })
}
