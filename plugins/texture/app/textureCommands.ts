// SPDX-License-Identifier: AGPL-3.0-only
// The Texture workspace's commands — what an agent textures a part through,
// registered under `texture`: texture.set, texture.mask, texture.preview,
// texture.export and the rest. Each is the panel's own code path
// (textureSession.ts, the store's actions); a change is one step of the undo
// history ("Agent: …"), and what the stores hold afterwards comes back.

import { CommandError, type Command } from '../../../src/plugins/api'
import { arr, bool, bytes, enumOf, int, num, obj, oneOf, str, vec3, type JsonSchema } from '../../../src/commands/schema'
import { requireScan } from '../../../src/commands/refs'
import { requireScene } from '../../../src/commands/host'
import { useShell } from '../../../src/state/shellStore'
import { useMark } from '../../../src/state/markStore'
import { useStore } from '../../../src/state/store'
import {
  LAYER_SETTING_KEYS,
  MAX_LAYERS,
  OUTPUT_SETTING_KEYS,
  useTexture,
  type LayerSettings,
  type OutputSettings,
} from '../state/textureStore'
import { combine, DEFAULT_FACING_DEG, DEFAULT_SPREAD_DEG, regionStats, shapeVertices, triArea, type RegionShape } from './regions'
import {
  addImage,
  buildFile,
  defaultTileMm,
  hideResult,
  LIBRARY,
  libraryTexture,
  lastMesh,
  layerImage,
  outputFor,
  protectedCheck,
  requireSurface,
  runningNow,
  runTexture,
  seamlessScaleU,
  showResult,
  stopTexture,
  wrapsSeamlessly,
} from './textureSession'
import { describeLayer, describeTexture, MASK_COLOR } from './textureReadout'

type Json = Record<string, unknown>
const t = () => useTexture.getState()

/** The workspace on screen, as a command that changes it puts it there. */
function onScreen(): void {
  if (useShell.getState().workspace !== 'texture') useShell.getState().setWorkspace('texture')
}

function layerIndex(given: number | undefined): number {
  const n = t().layers.length
  if (given === undefined) return t().active
  if (!Number.isInteger(given) || given < 1 || given > n) throw new CommandError('not_found', `There is no layer ${given} — there ${n === 1 ? 'is 1 layer' : `are ${n} layers`}, numbered from 1.`)
  return given - 1
}

const layerIn = int('The layer, numbered from 1 (bottom); the active one when left out.', { minimum: 1, maximum: MAX_LAYERS })

function notBusy(): void {
  if (runningNow()) throw new CommandError('busy', 'A texturing run is going — wait for it (session.state) or stop it (texture.stop).')
}

// ---- settings --------------------------------------------------------------------------

