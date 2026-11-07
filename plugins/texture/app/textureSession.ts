// SPDX-License-Identifier: AGPL-3.0-only
// The Texture workspace's working parts: the scan as the engine takes it,
// the textures (BumpMesh's library and your own heightmaps) as the engine
// samples them, a run in the worker with its progress, the textured mesh it
// made, and that mesh on the stage. The panel and the commands both work
// through here, so a button and an agent do the same thing.

import { CommandError, type FileOut, type PluginHost } from '../../../src/plugins/api'
import { cornerPaintFromVertices, unindex, type EngineLayer, type RGBAImage } from '../bumpmesh/engine/index.js'
import { fitImage, prepareMap, PRESET_SIZE, CUSTOM_SIZE } from '../bumpmesh/engine/maps.js'
import { stlBytes, threeMfBytes } from '../bumpmesh/engine/writers.js'
import { IMAGE_PRESETS, type ImagePreset } from '../bumpmesh/js/presetTextures.js'
import { useTexture, type LayerSettings, type TextureLayer, type TextureResult } from '../state/textureStore'
import type { ScanSurface } from './regions'
import { TexturePreview } from '../viewer/previewLayer'
import type { TextureJob, TextureWorkerMessage } from './textureWorker'

// ---- the host ----------------------------------------------------------------------------

let host: PluginHost | null = null
let preview: TexturePreview | null = null

/** Called by the workspace's hook once the app hands it the host. */
export function bindTextureHost(next: PluginHost): void {
  host = next
}

export function textureHost(): PluginHost | null {
  return host
}

function scene() {
  const s = host?.sceneRef.current ?? null
  if (!s) throw new CommandError('unavailable', 'The viewport is not up — the Texture workspace needs the page.')
  return s
}

// ---- the scan ----------------------------------------------------------------------------

const scanIds = new WeakMap<Float32Array, number>()
let nextScanId = 1

/** The scan as one welded surface, or null with none open. */
export function scanSurface(): ScanSurface | null {
  return host?.sceneRef.current?.scanMesh() ?? null
}

export function requireSurface(): ScanSurface {
  const s = scanSurface()
  if (!s) throw new CommandError('no_scan', 'No part is open — open one (scan.open, or Open… in the app) first.')
  return s
}

/** Which scan a result was made of: the same arrays come back while it is the same scan. */
function scanId(s: ScanSurface): number {
  let id = scanIds.get(s.positions)
  if (!id) {
    id = nextScanId++
    scanIds.set(s.positions, id)
  }
  return id
}

export function boundsOf(p: ArrayLike<number>): { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const x = p[i + k]
      if (x < min[k]) min[k] = x
      if (x > max[k]) max[k] = x
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }
}

/** BumpMesh's resolution for a model it opens: the diagonal over 250, 0.05–5 mm. */
export function defaultRefineLength(s: ScanSurface): number {
  const { size } = boundsOf(s.positions)
  const diag = Math.hypot(size[0], size[1], size[2])
  return Math.max(0.05, Math.min(5, +(diag / 250).toFixed(2)))
}

/** BumpMesh's tile for a library texture: its fraction of the part's largest side. */
export function defaultTileMm(s: ScanSurface, fraction: number): number {
  const { size } = boundsOf(s.positions)
  return parseFloat((fraction * Math.max(size[0], size[1], size[2], 1e-6)).toPrecision(3))
}

/** Cylindrical and spherical maps wrap a whole number of tiles round the part (BumpMesh's snap). */
export function seamlessScaleU(settings: LayerSettings, image: RGBAImage | null, s: ScanSurface): number {
  const { size } = boundsOf(s.positions)
  const tmax = Math.max(image?.width ?? 1, image?.height ?? 1, 1)
  const aU = tmax / Math.max(image?.width ?? 1, 1)
  let C: number
  if (settings.mappingMode === 3 || settings.mappingMode === 8) {
    const r = Math.max(settings.cylinderRadius ?? Math.max(size[0], size[1]) * 0.5, 1e-6)
    C = 2 * Math.PI * r
  } else {
    C = 2 * Math.PI * Math.max(0.5 * Math.max(size[0], size[1], size[2]), 1e-6)
  }
  let n = Math.round((aU * C) / Math.max(settings.scaleU, 1e-6))
  if (!Number.isFinite(n) || n < 1) n = 1
  if (n > 200) n = 200
  return parseFloat(((aU * C) / n).toFixed(4))
}

export const wrapsSeamlessly = (s: LayerSettings): boolean => !s.stampOnce && s.snapSeamlessWrap && (s.mappingMode === 3 || s.mappingMode === 4)

// ---- textures ----------------------------------------------------------------------------

