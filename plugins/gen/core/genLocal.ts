// SPDX-License-Identifier: AGPL-3.0-only
// The generators' kernel in this thread, for Node, which has no workers:
// what the app run headless (plugin.ts headless) builds with — the same
// build as the worker's (genBuild.ts), with OCCT found by Node itself.

import { type BuildKernel, genBuild, type GenAnswer, type GenAsk } from './genBuild'

/** A builder over one kernel, loaded when first asked for. */
export function localBuilder(): (ask: Omit<GenAsk, 'id'>) => Promise<GenAnswer> {
  let kernel: Promise<BuildKernel> | null = null
  return async (ask) => {
    kernel ??= import('occt-wasm').then((m) => m.OcctKernel.init() as unknown as Promise<BuildKernel>)
    const k = await kernel.catch((err) => {
      // Not loaded: the next build tries again.
      kernel = null
      throw err
    })
    return genBuild(k, ask)
  }
}