/** What each setting is, as texture.settings says it and the inputs describe it. */
export const SETTING_MEANINGS: Record<keyof LayerSettings | keyof OutputSettings, string> = {
  mappingMode: 'How the image is laid on the part: 5 triplanar (default — from the three axes, blended), 6 cubic (box), 3 cylindrical (wrapped round Z — handles, grips, bottles), 4 spherical, 0 planar XY (from above), 1 planar XZ, 2 planar YZ (from the sides), 8 outline wrap (follows the part’s outline round Z), 7 surface normal (stamps only).',
  scaleU: 'Tile width, mm — one repeat of the image across.',
  scaleV: 'Tile height, mm.',
  lockScale: 'Keep scaleV equal to scaleU.',
  offsetU: 'Shift the tiling across, as a share of a tile (0–1).',
  offsetV: 'Shift the tiling up, as a share of a tile.',
  rotation: 'Turn the image, degrees.',
  rotateAroundZ: 'Triplanar/cubic: turn the side projections round Z instead of within each side, so a directional pattern heads the same way on every face.',
  textureHeight: 'Depth of the texture, mm: white in the image stands this far proud of the surface (or this far in, with invertDisplacement).',
  invertDisplacement: 'Push the texture into the surface instead of out of it.',
  invertTexture: 'Swap high and low in the image.',
  textureSmoothing: 'Blur the image before it is applied, px of a 512 px tile — softens sharp patterns. 0 off.',
  symmetricDisplacement: 'Displace both ways about the surface, half in and half out — keeps the part’s size.',
  mappingBlend: 'Triplanar/cubic: how softly the projections blend at the seams, 0–1.',
  seamBandWidth: 'Triplanar/cubic: how wide the blend at the seams is.',
  capAngle: 'Cylindrical: faces tipped more than this from the side (degrees) count as end caps.',
  boundaryFalloff: 'Ramp the texture in over this many mm from the edge of a masked region, instead of starting at full depth at the line.',
  boundaryFalloffCurve: 'The ramp’s shape: ease (default, gentlest at the edge), scurve or linear.',
  snapSeamlessWrap: 'Cylindrical/spherical: round scaleU so a whole number of tiles wraps the part, with no seam.',
  cylinderCenterX: 'Cylindrical: the axis’s X, mm (null: the part’s middle).',
  cylinderCenterY: 'Cylindrical: the axis’s Y, mm (null: the part’s middle).',
  cylinderRadius: 'Cylindrical: the radius the tile size is reckoned at, mm (null: half the part’s width).',
  stampOnce: 'Place the image once — a stamp, a logo, a label — instead of tiling it; at stampCenter, scaleU/scaleV wide and high.',
  stampCenterX: 'Stamp: the centre’s X, mm (null: the part’s middle).',
  stampCenterY: 'Stamp: the centre’s Y, mm.',
  stampCenterZ: 'Stamp: the centre’s Z, mm.',
  stampSide: 'Stamp: which side along the projection axis it lands on, 1 or -1 (null: the mode’s own).',
  stampNormalX: 'Stamp in surface-normal mode (7): the surface’s normal at the centre, X.',
  stampNormalY: 'Stamp in surface-normal mode: normal Y.',
  stampNormalZ: 'Stamp in surface-normal mode: normal Z.',
  refineLength: 'Output resolution: the textured surface is cut into edges this long, mm, before it is displaced. Smaller is finer and heavier. Left alone it is the part’s diagonal / 250, as BumpMesh sets it.',
  maxTriangles: 'Triangle budget of the output; the mesh is decimated to it.',
  bottomAngleLimit: 'Leave faces within this many degrees of facing straight down plain — the face the part prints on. 0 off.',
  topAngleLimit: 'Leave faces within this many degrees of facing straight up plain. 0 off.',
  noDownwardZ: 'Never displace downwards — keeps the bed face flat.',
  smoothBottom: 'Snap the bottom flat after displacing.',
  harvestFlatFaces: 'Keep large flat faces as few triangles.',
  preserveUntextured: 'Leave the faces no layer textures exactly as they are — no refining, no decimating. Keep it on for any surface that must fit.',
}

function settingSchema(keys: readonly string[]): JsonSchema {
  const props: Record<string, JsonSchema> = {}
  for (const k of keys) {
    const meaning = SETTING_MEANINGS[k as keyof typeof SETTING_MEANINGS]
    if (k === 'boundaryFalloffCurve') props[k] = enumOf(['linear', 'scurve', 'ease'], meaning)
    else if (['lockScale', 'rotateAroundZ', 'invertDisplacement', 'invertTexture', 'symmetricDisplacement', 'snapSeamlessWrap', 'stampOnce', 'noDownwardZ', 'smoothBottom', 'harvestFlatFaces', 'preserveUntextured'].includes(k)) props[k] = bool(meaning)
    else if (k === 'mappingMode') props[k] = enumOf([0, 1, 2, 3, 4, 5, 6, 7, 8], meaning)
    else if (k === 'maxTriangles') props[k] = int(meaning, { minimum: 1000 })
    else props[k] = { type: ['number', 'null'], description: meaning } as unknown as JsonSchema
  }
  return { type: 'object', properties: props, additionalProperties: false }
}

/** A short schema for the inputs (the full list with meanings is texture.settings's). */
const looseSettings = (what: string, keys: readonly string[]): JsonSchema => ({
  type: 'object',
  description: `${what} Keys: ${keys.join(', ')} — texture.settings says what each means.`,
})

