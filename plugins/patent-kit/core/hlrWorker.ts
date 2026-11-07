// SPDX-License-Identifier: AGPL-3.0-only
// patent-kit's own CAD kernel, in a worker: the figures' hidden lines
// removed off the page's thread. It loads OCCT from the same wasm file as
// Reverse Engineer and makes no other request.

import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import { drawFigures, type BodyIn, type DrawKernel } from './drawings'
import type { Figure, Numeral } from './model'

interface Ask {
  id: number
  bodies: BodyIn[]
  figures: Figure[]
  numerals: Numeral[]
  hidden: boolean
}

let kernel: Promise<DrawKernel & { releaseAll(): void }> | null = null

self.onmessage = async (e: MessageEvent<Ask>) => {
  const { id, bodies, figures, numerals, hidden } = e.data
  try {
    kernel ??= import('occt-wasm').then((m) => m.OcctKernel.init({ wasm: wasmUrl }) as unknown as Promise<DrawKernel & { releaseAll(): void }>)
    const k = await kernel
    try {
      const drawings = drawFigures(k, bodies, figures, numerals, { hidden })
      ;(self as unknown as Worker).postMessage({ id, drawings })
    } finally {
      k.releaseAll()
    }
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
