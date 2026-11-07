// SPDX-License-Identifier: AGPL-3.0-only
// The page's side of assembly-manual's worker: started when first asked for.

import type { Camera } from '../../_shared/lineart/views'
import type { Clash, Hit, PartIn, StepDrawing } from '../core/geometry'
import type { Step } from '../core/model'

let worker: Worker | null = null
let next = 1
const waiting = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()

function start(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('../core/asmWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
    const w = waiting.get(e.data.id)
    if (!w) return
    waiting.delete(e.data.id)
    if (e.data.error) w.reject(new Error(e.data.error))
    else w.resolve(e.data.result)
  }
  worker.onerror = (e) => {
    for (const w of waiting.values()) w.reject(new Error(e.message || 'The assembly worker stopped.'))
    waiting.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

function ask<T>(msg: Record<string, unknown>): Promise<T> {
  const w = start()
  const id = next++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject })
    w.postMessage({ id, ...msg })
  })
}

export const sweepInWorker = (parts: PartIn[], steps: Step[]) => ask<{ hits: Hit[]; clashes: Clash[] }>({ kind: 'sweep', parts, steps })
export const drawInWorker = (parts: PartIn[], steps: Step[], cameras: Camera[], explode: number) => ask<StepDrawing[]>({ kind: 'draw', parts, steps, cameras, explode })
