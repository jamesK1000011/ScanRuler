// SPDX-License-Identifier: AGPL-3.0-only
// The board solids' kernel in this thread, for Node, which has no workers:
// what the app run headless (plugin.ts headless) builds with — the same
// build as the worker's (circuitSolids.ts), with OCCT found by Node itself.

import { solidsBuild, type SolidsAnswer, type SolidsAsk, type SolidsKernel } from './circuitSolids'

/** A builder over one kernel, loaded when first asked for. */
export function localBuilder(): (ask: Omit<SolidsAsk, 'id'>) => Promise<SolidsAnswer> {
  let kernel: Promise<SolidsKernel> | null = null
  return async (ask) => {
    kernel ??= import('occt-wasm').then((m) => m.OcctKernel.init() as unknown as Promise<SolidsKernel>)
    const k = await kernel.catch((err) => {
      // Not loaded: the next build tries again.
      kernel = null
      throw err
    })
    return solidsBuild(k, ask)
  }
}
