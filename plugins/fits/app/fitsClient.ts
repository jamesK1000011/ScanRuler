// SPDX-License-Identifier: AGPL-3.0-only
// The page's side of the Fits worker: started when first asked for, one
// build at a time. setBuilder puts something else in its place — the
// tests build in Node.

import type { FitsAnswer, FitsAsk } from '../core/build'

type Builder = (ask: FitsAsk, signal?: AbortSignal) => Promise<FitsAnswer>

let worker: Worker | null = null
let next = 1
const waiting = new Map<number, { resolve(v: FitsAnswer): void; reject(e: Error): void }>()

function start(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../core/fitsWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; result?: FitsAnswer; error?: string }>) => {
    const w = waiting.get(e.data.id)
    if (!w) return
    waiting.delete(e.data.id)
    if (e.data.error !== undefined) w.reject(new Error(e.data.error))
    else w.resolve(e.data.result as FitsAnswer)
  }
  worker.onerror = (e) => stopBuild(e.message || 'The builder stopped.')
  return worker
}

/** Stop the build running, if any: its callers are told why. */
export function stopBuild(why = 'Stopped.'): void {
  for (const w of waiting.values()) w.reject(new Error(why))
  waiting.clear()
  worker?.terminate()
  worker = null
}

const inWorker: Builder = (ask, signal) => {
  if (signal?.aborted) return Promise.reject(new Error('Stopped.'))
  const w = start()
  const id = next++
  return new Promise((resolve, reject) => {
    const onAbort = () => stopBuild('Stopped.')
    signal?.addEventListener('abort', onAbort, { once: true })
    waiting.set(id, {
      resolve: (v) => (signal?.removeEventListener('abort', onAbort), resolve(v)),
      reject: (e) => (signal?.removeEventListener('abort', onAbort), reject(e)),
    })
    w.postMessage({ id, ...ask })
  })
}

let builder: Builder = inWorker

export const build = (ask: FitsAsk, signal?: AbortSignal) => builder(ask, signal)

/** Build with this in place of the worker; null puts the worker back. */
export function setBuilder(b: Builder | null): void {
  builder = b ?? inWorker
}
