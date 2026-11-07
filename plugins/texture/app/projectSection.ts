// SPDX-License-Identifier: AGPL-3.0-only
// The Texture workspace's part of a project file: the layers and the output
// as JSON, each layer's paint and your own heightmaps as files of the
// archive beside it. The paint counts scan vertices, so it is kept only with
// the scan.

import type { ProjectSection } from '../../../src/app/projectSections'
import { defaultLayerSettings, defaultOutput, useTexture, type TextureLayer, type TextureRef, type LayerSettings, type OutputSettings, type MaskMode, type Blend } from '../state/textureStore'
import { addImage, forgetImagesExcept, imageEntry } from './textureSession'

interface SavedLayer {
  texture: TextureRef | null
  settings: Partial<LayerSettings>
  maskMode: MaskMode
  mask: string | null
  visible: boolean
  blend: Blend
}
interface SavedTexture {
  version: 1
  layers: SavedLayer[]
  active: number
  output: Partial<OutputSettings>
  refineChosen: boolean
  images: { key: string; name: string; file: string }[]
}

const isContent = (v: SavedTexture) => v.layers.some((L) => L.texture || L.mask)

export const textureSection: ProjectSection<SavedTexture> = {
  key: 'texture',
  collect(ctx) {
    const st = useTexture.getState()
    if (!st.layers.some((L) => L.texture || L.mask)) return undefined
    const images: SavedTexture['images'] = []
    const layers = st.layers.map((L, i): SavedLayer => {
      let mask: string | null = null
      if (L.mask && ctx.scanSaved) {
        mask = `texture-mask-${i + 1}.u32`
        ctx.addMember(mask, new Uint8Array(L.mask.buffer.slice(L.mask.byteOffset, L.mask.byteOffset + L.mask.byteLength)))
      }
      if (L.texture?.kind === 'image' && !images.some((im) => im.key === (L.texture as { key: string }).key)) {
        const e = imageEntry(L.texture.key)
        if (e) {
          const file = `texture-image-${images.length + 1}-${e.name.replace(/[^A-Za-z0-9._-]/g, '_')}`
          ctx.addMember(file, e.bytes)
          images.push({ key: L.texture.key, name: e.name, file })
        }
      }
      return { texture: L.texture, settings: L.settings, maskMode: L.maskMode, mask, visible: L.visible, blend: L.blend }
    })
    return { version: 1, layers, active: st.active, output: st.output, refineChosen: st.refineChosen, images }
  },
  members: (v) => [...v.layers.flatMap((L) => (L.mask ? [L.mask] : [])), ...v.images.map((im) => im.file)],
  prepare(value, ctx) {
    if (value === undefined) return () => useTexture.getState().reset()
    const v = value as SavedTexture
    if (!v || v.version !== 1 || !Array.isArray(v.layers) || v.layers.length < 1 || v.layers.length > 4) throw new Error('The texture part of the project is not one this ScanRuler reads.')
    const masks = v.layers.map((L) => {
      if (!L.mask) return null
      const bytes = ctx.members.get(L.mask)
      if (!bytes || bytes.byteLength % 4) throw new Error(`The project is missing ${L.mask}.`)
      return new Uint32Array(bytes.slice().buffer)
    })
    for (const im of v.images ?? []) if (!ctx.members.get(im.file)) throw new Error(`The project is missing ${im.file}.`)
    return () => {
      const layers: TextureLayer[] = v.layers.map((L, i) => ({
        id: i + 1,
        texture: L.texture,
        settings: { ...defaultLayerSettings(), ...L.settings },
        maskMode: L.maskMode === 'include' ? 'include' : 'exclude',
        mask: masks[i],
        visible: L.visible !== false,
        blend: L.blend === 'add' ? 'add' : 'cover',
      }))
      useTexture.setState({
        layers, active: Math.min(v.active ?? 0, layers.length - 1), output: { ...defaultOutput(), ...v.output },
        refineChosen: !!v.refineChosen, nextId: layers.length + 1, result: null, previewShown: false, error: null,
      })
    }
  },
  async restore(value, ctx) {
    const keep = new Set<string>()
    for (const im of value.images ?? []) {
      keep.add(im.key)
      const bytes = ctx.members.get(im.file)
      if (bytes) await addImage(bytes, im.name, im.key)
    }
    forgetImagesExcept(keep)
  },
  hasContent: isContent,
  holdsWork: () => useTexture.getState().layers.some((L) => L.texture || L.mask),
  holds: () => {
    const st = useTexture.getState()
    return { 'texture layers': st.layers.filter((L) => L.texture).length }
  },
  watch(changed) {
    return useTexture.subscribe((s, p) => {
      if (s.layers !== p.layers || s.output !== p.output || s.active !== p.active) changed()
    })
  },
}
