// SPDX-License-Identifier: AGPL-3.0-only
// Model formats a plugin opens: offered by the scan's and the reference's
// pickers only while registered, never by an image's, and never taking one
// of the app's own formats over.
import { describe, expect, it } from 'vitest'
import { modelFormatOf, registerModelFormat, withPluginFormats } from '../src/app/modelFormats'
import { IMAGE_ACCEPT, REFERENCE_ACCEPT, SCAN_ACCEPT } from '../src/core/formats'

describe('model formats from a plugin', () => {
  it('are offered by the model pickers while registered', async () => {
    expect(withPluginFormats(SCAN_ACCEPT)).toBe(SCAN_ACCEPT)
    expect(modelFormatOf('part.glb')).toBe(null)
    const opened: string[] = []
    const format = { extensions: ['glb', 'fbx', 'stl'], open: async (file: File, as: 'scan' | 'reference') => void opened.push(`${file.name} as ${as}`) }
    const unregister = registerModelFormat(format)
    try {
      expect(withPluginFormats(SCAN_ACCEPT)).toBe(`${SCAN_ACCEPT},.glb,.fbx`)
      expect(withPluginFormats(REFERENCE_ACCEPT)).toBe(`${REFERENCE_ACCEPT},.glb,.fbx`)
      expect(withPluginFormats(IMAGE_ACCEPT)).toBe(IMAGE_ACCEPT)
      expect(modelFormatOf('Part.GLB')).toBe(format)
      // The app's own formats stay the app's.
      expect(modelFormatOf('part.stl')).toBe(null)
      expect(modelFormatOf('part.step')).toBe(null)
      await modelFormatOf('part.fbx')!.open(new File([new Uint8Array(4)], 'part.fbx'), 'reference', false)
      expect(opened).toEqual(['part.fbx as reference'])
    } finally {
      unregister()
    }
    expect(withPluginFormats(SCAN_ACCEPT)).toBe(SCAN_ACCEPT)
    expect(modelFormatOf('part.glb')).toBe(null)
  })
})
