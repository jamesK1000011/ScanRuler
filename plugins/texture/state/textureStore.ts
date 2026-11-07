// SPDX-License-Identifier: AGPL-3.0-only
// The Texture workspace's state: up to four texture layers — each a texture,
// its settings and the surface it covers — the output settings the whole
// part is built with, and where a run stands. Masks are held as the scan
// vertices they cover (welded vertex numbers, as scan.segment, mesh.mark and
// the marking brush count them), replaced whole on every change so the undo
// history can keep them by identity.

import { create } from 'zustand'
import { DEFAULTS } from '../bumpmesh/engine/index.js'

export type TextureRef = { kind: 'library'; name: string } | { kind: 'image'; name: string; key: string }
export type MaskMode = 'exclude' | 'include'
export type Blend = 'cover' | 'add'

/** The settings a layer carries — BumpMesh's LAYER_KEYS the workspace offers. */
export interface LayerSettings {
  mappingMode: number
  scaleU: number
  scaleV: number
  lockScale: boolean
  offsetU: number
  offsetV: number
  rotation: number
  rotateAroundZ: boolean
  textureHeight: number
  invertDisplacement: boolean
  invertTexture: boolean
  textureSmoothing: number
  symmetricDisplacement: boolean
  mappingBlend: number
  seamBandWidth: number
  capAngle: number
  boundaryFalloff: number
  boundaryFalloffCurve: 'linear' | 'scurve' | 'ease'
  snapSeamlessWrap: boolean
  cylinderCenterX: number | null
  cylinderCenterY: number | null
  cylinderRadius: number | null
  stampOnce: boolean
  stampCenterX: number | null
  stampCenterY: number | null
  stampCenterZ: number | null
  stampSide: number | null
  stampNormalX: number | null
  stampNormalY: number | null
  stampNormalZ: number | null
}

/** The settings the whole output is built with — BumpMesh's GLOBAL_KEYS the workspace offers. */
export interface OutputSettings {
  refineLength: number
  maxTriangles: number
  bottomAngleLimit: number
  topAngleLimit: number
  noDownwardZ: boolean
  smoothBottom: boolean
  harvestFlatFaces: boolean
  preserveUntextured: boolean
}

export interface TextureLayer {
  id: number
  texture: TextureRef | null
  settings: LayerSettings
  maskMode: MaskMode
  /** The scan vertices painted on this layer — left plain (exclude) or the
   *  only ones textured (include). Null: none painted. */
  mask: Uint32Array | null
  visible: boolean
  blend: Blend
}

const D = DEFAULTS as unknown as LayerSettings & OutputSettings
export const LAYER_SETTING_KEYS: readonly (keyof LayerSettings)[] = [
  'mappingMode', 'scaleU', 'scaleV', 'lockScale', 'offsetU', 'offsetV', 'rotation', 'rotateAroundZ',
  'textureHeight', 'invertDisplacement', 'invertTexture', 'textureSmoothing', 'symmetricDisplacement',
  'mappingBlend', 'seamBandWidth', 'capAngle', 'boundaryFalloff', 'boundaryFalloffCurve', 'snapSeamlessWrap',
  'cylinderCenterX', 'cylinderCenterY', 'cylinderRadius', 'stampOnce', 'stampCenterX', 'stampCenterY',
  'stampCenterZ', 'stampSide', 'stampNormalX', 'stampNormalY', 'stampNormalZ',
]
export const OUTPUT_SETTING_KEYS: readonly (keyof OutputSettings)[] = [
  'refineLength', 'maxTriangles', 'bottomAngleLimit', 'topAngleLimit', 'noDownwardZ', 'smoothBottom', 'harvestFlatFaces', 'preserveUntextured',
]

export const defaultLayerSettings = (): LayerSettings => {
  const out = {} as Record<string, unknown>
  for (const k of LAYER_SETTING_KEYS) out[k] = D[k]
  return out as unknown as LayerSettings
}
export const defaultOutput = (): OutputSettings => {
  const out = {} as Record<string, unknown>
  for (const k of OUTPUT_SETTING_KEYS) out[k] = D[k]
  // The app starts at 1 mm and sizes it to the model; the workspace sizes it when it builds.
  return out as unknown as OutputSettings
}

export const MAX_LAYERS = 4

/** A finished run: what it was made of (to tell whether it still stands) and what came of it. */
export interface TextureResult {
  /** 'preview' at a coarser resolution, or 'full' as it would export. */
  kind: 'preview' | 'full'
  key: string
  triangles: number
  inputTriangles: number
  seconds: number
  warnings: string[]
  refineLength: number
}

