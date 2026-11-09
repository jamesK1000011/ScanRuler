// SPDX-License-Identifier: AGPL-3.0-only
// The generators' own CAD kernel, in a worker: the solids built off the
// page's thread (genBuild.ts) and handed back as a STEP file, a mesh, or
// their sizes. It loads OCCT from the same wasm file as Reverse Engineer
// and makes no other request.

import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import { type BuildKernel, genBuild, type GenAnswer, type GenAsk } from './genBuild'

export type { GenAnswer, GenAsk, GenPart } from './genBuild'

let kernel: Promise<BuildKernel> | null = null

self.onmessage = async (e: MessageEvent<GenAsk>) => {
  const { id, ...ask } = e.data
  const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t)
  try {
    kernel ??= import('occt-wasm').then((m) => m.OcctKernel.init({ wasm: wasmUrl }) as unknown as Promise<BuildKernel>)
    const k = await kernel.catch((err) => {
      // Not loaded: the next build tries again.
      kernel = null
      throw err
    })
    const result = genBuild(k, ask)
    post({ id, result: result satisfies GenAnswer }, result.stl ? [result.stl.buffer as ArrayBuffer] : [])
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
