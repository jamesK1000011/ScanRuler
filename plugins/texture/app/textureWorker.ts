// SPDX-License-Identifier: AGPL-3.0-only
// BumpMesh's engine in a worker of its own: a texturing run takes seconds to
// minutes, and the page keeps drawing and answering while it does. One run
// per worker; the session stops a run by ending the worker.

import { textureMesh, type EngineLayer } from '../bumpmesh/engine/index.js'

export interface TextureJob {
  positions: Float32Array
  layers: EngineLayer[]
  settings: Record<string, unknown>
}

export type TextureWorkerMessage =
  | { type: 'progress'; stage: string; fraction: number }
  | { type: 'done'; positions: Float32Array; normals: Float32Array | null; triangles: number; inputTriangles: number; warnings: string[] }
  | { type: 'error'; message: string }

const post = (m: TextureWorkerMessage, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer)

self.onmessage = async (e: MessageEvent<TextureJob>) => {
  try {
    let last = 0
    const r = await textureMesh({
      ...e.data,
      onProgress: (stage, fraction) => {
        const now = Date.now()
        if (now - last < 150 && fraction < 1) return
        last = now
        post({ type: 'progress', stage, fraction })
      },
    })
    if (!r) return post({ type: 'error', message: 'stopped' })
    const transfer: Transferable[] = [r.positions.buffer]
    if (r.normals) transfer.push(r.normals.buffer)
    post({ type: 'done', positions: r.positions, normals: r.normals, triangles: r.triangles, inputTriangles: r.inputTriangles, warnings: r.warnings }, transfer)
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