function checkSettings(given: Json | undefined, keys: readonly string[], what: string): Json {
  if (!given) return {}
  const unknown = Object.keys(given).filter((k) => !keys.includes(k))
  if (unknown.length) throw new CommandError('invalid_input', `${what} has no ${unknown.join(', ')}. It takes ${keys.join(', ')}.`)
  const schema = settingSchema(keys)
  for (const [k, v] of Object.entries(given)) {
    const p = schema.properties![k] as JsonSchema & { type?: unknown; enum?: unknown[] }
    if (p.enum && !p.enum.includes(v as never)) throw new CommandError('invalid_input', `${k} is one of ${p.enum.join(', ')}.`)
    if (p.type === 'boolean' && typeof v !== 'boolean') throw new CommandError('invalid_input', `${k} is true or false.`)
    if ((p.type === 'integer' || Array.isArray(p.type)) && v !== null && (typeof v !== 'number' || !Number.isFinite(v))) throw new CommandError('invalid_input', `${k} is a number.`)
  }
  if (typeof given.textureHeight === 'number' && given.textureHeight < 0) throw new CommandError('invalid_input', 'textureHeight is a depth in mm, 0 or more — invertDisplacement pushes it in.')
  if (typeof given.scaleU === 'number' && !(given.scaleU > 0)) throw new CommandError('invalid_input', 'scaleU is a tile width in mm, more than 0.')
  if (typeof given.scaleV === 'number' && !(given.scaleV > 0)) throw new CommandError('invalid_input', 'scaleV is a tile height in mm, more than 0.')
  if (typeof given.refineLength === 'number' && !(given.refineLength >= 0.02)) throw new CommandError('invalid_input', 'refineLength is at least 0.02 mm.')
  return given
}

// ---- commands ---------------------------------------------------------------------------

const textures: Command<{ category?: string; search?: string }> = {
  name: 'textures',
  title: 'List the library textures',
  description:
    'BumpMesh’s texture library: each texture’s name, category (geometric, patterns, organic, fabric, natural, grip, mold, tires) and default tile size as a share of the part’s largest side. For grip surfaces look in grip (Knurling, Grip Surface, Isogrid) and mold (Fine Stipple, Haircell, Hammered, Fine Leather). Changes nothing.',
  input: obj({ category: str('Only this category.'), search: str('Only names containing this, any case.') }),
  readOnly: true,
  headless: true,
  run: async ({ category, search }) => {
    const q = (search ?? '').toLowerCase()
    const list = LIBRARY.filter((p) => (!category || p.category === category) && (!q || p.name.toLowerCase().includes(q)))
    return { count: list.length, textures: list.map((p) => ({ name: p.name, category: p.category, defaultTileShare: p.defaultScale })) }
  },
}

const set: Command<{ layer?: number; texture?: string; settings?: Json; keepScale?: boolean }> = {
  name: 'set',
  title: 'Set a layer’s texture and settings',
  description:
    'Give a layer a library texture by name (texture.textures lists them) and/or change its settings — only the keys given change. A new texture brings its own default tile size (a share of the part’s largest side) unless keepScale or settings sets scaleU. Cylindrical and spherical maps round scaleU so a whole number of tiles wraps the part (snapSeamlessWrap). The main settings: textureHeight (depth mm), scaleU/scaleV (tile mm), rotation, mappingMode, boundaryFalloff; texture.settings has every one with what it means. Opens the Texture workspace. One undo step. Returns the layer.',
  input: obj({
    layer: layerIn,
    texture: str('A library texture’s name, e.g. "Knurling".'),
    settings: looseSettings('The layer’s settings to change.', LAYER_SETTING_KEYS),
    keepScale: bool('Keep the tile size when the texture changes.'),
  }),
  label: ({ texture }) => (texture ? `texture ${texture}` : 'texture settings'),
  run: async ({ layer, texture, settings, keepScale }) => {
    requireScan()
    notBusy()
    const i = layerIndex(layer)
    const patch = checkSettings(settings, LAYER_SETTING_KEYS, 'A layer') as Partial<LayerSettings>
    const s = requireSurface()
    if (texture !== undefined) {
      const p = libraryTexture(texture)
      const sized = keepScale || patch.scaleU !== undefined ? {} : { scaleU: defaultTileMm(s, p.defaultScale), scaleV: defaultTileMm(s, p.defaultScale) }
      t().setTexture(i, { kind: 'library', name: p.name }, { ...sized, ...patch })
    } else if (Object.keys(patch).length) {
      t().setLayerSettings(i, patch)
    } else {
      throw new CommandError('invalid_input', 'Give a texture, settings, or both.')
    }
    await snapWrap(i)
    onScreen()
    return { layer: describeLayer(i, true) }
  },
}

