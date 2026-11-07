// SPDX-License-Identifier: AGPL-3.0-only
// Types for BumpMesh's engine (engine/index.js, vendored by scripts/sync-engine.mjs).
export interface RGBAImage { data: Uint8ClampedArray; width: number; height: number }
export interface EngineMask { mode: 'exclude' | 'include'; paint: Float32Array | null }
export interface EngineLayer {
  image: RGBAImage
  settings: Record<string, unknown>
  mask?: EngineMask | null
  blendAdd?: boolean
  visible?: boolean
}
export interface EngineResult {
  positions: Float32Array
  normals: Float32Array | null
  triangles: number
  inputTriangles: number
  warnings: string[]
  repair: { open: number; nonManifold: number; slivers: number; tris: number } | null
}
export const ENGINE_VERSION: string
export const LAYER_KEYS: readonly string[]
export const GLOBAL_KEYS: readonly string[]
export const DEFAULTS: Readonly<Record<string, unknown>>
export const MAPPING_MODES: Readonly<Record<string, number>>
export function layerSettings(s?: Record<string, unknown>): Record<string, unknown>
export function unindex(positions: ArrayLike<number>, indices: ArrayLike<number>): Float32Array
export function cornerPaintFromVertices(indices: ArrayLike<number>, vertexCount: number, vertices: Iterable<number>): Float32Array
export function textureMesh(input: {
  positions: Float32Array
  layers: EngineLayer[]
  settings?: Record<string, unknown>
  centered?: boolean
  onProgress?: (stage: string, fraction: number, info?: unknown) => void
  signal?: AbortSignal
}): Promise<EngineResult | null>