export type RunStatus = 'idle' | 'running'

interface TextureState {
  layers: TextureLayer[]
  active: number
  output: OutputSettings
  /** Whether the output's resolution was chosen, or is still the one the
   *  workspace sizes to the part. */
  refineChosen: boolean
  nextId: number
  status: RunStatus
  progress: { stage: string; fraction: number } | null
  result: TextureResult | null
  /** The textured mesh shown on the stage in place of the scan. */
  previewShown: boolean
  /** Why the last run did not finish, until the next one starts. */
  error: string | null

  setLayerSettings(index: number, patch: Partial<LayerSettings>): void
  setTexture(index: number, texture: TextureRef | null, settings?: Partial<LayerSettings>): void
  setMask(index: number, mask: Uint32Array | null, mode?: MaskMode): void
  setMaskMode(index: number, mode: MaskMode): void
  setOutput(patch: Partial<OutputSettings>): void
  addLayer(): number
  removeLayer(index: number): void
  setActive(index: number): void
  setVisible(index: number, visible: boolean): void
  setBlend(index: number, blend: Blend): void
  reset(): void
}

const newLayer = (id: number): TextureLayer => ({
  id, texture: null, settings: defaultLayerSettings(), maskMode: 'exclude', mask: null, visible: true, blend: 'cover',
})

const initial = () => ({
  layers: [newLayer(1)],
  active: 0,
  output: defaultOutput(),
  refineChosen: false,
  nextId: 2,
  status: 'idle' as RunStatus,
  progress: null,
  result: null,
  previewShown: false,
  error: null,
})

export const useTexture = create<TextureState>((set, get) => ({
  ...initial(),
  setLayerSettings: (index, patch) =>
    set((s) => ({ layers: s.layers.map((L, i) => (i === index ? { ...L, settings: lockedScale({ ...L.settings, ...patch }, patch) } : L)) })),
  setTexture: (index, texture, settings) =>
    set((s) => ({ layers: s.layers.map((L, i) => (i === index ? { ...L, texture, settings: settings ? lockedScale({ ...L.settings, ...settings }, settings) : L.settings } : L)) })),
  setMask: (index, mask, mode) =>
    set((s) => ({ layers: s.layers.map((L, i) => (i === index ? { ...L, mask: mask && mask.length ? mask : null, maskMode: mode ?? L.maskMode } : L)) })),
  setMaskMode: (index, mode) =>
    // Paint means the opposite in the other mode: switching clears it, as BumpMesh does.
    set((s) => ({ layers: s.layers.map((L, i) => (i === index && L.maskMode !== mode ? { ...L, maskMode: mode, mask: null } : L)) })),
  setOutput: (patch) => set((s) => ({ output: { ...s.output, ...patch }, refineChosen: s.refineChosen || patch.refineLength !== undefined })),
  addLayer: () => {
    const s = get()
    if (s.layers.length >= MAX_LAYERS) return -1
    const L = newLayer(s.nextId)
    set({ layers: [...s.layers, L], active: s.layers.length, nextId: s.nextId + 1 })
    return s.layers.length
  },
  removeLayer: (index) =>
    set((s) => {
      if (s.layers.length <= 1) return { layers: [newLayer(s.nextId)], active: 0, nextId: s.nextId + 1 }
      const layers = s.layers.filter((_, i) => i !== index)
      return { layers, active: Math.min(s.active > index ? s.active - 1 : s.active, layers.length - 1) }
    }),
  setActive: (index) => set((s) => ({ active: Math.max(0, Math.min(index, s.layers.length - 1)) })),
  setVisible: (index, visible) => set((s) => ({ layers: s.layers.map((L, i) => (i === index ? { ...L, visible } : L)) })),
  setBlend: (index, blend) => set((s) => ({ layers: s.layers.map((L, i) => (i === index ? { ...L, blend } : L)) })),
  reset: () => set(initial()),
}))

/** With the scale locked, a new U carries V along — the app's lock button. */
function lockedScale(next: LayerSettings, patch: Partial<LayerSettings>): LayerSettings {
  if (next.lockScale && patch.scaleU !== undefined && patch.scaleV === undefined) return { ...next, scaleV: next.scaleU }
  return next
}

/** The settings the undo history keeps, besides the masks. */
export const HISTORY_KEYS = ['layers', 'active', 'output', 'refineChosen', 'nextId'] as const