/** Round scaleU for a seamless wrap, as BumpMesh does when the scale or the mode changes. */
async function snapWrap(i: number): Promise<void> {
  const L = t().layers[i]
  if (!L.texture || !wrapsSeamlessly(L.settings)) return
  const s = requireSurface()
  const img = await layerImage(L)
  const u = seamlessScaleU(L.settings, img, s)
  if (Math.abs(u - L.settings.scaleU) > 1e-6) {
    t().setLayerSettings(i, L.settings.lockScale ? { scaleU: u } : { scaleU: u, scaleV: L.settings.scaleV })
  }
}

const image: Command<{ bytes: Uint8Array; name?: string; layer?: number; keepScale?: boolean }> = {
  name: 'image',
  title: 'Use your own heightmap',
  description:
    'Give a layer your own image as its texture — a PNG or JPEG heightmap, white high and black low (colour images are read by their brightness). It is sized to fit 2048 px as BumpMesh sizes uploads, kept in the session and saved with the project. The tile size stays as it was unless the layer had no texture (then a quarter of the part’s largest side); set scaleU after. One undo step.',
  input: obj({ bytes: bytes('The image file.'), name: str('Its file name.'), layer: layerIn, keepScale: bool('Keep the tile size.') }, ['bytes']),
  label: ({ name }) => `texture image ${name ?? ''}`.trim(),
  run: async ({ bytes: data, name, layer, keepScale }) => {
    requireScan()
    notBusy()
    const i = layerIndex(layer)
    const s = requireSurface()
    const { key, width, height } = await addImage(data, name ?? 'heightmap.png')
    const had = t().layers[i].texture !== null
    const sized = keepScale || had ? {} : { scaleU: defaultTileMm(s, 0.25), scaleV: defaultTileMm(s, 0.25) }
    t().setTexture(i, { kind: 'image', name: name ?? 'heightmap.png', key }, sized)
    await snapWrap(i)
    onScreen()
    return { image: { name: name ?? 'heightmap.png', width, height }, layer: describeLayer(i, true) }
  },
}

type RegionIn = 'marked' | RegionShape

const regionSchema: JsonSchema = oneOf(
  [
    enumOf(['marked'], '"marked": the surface marked on the part now — by the person at the screen with the brush, window or lasso, by scan.segment { mark } or element.fit { mark }, or by texture.show_mask.'),
    obj(
      {
        box: obj({ min: vec3('Low corner, mm.'), max: vec3('High corner, mm.') }, ['min', 'max'], 'The vertices inside an axis-aligned box.'),
        sphere: obj({ center: vec3('Centre, mm.'), radius: num('mm.', { exclusiveMinimum: 0 }) }, ['center', 'radius'], 'The vertices within a radius of a point.'),
        vertices: arr(int(undefined, { minimum: 0 }), 'The scan vertices by number.', { minItems: 1 }),
        near: vec3('Grow from the face nearest this point across every edge gentler than spreadDeg — one smooth surface, stopping at creases (BumpMesh’s fill).'),
        spreadDeg: num(`With near: the sharpest edge the fill crosses, degrees (${DEFAULT_SPREAD_DEG} to start; lower keeps to flatter ground).`, { exclusiveMinimum: 0, maximum: 180 }),
        facing: vec3('Of those, only vertices whose normal is within angleDeg of this direction — [0, 0, 1] up.'),
        angleDeg: num(`With facing: degrees (${DEFAULT_FACING_DEG} to start).`, { exclusiveMinimum: 0, maximum: 180 }),
      },
      [],
      'Exactly one of box, sphere, vertices or near; facing and angleDeg narrow it. mm, in the frame the part is measured in now.',
    ),
  ],
  'The surface.',
)

