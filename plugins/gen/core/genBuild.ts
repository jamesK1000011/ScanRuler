// SPDX-License-Identifier: AGPL-3.0-only
// A part built: the generator run on a kernel, moved clear of the bodies
// standing, and handed back as a STEP file, a mesh, or its sizes. The
// worker (genWorker.ts) runs it on its own thread; the app run headless
// (plugin.ts headless) in this one (genLocal.ts).

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
  /** How far the parts were moved to stand clear of the bodies there. */
  move?: [number, number, number]
  step?: string
  stl?: Uint8Array
}

export type BuildKernel = GenKernel & {
  releaseAll(): void
  makeCompound(shapes: H[]): H
  exportStl(shape: H, chord?: number, ascii?: false): Uint8Array
}

const boxOf = (k: BuildKernel, shape: H): Box3 => {
  const b = k.getBoundingBox(shape)
  return { min: [b.xmin, b.ymin, b.zmin], max: [b.xmax, b.ymax, b.zmax] }
}

/** Build what `ask` asks for on `k`; whatever the kernel made is let go
 *  after, built or not. Throws where the generator is unknown or the
 *  build fails. */
export function genBuild(k: BuildKernel, ask: Omit<GenAsk, 'id'>): GenAnswer {
  const { generator, params, out, chord, board, avoid } = ask
  const g = generatorOf(generator)
  if (!g) throw new Error(`No generator "${generator}".`)
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
    const moved = move ? { move } : {}
    if (out === 'step') return { parts, ...moved, step: k.exportStep(all) }
    if (out === 'stl') return { parts, ...moved, stl: k.exportStl(all, chord ?? 0.02, false) }
    return { parts, ...moved }
  } finally {
    k.releaseAll()
  }
}
