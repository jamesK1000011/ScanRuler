// SPDX-License-Identifier: AGPL-3.0-only
// The board's solids built and handed back as a STEP file with each part's
// figures, moved clear of the bodies standing. The worker
// (circuitWorker.ts) runs it on its own thread; the app run headless
// (plugin.ts headless) in this one (circuitLocal.ts).

import { clearOf, type Box3 } from '../../_shared/clear'
import { buildSolids, partOf, type BoardKernel, type Part, type SolidOptions } from './boardSolids'
import type { CircuitBoard } from './circuitJson'

export interface SolidsAsk {
  id: number
  board: CircuitBoard
  options: SolidOptions
  out: 'step' | 'info'
  /** The box round the bodies standing: the board is moved clear of it. */
  avoid?: Box3 | null
}

export interface SolidsAnswer {
  parts: Part[]
  notes: string[]
  step?: string
}

export type SolidsKernel = BoardKernel & { releaseAll(): void }

/** Build what `ask` asks for on `k`; whatever the kernel made is let go
 *  after, built or not. */
export function solidsBuild(k: SolidsKernel, ask: Omit<SolidsAsk, 'id'>): SolidsAnswer {
  const { board, options, out, avoid } = ask
  try {
    const made = buildSolids(k, board, options)
    if (!made.parts.length) throw new Error('Nothing to build: every part is switched off, or the board has none of them.')
    // Clear of the bodies standing, where it would land in them; board,
    // copper and keep-outs move together.
    const move = clearOf(made.parts.map((p) => partOf(k, p).box), avoid ?? null)
    if (move) made.parts = made.parts.map((p) => ({ ...p, shape: k.translate(p.shape, ...move) }))
    const parts = made.parts.map((p) => partOf(k, p))
    const answer: SolidsAnswer = { parts, notes: made.notes }
    if (out === 'step') answer.step = k.exportStep(made.parts.length === 1 ? made.parts[0].shape : k.makeCompound(made.parts.map((p) => p.shape)))
    return answer
  } finally {
    k.releaseAll()
  }
}
