// SPDX-License-Identifier: AGPL-3.0-only
// The page's side of patent-kit's worker: started when first asked for.

import type { BodyIn, Drawing } from '../core/drawings'
import type { Figure, Numeral } from '../core/model'

let worker: Worker | null = null
let next = 1
const waiting = new Map<number, { resolve(d: Drawing[]): void; reject(e: Error): void }>()

function start(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../core/hlrWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; drawings?: Drawing[]; error?: string }>) => {
    const w = waiting.get(e.data.id)
    if (!w) return
    waiting.delete(e.data.id)
    if (e.data.error) w.reject(new Error(e.data.error))
    else w.resolve(e.data.drawings ?? [])
  }
  worker.onerror = (e) => {
    for (const w of waiting.values()) w.reject(new Error(e.message || 'The drawing worker stopped.'))
    waiting.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

export function drawInWorker(bodies: BodyIn[], figures: Figure[], numerals: Numeral[], hidden: boolean): Promise<Drawing[]> {
  const w = start()
  const id = next++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.postMessage({ id, bodies, figures, numerals, hidden })
  })
}
