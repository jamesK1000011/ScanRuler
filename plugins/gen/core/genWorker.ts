// SPDX-License-Identifier: AGPL-3.0-only
// The generators' own CAD kernel, in a worker: the solids built off the
// page's thread and handed back as a STEP file, a mesh, or their sizes. It
// loads OCCT from the same wasm file as Reverse Engineer and makes no
// other request.

import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import { generatorOf, type Value } from './generators'
import type { GenKernel, H } from './kernel'

export interface GenAsk {
  id: number
  generator: string
  params: Record<string, Value>
  out: 'step' | 'stl' | 'info'
  chord?: number
}

export interface GenPart {
  name: string
  volume: number
  box: { min: [number, number, number]; max: [number, number, number] }
}

export interface GenAnswer {
  parts: GenPart[]
  step?: string
  stl?: Uint8Array
}

type Kernel = GenKernel & {
  releaseAll(): void
  makeCompound(shapes: H[]): H
  exportStl(shape: H, chord?: number, ascii?: false): Uint8Array
}

let kernel: Promise<Kernel> | null = null

self.onmessage = async (e: MessageEvent<GenAsk>) => {
  const { id, generator, params, out, chord } = e.data
  const post = (m: unknown, t: Transferable[] = []) => (self as unknown as Worker).postMessage(m, t)
  try {
    const g = generatorOf(generator)
    if (!g) throw new Error(`No generator "${generator}".`)
    kernel ??= import('occt-wasm').then((m) => m.OcctKernel.init({ wasm: wasmUrl }) as unknown as Promise<Kernel>)
    const k = await kernel.catch((err) => {
      // Not loaded: the next build tries again.
      kernel = null
      throw err
    })
    try {
      const made = g.build(k, params)
      const parts: GenPart[] = made.map(({ name, shape }) => {
        const b = k.getBoundingBox(shape)
        return { name, volume: k.getVolume(shape), box: { min: [b.xmin, b.ymin, b.zmin], max: [b.xmax, b.ymax, b.zmax] } }
      })
      const all = made.length === 1 ? made[0].shape : k.makeCompound(made.map((m) => m.shape))
      if (out === 'step') post({ id, result: { parts, step: k.exportStep(all) } satisfies GenAnswer })
      else if (out === 'stl') {
        const stl = k.exportStl(all, chord ?? 0.02, false)
        post({ id, result: { parts, stl } satisfies GenAnswer }, [stl.buffer as ArrayBuffer])
      } else post({ id, result: { parts } satisfies GenAnswer })
    } finally {
      k.releaseAll()
    }
  } catch (err) {
    post({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