const mask: Command<{ layer?: number; mode?: 'exclude' | 'include'; op?: 'set' | 'add' | 'remove' | 'clear'; region?: RegionIn }> = {
  name: 'mask',
  title: 'Choose where a layer’s texture goes',
  description:
    'Paint the surface a layer is confined to. mode "exclude" (the default): the painted surface stays plain — the faces that must fit, a cutout, a button. mode "include": only the painted surface gets the texture — a grip panel on an otherwise smooth part. Switching mode clears the paint, as BumpMesh does. op: set (replace, default), add, remove, or clear. A face is painted when all three of its corners are. Shows the paint on the part (look with view.render); the person at the screen can then correct it with the brush and you take it back with region "marked". Leave the faces that must fit untouched with preserveUntextured on (texture.output), then texture.check proves it. One undo step. Returns the layer and the painted region’s size.',
  input: obj({
    layer: layerIn,
    mode: enumOf(['exclude', 'include'], 'What painting means on this layer.'),
    op: enumOf(['set', 'add', 'remove', 'clear'], 'How the region combines with the paint there. set by default.'),
    region: regionSchema,
  }),
  label: ({ op, mode }) => `texture mask ${op ?? 'set'}${mode ? ` (${mode})` : ''}`,
  run: async ({ layer, mode, op = 'set', region }) => {
    requireScan()
    notBusy()
    const i = layerIndex(layer)
    const s = requireSurface()
    const count = s.positions.length / 3
    if (mode) t().setMaskMode(i, mode)
    if (op === 'clear') {
      t().setMask(i, null)
    } else {
      if (region === undefined) throw new CommandError('invalid_input', 'Name the region — "marked", or a box, sphere, vertices or near.')
      let vertices: Uint32Array
      if (region === 'marked') {
        vertices = requireScene('A region marked on the part').paintedVertices()
        if (!vertices.length) throw new CommandError('invalid_state', 'Nothing is marked on the part — mark it (scan.segment { mark }, the brush), or name the region with a shape.')
      } else {
        try {
          vertices = shapeVertices(s, region)
        } catch (e) {
          throw new CommandError('invalid_input', e instanceof Error ? e.message : String(e))
        }
        if (!vertices.length) throw new CommandError('invalid_input', 'The region holds no vertex of the part — session.state gives its bounds.')
      }
      const current = t().layers[i].mask
      const next = op === 'set' ? vertices : combine(current, vertices, op === 'add' ? 'add' : 'remove', count)
      t().setMask(i, next)
    }
    onScreen()
    paintMask(i)
    return { layer: describeLayer(i, true) }
  },
}

/** Lay a layer's paint on the part as the marking, in the workspace's colour. */
function paintMask(i: number): number {
  const sc = requireScene('Showing the paint')
  const L = t().layers[i]
  const v = L.mask ?? new Uint32Array(0)
  sc.setPaintedVertices(v, MASK_COLOR)
  useMark.getState().setCount(v.length)
  return v.length
}

const showMask: Command<{ layer?: number }> = {
  name: 'show_mask',
  title: 'Show a layer’s paint on the part',
  description:
    'Lay a layer’s painted surface on the part as the marking, so view.render shows it and the person at the screen can correct it with the brush — then texture.mask { region: "marked" } takes it back. Not a step of the history. Returns how many vertices are painted.',
  input: obj({ layer: layerIn }),
  readOnly: true,
  scene: true,
  run: async ({ layer }) => {
    requireScan()
    const i = layerIndex(layer)
    onScreen()
    return { layer: i + 1, painted: paintMask(i), mode: t().layers[i].maskMode }
  },
}

const layerCmd: Command<{ action: 'add' | 'remove' | 'activate' | 'visible' | 'blend'; layer?: number; visible?: boolean; blend?: 'cover' | 'add' }> = {
  name: 'layer',
  title: 'Add, remove or arrange layers',
  description:
    `Up to ${MAX_LAYERS} layers, bottom first, each with its own texture, settings and paint: a coarse pattern on the body and a fine grip on the panels, say. add (a new layer on top, made active), remove, activate (the layer the other commands act on when they name none), visible (true/false — a hidden layer is left out of the build), blend (cover: a layer replaces the ones below where it reaches; add: adds onto them). One undo step. Returns the layers.`,
  input: obj({
    action: enumOf(['add', 'remove', 'activate', 'visible', 'blend'], 'What to do.'),
    layer: layerIn,
    visible: bool('For visible.'),
    blend: enumOf(['cover', 'add'], 'For blend.'),
  }, ['action']),
  label: ({ action }) => `texture layer ${action}`,
  run: async ({ action, layer, visible, blend }) => {
    notBusy()
    if (action === 'add') {
      if (t().addLayer() < 0) throw new CommandError('invalid_state', `There are ${MAX_LAYERS} layers already — the most there can be.`)
    } else {
      const i = layerIndex(layer)
      if (action === 'remove') t().removeLayer(i)
      else if (action === 'activate') t().setActive(i)
      else if (action === 'visible') {
        if (visible === undefined) throw new CommandError('invalid_input', 'Say visible: true or false.')
        t().setVisible(i, visible)
      } else if (action === 'blend') {
        if (!blend) throw new CommandError('invalid_input', 'Say blend: cover or add.')
        if (i === 0) throw new CommandError('invalid_input', 'The bottom layer has nothing under it to add onto.')
        t().setBlend(i, blend)
      }
    }
    onScreen()
    return { layers: t().layers.map((_, i) => describeLayer(i, false)), active: t().active + 1 }
  },
}

