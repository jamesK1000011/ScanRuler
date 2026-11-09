// SPDX-License-Identifier: AGPL-3.0-only
// The Fits parts' kernel in this thread, for Node, which has no workers:
// what the app run headless (plugin.ts headless) builds with — the same
// build as the worker's (build.ts), with OCCT found by Node itself.

import { build, type FitsAnswer, type FitsAsk } from './build'
import type { Kernel } from './kernel'

type Loaded = Kernel & { releaseAll(): void }

/** A builder over one kernel, loaded when first asked for. A build
 *  stopped runs on in this thread; its answer is let go. */
export function localBuilder(): (ask: FitsAsk, signal?: AbortSignal) => Promise<FitsAnswer> {
  let kernel: Promise<Loaded> | null = null
  return async (ask, signal) => {
    if (signal?.aborted) throw new Error('Stopped.')
    kernel ??= import('occt-wasm').then((m) => m.OcctKernel.init() as unknown as Promise<Loaded>)
    const k = await kernel.catch((err) => {
      // Not loaded: the next build tries again.
      kernel = null
      throw err
    })
    if (signal?.aborted) throw new Error('Stopped.')
    try {
      return build(k, ask)
    } finally {
      k.releaseAll()
    }
  }
}
