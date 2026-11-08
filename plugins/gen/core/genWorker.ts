// SPDX-License-Identifier: AGPL-3.0-only
// The generators' own CAD kernel, in a worker: the solids built off the
// page's thread and handed back as a STEP file, a mesh, or their sizes. It
// loads OCCT from the same wasm file as Reverse Engineer and makes no
// other request.

import wasmUrl from 'occt-wasm/dist/occt-wasm.wasm?url'
import { clearOf, type Box3 } from '../../_shared/clear'
import { generatorOf, type Value } from './generators'
import type { GenKernel, H } from './kernel'
import type { BoardSpec } from './boardBox'

export interface GenAsk {
  id: number
  generator: string
  params: Record<string, Value>
  out: 'step' | 'stl' | 'info'
  chord?: number
  /** For a generator that takes one: the board. */
  board?: BoardSpec
  /** The box round the bodies standing: the parts are moved clear of it. */
  avoid?: Box3 | null
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

const boxOf = (k: Kernel, shape: H): Box3 => {
  const b = k.getBoundingBox(shape)
  return { min: [b.xmin, b.ymin, b.zmin], max: [b.xmax, b.ymax, b.zmax] }
}

self.onmessage = async (e: MessageEvent<GenAsk>) => {
  const { id, generator, params, out, chord, board, avoid } = e.data
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
      let made = g.build(k, params, board)
      // Clear of the bodies standing, where it would land in them.
      const move = clearOf(made.map(({ shape }) => boxOf(k, shape)), avoid ?? null)
      if (move) made = made.map((m) => ({ ...m, shape: k.translate(m.shape, ...move) }))
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
