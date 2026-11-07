// SPDX-License-Identifier: AGPL-3.0-only
// assembly-manual's own CAD kernel, in a worker: parts swept in along their
// moves, and the steps drawn, off the page's thread. It loads OCCT from the
// same wasm file as Reverse Engineer and makes no other request.

import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import { camera, type Camera } from '../../_shared/lineart/views'
import { drawSteps, sweep, type AsmKernel, type PartIn } from './geometry'
import type { Step } from './model'

interface Ask {
  id: number
  kind: 'sweep' | 'draw'
  parts: PartIn[]
  steps: Step[]
  cameras?: Camera[]
  explode?: number
}

let kernel: Promise<AsmKernel & { releaseAll(): void }> | null = null

self.onmessage = async (e: MessageEvent<Ask>) => {
  const { id, kind, parts, steps, cameras, explode } = e.data
  const post = (m: unknown) => (self as unknown as Worker).postMessage(m)
  try {
    kernel ??= import('occt-wasm').then((m) => m.OcctKernel.init({ wasm: wasmUrl }) as unknown as Promise<AsmKernel & { releaseAll(): void }>)
    const k = await kernel
    try {
      if (kind === 'sweep') post({ id, result: sweep(k, parts, steps) })
      else post({ id, result: drawSteps(k, parts, steps, cameras ?? steps.map(() => camera('iso')), explode ?? 1) })
    } finally {
      k.releaseAll()
    }
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
