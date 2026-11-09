// SPDX-License-Identifier: AGPL-3.0-only
// The page's side of the generators' worker: started when first asked for,
// one build at a time — or, in the app run headless, the builder in this
// thread it is given (plugin.ts headless).

import type { GenAnswer, GenAsk } from '../core/genBuild'

let worker: Worker | null = null
let next = 1
const waiting = new Map<number, { resolve(v: GenAnswer): void; reject(e: Error): void }>()
type Builder = (ask: Omit<GenAsk, 'id'>) => Promise<GenAnswer>
let inThread: Builder | null = null

/** Build in this thread with `builder` in place of the worker — null for
 *  the worker again. A build stopped there runs on, its answer let go. */
export function buildInThread(builder: Builder | null): void {
  inThread = builder
}

function start(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../core/genWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; result?: GenAnswer; error?: string }>) => {
    const w = waiting.get(e.data.id)
    if (!w) return
    waiting.delete(e.data.id)
    if (e.data.error !== undefined) w.reject(new Error(e.data.error))
    else w.resolve(e.data.result as GenAnswer)
  }
  worker.onerror = (e) => stop(e.message || 'The generator stopped.')
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

export function build(ask: Omit<GenAsk, 'id'>, signal?: AbortSignal): Promise<GenAnswer> {
  if (signal?.aborted) return Promise.reject(new Error('Stopped.'))
  const local = inThread
  const w = local ? null : start()
  const id = next++
  return new Promise((resolve, reject) => {
    const onAbort = () => stop('Stopped.')
    signal?.addEventListener('abort', onAbort, { once: true })
    waiting.set(id, {
      resolve: (v) => (signal?.removeEventListener('abort', onAbort), resolve(v)),
      reject: (e) => (signal?.removeEventListener('abort', onAbort), reject(e)),
    })
    if (w) {
      w.postMessage({ id, ...ask })
      return
    }
    // Answered only while still waited for: a stop has let it go.
    const settle = (fn: (waiter: { resolve(v: GenAnswer): void; reject(e: Error): void }) => void) => {
      const waiter = waiting.get(id)
      if (!waiter) return
      waiting.delete(id)
      fn(waiter)
    }
    local!(ask).then(
      (v) => settle((x) => x.resolve(v)),
      (e: unknown) => settle((x) => x.reject(e instanceof Error ? e : new Error(String(e)))),
    )
  })
}