const textureUrls = import.meta.glob('../bumpmesh/textures/*.{png,jpg,jpeg,webp}', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const thumbUrls = import.meta.glob('../bumpmesh/textures/thumbs/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const urlOf = (table: Record<string, string>, appPath: string): string | null => table[`../bumpmesh/${appPath}`] ?? null

export const LIBRARY: readonly ImagePreset[] = IMAGE_PRESETS

export function libraryTexture(name: string): ImagePreset {
  const want = name.trim().toLowerCase()
  const hit = LIBRARY.find((p) => p.name.toLowerCase() === want)
  if (hit) return hit
  const near = LIBRARY.filter((p) => p.name.toLowerCase().includes(want)).map((p) => p.name)
  throw new CommandError('not_found', `No library texture is named "${name}".${near.length ? ` Near it: ${near.slice(0, 8).join(', ')}.` : ' texture.textures lists them.'}`)
}

export const thumbOf = (p: ImagePreset): string | null => urlOf(thumbUrls, p.thumb)

const libraryCache = new Map<string, Promise<RGBAImage>>()

/** A library texture's pixels, sized as BumpMesh sizes presets (a canvas fit to 512 px). */
export function libraryImage(name: string): Promise<RGBAImage> {
  const p = libraryTexture(name)
  let hit = libraryCache.get(p.name)
  if (!hit) {
    const url = urlOf(textureUrls, p.url)
    if (!url) throw new CommandError('internal', `The image of ${p.name} is missing from this build.`)
    hit = decodeToCanvas(url, PRESET_SIZE, false)
    hit.catch(() => libraryCache.delete(p.name))
    libraryCache.set(p.name, hit)
  }
  return hit
}

/** Your own heightmaps, by key: the file's bytes (what a project saves) and its pixels. */
const images = new Map<string, { name: string; bytes: Uint8Array; image: RGBAImage }>()
let nextImage = 1

export async function addImage(bytes: Uint8Array, name: string, key?: string): Promise<{ key: string; width: number; height: number }> {
  const blob = new Blob([bytes as BlobPart])
  const url = URL.createObjectURL(blob)
  let image: RGBAImage
  try {
    image = await decodeToCanvas(url, CUSTOM_SIZE, true)
  } catch {
    throw new CommandError('failed', `${name} would not decode as an image — give a PNG or JPEG heightmap (white is high).`)
  } finally {
    URL.revokeObjectURL(url)
  }
  const k = key ?? `img${nextImage++}`
  images.set(k, { name, bytes, image })
  return { key: k, width: image.width, height: image.height }
}

export const imageEntry = (key: string) => images.get(key) ?? null
export const imageKeys = (): string[] => [...images.keys()]
export function forgetImagesExcept(keep: Set<string>): void {
  for (const k of [...images.keys()]) if (!keep.has(k)) images.delete(k)
}

async function decodeToCanvas(url: string, maxSize: number, highQuality: boolean): Promise<RGBAImage> {
  const img = new Image()
  img.src = url
  await img.decode()
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('Image has no size')
  const s = Math.min(maxSize / img.width, maxSize / img.height, 1)
  const w = Math.round(img.width * s), h = Math.round(img.height * s)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return fitImage({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, maxSize)
  if (highQuality) ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h)
  return { data: d.data, width: w, height: h }
}

/** The pixels a layer's texture samples, before its smoothing and invert. */
export async function layerImage(L: TextureLayer): Promise<RGBAImage | null> {
  if (!L.texture) return null
  if (L.texture.kind === 'library') return libraryImage(L.texture.name)
  const e = images.get(L.texture.key)
  if (!e) throw new CommandError('not_found', `The image ${L.texture.name} is not in this session any more — load it again (texture.image).`)
  return e.image
}

// ---- a run -------------------------------------------------------------------------------

/** Engine settings of the output, with the resolution sized to the part unless chosen. */
export function outputFor(s: ScanSurface): Record<string, unknown> {
  const st = useTexture.getState()
  return { ...st.output, refineLength: st.refineChosen ? st.output.refineLength : defaultRefineLength(s) }
}

function fnv(bytes: ArrayLike<number>, h = 2166136261): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i] & 0xff
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/** What a run is made of, as a key: the scan, the layers and their masks, the output. */
export function runKey(kind: 'preview' | 'full', refineLength: number): string {
  const s = scanSurface()
  const st = useTexture.getState()
  const layers = st.layers.map((L) => ({
    t: L.texture,
    s: L.settings,
    m: L.maskMode,
    v: L.visible,
    b: L.blend,
    mask: L.mask ? `${L.mask.length}:${fnv(new Uint8Array(L.mask.buffer, L.mask.byteOffset, L.mask.byteLength)).toString(16)}` : null,
  }))
  return JSON.stringify({ kind, scan: s ? scanId(s) : 0, layers, out: { ...st.output, refineLength } })
}

let worker: Worker | null = null
let running: Promise<TextureResult> | null = null
let last: { key: string; positions: Float32Array; normals: Float32Array | null } | null = null

/** The textured mesh of the last run, while what it was made of still stands. */
export function lastMesh(kind: 'preview' | 'full'): { positions: Float32Array; normals: Float32Array | null } | null {
  const s = scanSurface()
  if (!s || !last) return null
  const st = useTexture.getState()
  const refine = kind === 'full' ? (outputFor(s).refineLength as number) : st.result?.refineLength ?? 0
  return last.key === runKey(kind, refine) ? last : null
}

export const runningNow = (): Promise<TextureResult> | null => running

/** The layers as the engine takes them: pixels prepared, masks per corner. */
async function engineLayers(s: ScanSurface): Promise<EngineLayer[]> {
  const st = useTexture.getState()
  const out: EngineLayer[] = []
  const vertexCount = s.positions.length / 3
  for (const L of st.layers) {
    if (!L.visible || !L.texture) continue
    const img = await layerImage(L)
    if (!img) continue
    out.push({
      image: prepareMap(img, { textureSmoothing: L.settings.textureSmoothing, invertTexture: L.settings.invertTexture }),
      settings: { ...L.settings },
      mask: L.mask || L.maskMode === 'include' ? { mode: L.maskMode, paint: L.mask ? cornerPaintFromVertices(s.indices, vertexCount, L.mask) : null } : null,
      blendAdd: out.length > 0 && L.blend === 'add',
    })
  }
  return out
}

/**
 * Texture the part. `preview` builds at a coarser resolution (previewRefine,
 * or twice the output's, at least the output's) for a quick look; `full` as
 * it would export. Shows the result on the stage when `show`.
 */
export async function runTexture(kind: 'preview' | 'full', opts: { refineLength?: number; show?: boolean; onProgress?: (text: string) => void; signal?: AbortSignal } = {}): Promise<TextureResult> {
  if (running) throw new CommandError('busy', 'A texturing run is going already — wait for it, or stop it (texture.stop).')
  const s = requireSurface()
  const output = outputFor(s)
  const fullRefine = output.refineLength as number
  const refine = kind === 'full' ? fullRefine : Math.max(opts.refineLength ?? fullRefine * 2, fullRefine)
  const key = runKey(kind, refine)
  const layers = await engineLayers(s)
  if (!layers.length) throw new CommandError('invalid_state', 'No layer has a texture — pick one (texture.set { texture }) first.')

  const job: TextureJob = { positions: unindex(s.positions, s.indices), layers, settings: { ...output, refineLength: refine } }
  const t0 = performance.now()
  useTexture.setState({ status: 'running', progress: { stage: 'starting', fraction: 0 }, error: null })
  const work = new Promise<TextureResult>((resolve, reject) => {
    const w = new Worker(new URL('./textureWorker.ts', import.meta.url), { type: 'module' })
    worker = w
    const stop = () => {
      w.terminate()
      reject(new CommandError('failed', 'The texturing run was stopped.'))
    }
    opts.signal?.addEventListener('abort', stop, { once: true })
    w.onmessage = (e: MessageEvent<TextureWorkerMessage>) => {
      const m = e.data
      if (m.type === 'progress') {
        useTexture.setState({ progress: { stage: m.stage, fraction: m.fraction } })
        opts.onProgress?.(`${STAGE_WORDS[m.stage] ?? m.stage} — ${Math.round(m.fraction * 100)}%`)
        return
      }
      w.terminate()
      if (m.type === 'error') return reject(new CommandError('failed', m.message === 'stopped' ? 'The texturing run was stopped.' : `Texturing failed: ${m.message}`))
      last = { key, positions: m.positions, normals: m.normals }
      const result: TextureResult = {
        kind, key, triangles: m.triangles, inputTriangles: m.inputTriangles,
        seconds: Math.round((performance.now() - t0) / 100) / 10, warnings: m.warnings, refineLength: refine,
      }
      resolve(result)
    }
    w.onerror = (e) => {
      w.terminate()
      reject(new CommandError('internal', `The texturing worker failed: ${e.message}`))
    }
    w.postMessage(job, [job.positions.buffer])
  })
  running = work
  try {
    const result = await work
    useTexture.setState({ result })
    if (opts.show !== false) showResult()
    return result
  } catch (e) {
    useTexture.setState({ error: e instanceof Error ? e.message : String(e) })
    throw e
  } finally {
    worker = null
    running = null
    useTexture.setState({ status: 'idle', progress: null })
  }
}

const STAGE_WORDS: Record<string, string> = {
  starting: 'Starting', subdivide1: 'Subdividing', regularize: 'Regularizing', subdivide2: 'Refining', displace: 'Displacing', decimate: 'Decimating', repair: 'Repairing',
}

/** Stop the run going, if one is. */
export function stopTexture(): boolean {
  if (!worker) return false
  worker.terminate()
  worker = null
  return true
}

// ---- the stage ---------------------------------------------------------------------------

function previewLayer(): TexturePreview {
  if (!preview) preview = new TexturePreview(scene())
  return preview
}

export function showResult(): boolean {
  if (!last) return false
  previewLayer().show(last.positions, last.normals)
  useTexture.setState({ previewShown: true })
  return true
}

export function hideResult(): void {
  preview?.clear()
  useTexture.setState({ previewShown: false })
}

export function disposeStage(): void {
  preview?.dispose()
  preview = null
}

// ---- files -------------------------------------------------------------------------------

export async function buildFile(format: 'stl' | '3mf', baseName: string): Promise<FileOut> {
  const mesh = lastMesh('full')
  if (!mesh) throw new CommandError('internal', 'No full-resolution result to write.')
  const name = `${baseName.replace(/\.[a-z0-9]+$/i, '') || 'part'}_textured.${format}`
  if (format === '3mf') return { name, mimeType: 'model/3mf', bytes: await threeMfBytes(mesh.positions) }
  return { name, mimeType: 'model/stl', bytes: stlBytes(mesh.positions, mesh.normals) }
}

// ---- checks ------------------------------------------------------------------------------

/**
 * Whether the surface no layer textures came through untouched: every scan
 * vertex all of whose faces are left plain — masked out on every visible
 * layer — looked for in the output at the same place (0.001 mm). Its
 * neighbours on a textured face may move; those are the edge, reported
 * apart with how far the farthest moved.
 */
export function protectedCheck(): { kept: number; protectedVertices: number; moved: number; worstMm: number; edgeVertices: number; edgeWorstMm: number; worstAt: [number, number, number] | null } | null {
  const s = scanSurface()
  const mesh = lastMesh('full') ?? (last && useTexture.getState().result ? last : null)
  if (!s || !mesh) return null
  const st = useTexture.getState()
  const count = s.positions.length / 3
  // plain[v]: no visible textured layer covers v.
  const plain = new Uint8Array(count).fill(1)
  for (const L of st.layers) {
    if (!L.visible || !L.texture) continue
    const inMask = new Uint8Array(count)
    if (L.mask) for (const v of L.mask) inMask[v] = 1
    for (let v = 0; v < count; v++) {
      const covered = L.maskMode === 'include' ? inMask[v] === 1 : inMask[v] === 0
      if (covered) plain[v] = 0
    }
  }
  // A vertex is protected when every face round it is plain; it is an edge vertex when only some are.
  const allPlain = new Uint8Array(count).fill(1)
  const anyPlainFace = new Uint8Array(count)
  const ix = s.indices
  for (let f = 0; f < ix.length / 3; f++) {
    const a = ix[f * 3], b = ix[f * 3 + 1], c = ix[f * 3 + 2]
    const facePlain = plain[a] && plain[b] && plain[c]
    for (const v of [a, b, c]) {
      if (facePlain) anyPlainFace[v] = 1
      else allPlain[v] = 0
    }
  }
  const grid = new Map<string, number[]>()
  const cell = 0.5
  const p = mesh.positions
  const keyOf = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`
  for (let i = 0; i < p.length; i += 3) {
    const k = keyOf(p[i], p[i + 1], p[i + 2])
    const list = grid.get(k)
    if (list) list.push(i)
    else grid.set(k, [i])
  }
  const nearest = (x: number, y: number, z: number): number => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell)
    let best = Infinity
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`)
      if (!list) continue
      for (const i of list) {
        const d = (p[i] - x) ** 2 + (p[i + 1] - y) ** 2 + (p[i + 2] - z) ** 2
        if (d < best) best = d
      }
    }
    return Math.sqrt(best)
  }
  let protectedVertices = 0, kept = 0, moved = 0, worst = 0, edge = 0, edgeWorst = 0
  let worstAt: [number, number, number] | null = null
  const sp = s.positions
  for (let v = 0; v < count; v++) {
    if (!anyPlainFace[v]) continue
    const d = nearest(sp[v * 3], sp[v * 3 + 1], sp[v * 3 + 2])
    const dist = Number.isFinite(d) ? d : cell * 2
    if (allPlain[v]) {
      protectedVertices++
      if (dist <= 1e-3) kept++
      else {
        moved++
        if (dist > worst) { worst = dist; worstAt = [sp[v * 3], sp[v * 3 + 1], sp[v * 3 + 2]] }
      }
    } else {
      edge++
      if (dist > edgeWorst) edgeWorst = dist
    }
  }
  const r = (x: number) => Math.round(x * 1000) / 1000
  return { kept, protectedVertices, moved, worstMm: r(worst), edgeVertices: edge, edgeWorstMm: r(edgeWorst), worstAt: worstAt ? (worstAt.map(r) as [number, number, number]) : null }
}

export type { TextureLayer }
