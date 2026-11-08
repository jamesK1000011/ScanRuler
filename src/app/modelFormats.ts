// SPDX-License-Identifier: AGPL-3.0-only
// Model formats a plugin opens — GLB or FBX, say — offered by the Open
// pickers beside the app's own (core/formats.ts) and opened, when one is
// picked, by the plugin that registered it. The app reads none of them
// itself: without the plugin the pickers offer them not, and the worker
// still refuses them, as before.

import { REFERENCE_ACCEPT, SCAN_ACCEPT, extensionOf } from '../core/formats'

export interface ModelFormat {
  /** File extensions, lower case, without the dot: ['glb', 'gltf']. */
  extensions: readonly string[]
  /** Open a picked file as the scan or the reference. `discard`: the person
   *  has already agreed that the scan in place, and what is measured on it,
   *  go. */
  open(file: File, as: 'scan' | 'reference', discard: boolean): Promise<void>
}

const formats = new Set<ModelFormat>()

/** A plugin's model formats, from its install(); the returned function takes
 *  them out again. An extension the app reads itself is left to the app. */
export function registerModelFormat(format: ModelFormat): () => void {
  formats.add(format)
  return () => {
    formats.delete(format)
  }
}

const own = new Set(SCAN_ACCEPT.split(',').map((e) => e.slice(1)))

/** The plugin format that opens `fileName`, or null — for the app's own
 *  formats too, which no plugin takes over. */
export function modelFormatOf(fileName: string): ModelFormat | null {
  const ext = extensionOf(fileName)
  if (own.has(ext)) return null
  for (const f of formats) if (f.extensions.includes(ext)) return f
  return null
}

const extra = () => [...new Set([...formats].flatMap((f) => f.extensions))].filter((e) => !own.has(e)).map((e) => `.${e}`)

/** A model picker's accept list with the plugins' formats added: the scan's
 *  and the reference's (core/formats.ts); any other — an image's — as it
 *  is. Read at render, after the plugins have installed. */
export function withPluginFormats(accept: string): string {
  if (accept !== SCAN_ACCEPT && accept !== REFERENCE_ACCEPT) return accept
  return [accept, ...extra()].join(',')
}