const output: Command<{ settings: Json }> = {
  name: 'output',
  title: 'Set how the textured part is built',
  description:
    'The settings of the whole output: refineLength (resolution, mm — left alone it is the part’s diagonal / 250), maxTriangles (budget), bottomAngleLimit / topAngleLimit (leave faces facing down / up plain, degrees), noDownwardZ, smoothBottom, harvestFlatFaces, preserveUntextured (keep it on for surfaces that must fit). Only the keys given change. One undo step.',
  input: obj({ settings: looseSettings('Output settings to change.', OUTPUT_SETTING_KEYS) }, ['settings']),
  label: () => 'texture output',
  run: async ({ settings }) => {
    notBusy()
    const patch = checkSettings(settings, OUTPUT_SETTING_KEYS, 'The output') as Partial<OutputSettings>
    t().setOutput(patch)
    return { output: describeTexture().output }
  },
}

const settingsCmd: Command<Json> = {
  name: 'settings',
  title: 'Read the texture settings',
  description: 'Every setting of the active layer (or the one named) and of the output, with what each means. Changes nothing.',
  input: obj({ layer: layerIn }),
  readOnly: true,
  run: async ({ layer }) => {
    const i = layerIndex(layer as number | undefined)
    const s = requireSurface()
    const out = outputFor(s)
    return {
      layer: i + 1,
      texture: t().layers[i].texture?.name ?? null,
      settings: t().layers[i].settings,
      output: { ...t().output, refineLength: out.refineLength, refineChosen: t().refineChosen },
      meaning: SETTING_MEANINGS,
    }
  },
}

const estimate: Command<Json> = {
  name: 'estimate',
  title: 'Estimate the output',
  description:
    'Before a long build: how much of the part is textured, how many triangles the textured surface comes to at refineLength before decimation, and whether maxTriangles will squeeze it (then the texture is decimated coarser than refineLength). Changes nothing.',
  input: obj({}),
  readOnly: true,
  run: async () => {
    requireScan()
    const s = requireSurface()
    const out = outputFor(s)
    const L = (out.refineLength as number) || 1
    const { textured, total } = texturedArea(s)
    const perTri = (Math.sqrt(3) / 4) * L * L
    const raw = Math.round(textured / perTri)
    const plainFaces = Math.round((total - textured) > 0 ? (s.indices.length / 3) * ((total - textured) / total) : 0)
    return {
      texturedAreaMm2: Math.round(textured),
      partAreaMm2: Math.round(total),
      refineLength: L,
      subdividedTriangles: raw + plainFaces,
      maxTriangles: out.maxTriangles,
      squeezed: raw + plainFaces > (out.maxTriangles as number),
      note: raw + plainFaces > (out.maxTriangles as number)
        ? 'Decimation will bring it to maxTriangles: raise maxTriangles for the finest result, or raise refineLength to build faster.'
        : 'Fits the budget.',
    }
  },
}

/** Area of the faces some visible textured layer covers, and of the whole part. */
function texturedArea(s: ReturnType<typeof requireSurface>): { textured: number; total: number } {
  const count = s.positions.length / 3
  const covered = new Uint8Array(count)
  for (const L of t().layers) {
    if (!L.visible || !L.texture) continue
    const inMask = new Uint8Array(count)
    if (L.mask) for (const v of L.mask) inMask[v] = 1
    for (let v = 0; v < count; v++) if (L.maskMode === 'include' ? inMask[v] : !inMask[v]) covered[v] = 1
  }
  let textured = 0, total = 0
  const ix = s.indices
  for (let f = 0; f < ix.length / 3; f++) {
    const a = ix[f * 3], b = ix[f * 3 + 1], c = ix[f * 3 + 2]
    const area = triArea(s.positions, a, b, c)
    total += area
    if (covered[a] || covered[b] || covered[c]) textured += area
  }
  return { textured, total }
}

