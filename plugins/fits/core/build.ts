// SPDX-License-Identifier: AGPL-3.0-only
// A part built and handed back — STEP, a mesh, or only its sizes — the
// same in the worker and in Node.

import { clearOf, type Box3 } from '../../_shared/clear'
import { buildPart, type Geo } from './parts'
import type { Kernel, H } from './kernel'

export type FitsAsk = Geo & { out: 'step' | 'stl' | 'info'; chord?: number; /** The box round the bodies standing: the parts are moved clear of it. */ avoid?: Box3 | null }

export interface FitsPart {
  name: string
  volume: number
  box: { min: [number, number, number]; max: [number, number, number] }
}

export interface FitsAnswer {
  parts: FitsPart[]
  step?: string
  stl?: Uint8Array
}

type Full = Kernel & { makeCompound(shapes: H[]): H; exportStl(shape: H, chord?: number, ascii?: false): Uint8Array }

export function build(k: Kernel, ask: FitsAsk): FitsAnswer {
  const kk = k as Full
  let made = buildPart(k, ask)
  const boxOf = (shape: H): Box3 => {
    const b = k.getBoundingBox(shape)
    return { min: [b.xmin, b.ymin, b.zmin], max: [b.xmax, b.ymax, b.zmax] }
  }
  const move = clearOf(made.map((m) => boxOf(m.shape)), ask.avoid ?? null)
  if (move) made = made.map((m) => ({ ...m, shape: k.translate(m.shape, ...move) }))
  const parts: FitsPart[] = made.map(({ name, shape }) => {
    const b = k.getBoundingBox(shape)
    return { name, volume: k.getVolume(shape), box: { min: [b.xmin, b.ymin, b.zmin], max: [b.xmax, b.ymax, b.zmax] } }
  })
  if (ask.out === 'info') return { parts }
  const all = made.length === 1 ? made[0].shape : kk.makeCompound(made.map((m) => m.shape))
  if (ask.out === 'step') return { parts, step: k.exportStep(all) }
  return { parts, stl: kk.exportStl(all, ask.chord ?? 0.02, false) }
}
