// SPDX-License-Identifier: AGPL-3.0-only
// Electronics › tscircuit's own CAD kernel, in a worker: the board's solids
// built off the page's thread (circuitSolids.ts) and handed back as a STEP
// file with each part's figures. It loads OCCT from the same wasm file as
// Reverse Engineer and makes no other request.

import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import { solidsBuild, type SolidsAsk, type SolidsKernel } from './circuitSolids'

export type { SolidsAnswer, SolidsAsk } from './circuitSolids'

let kernel: Promise<SolidsKernel> | null = null

self.onmessage = async (e: MessageEvent<SolidsAsk>) => {
  const { id, ...ask } = e.data
  const post = (m: unknown) => (self as unknown as Worker).postMessage(m)
  try {
    kernel ??= import('occt-wasm').then((m) => m.OcctKernel.init({ wasm: wasmUrl }) as unknown as Promise<SolidsKernel>)
    const k = await kernel.catch((err) => {
      // Not loaded: the next build tries again.
      kernel = null
      throw err
    })
    post({ id, result: solidsBuild(k, ask) })
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
