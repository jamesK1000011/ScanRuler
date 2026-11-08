// SPDX-License-Identifier: AGPL-3.0-only
// The Fits parts' own CAD kernel, in a worker: the solids built off the
// page's thread and handed back as a STEP file, a mesh, or their sizes. It
// loads OCCT from the same wasm file as Reverse Engineer and makes no
// other request.

import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import { build, type FitsAnswer, type FitsAsk } from './build'
import type { Kernel } from './kernel'

let kernel: Promise<Kernel & { releaseAll(): void }> | null = null

self.onmessage = async (e: MessageEvent<FitsAsk & { id: number }>) => {
  const { id, ...ask } = e.data
  const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t)
  try {
    kernel ??= import('occt-wasm').then((m) => m.OcctKernel.init({ wasm: wasmUrl }) as unknown as Promise<Kernel & { releaseAll(): void }>)
    const k = await kernel.catch((err) => {
      // Not loaded: the next build tries again.
      kernel = null
      throw err
    })
    try {
      const result: FitsAnswer = build(k, ask)
      post({ id, result }, result.stl ? [result.stl.buffer as ArrayBuffer] : [])
    } finally {
      k.releaseAll()
    }
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