const preview: Command<{ refineLength?: number }> = {
  name: 'preview',
  title: 'Preview the texture on the part',
  description:
    'Build the textured part at a coarser resolution — twice refineLength unless given — and show it on the stage in place of the scan, for view.render to look at. Seconds on most parts; the real thing is texture.export. Not a step of the history. Returns the run.',
  input: obj({ refineLength: num('Resolution of the preview, mm (at least the output’s).', { minimum: 0.02 }) }),
  history: false,
  long: true,
  timeoutMs: 600_000,
  run: async ({ refineLength }, ctx) => {
    requireScan()
    onScreen()
    const r = await runTexture('preview', { refineLength, show: true, onProgress: ctx.progress, signal: ctx.signal })
    return { run: r, shown: true, note: 'texture.show { what: "scan" } puts the scan back.' }
  },
}

const show: Command<{ what: 'result' | 'scan' }> = {
  name: 'show',
  title: 'Show the textured part or the scan',
  description: 'Put the last textured result on the stage (result) or take it off to show the scan (scan). Not a step of the history.',
  input: obj({ what: enumOf(['result', 'scan'], 'What to show.') }, ['what']),
  readOnly: true,
  scene: true,
  run: async ({ what }) => {
    requireScan()
    if (what === 'scan') hideResult()
    else if (!showResult()) throw new CommandError('invalid_state', 'Nothing has been textured yet — texture.preview first.')
    return { shown: what }
  },
}

const exportCmd: Command<{ format?: 'stl' | '3mf' }> = {
  name: 'export',
  title: 'Export the textured part',
  description:
    'Build the textured part at full resolution — or take the last full build, when nothing changed since — and hand it back as a file: STL (default) or 3MF, millimetres, in the frame the part is measured in now. Minutes on a fine resolution: texture.estimate first. Shows it on the stage. Returns the file, the triangle count and any warnings; texture.check then proves the plain surfaces untouched.',
  input: obj({ format: enumOf(['stl', '3mf'], 'File format; stl by default.') }),
  returnsFile: true,
  history: false,
  long: true,
  timeoutMs: 1_800_000,
  run: async ({ format = 'stl' }, ctx) => {
    requireScan()
    onScreen()
    let run = t().result
    if (!lastMesh('full')) run = await runTexture('full', { show: true, onProgress: ctx.progress, signal: ctx.signal })
    else showResult()
    const file = await buildFile(format, scanName())
    return { file, run, triangles: run?.triangles, warnings: run?.warnings ?? [] }
  },
}

function scanName(): string {
  return useStore.getState().fileName ?? 'part'
}

const check: Command<Json> = {
  name: 'check',
  title: 'Check the plain surfaces came through untouched',
  description:
    'After texture.export: every scan vertex whose faces no layer textures — the surfaces masked out on every layer, the ones that must fit — looked for in the output at the same place, to 0.001 mm. Returns how many were kept and how many moved (and the worst, with where), and apart from them the edge vertices where plain meets textured, which may move with the texture beside them (boundaryFalloff softens that). Trustworthy with preserveUntextured on. Changes nothing.',
  input: obj({}),
  readOnly: true,
  long: true,
  run: async () => {
    requireScan()
    const r = protectedCheck()
    if (!r) throw new CommandError('invalid_state', 'Nothing has been built at full resolution for the part as it stands — texture.export first.')
    const ok = r.moved === 0
    return {
      ...r,
      verdict: ok
        ? `All ${r.kept} protected vertices are where they were.`
        : `${r.moved} of ${r.protectedVertices} protected vertices moved, the worst ${r.worstMm} mm at ${JSON.stringify(r.worstAt)}${t().output.preserveUntextured ? '' : ' — preserveUntextured is off, so the plain faces were refined and decimated: turn it on'}.`,
    }
  },
}

const stop: Command<Json> = {
  name: 'stop',
  title: 'Stop the texturing run',
  description: 'Stop a texture.preview or texture.export that is going. Changes nothing else.',
  input: obj({}),
  history: false,
  interrupts: true,
  run: async () => ({ stopped: stopTexture() }),
}

export const textureCommands: readonly Command<never>[] = [textures, set, image, mask, showMask, layerCmd, output, settingsCmd, estimate, preview, show, exportCmd, check, stop] as unknown as Command<never>[]

/** What the plugin is busy with, for the session's guard. */
export function textureBusy(): string | null {
  return useTexture.getState().status === 'running' ? 'the part is being textured' : null
}

export { regionStats }
