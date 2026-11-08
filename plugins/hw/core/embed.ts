// SPDX-License-Identifier: AGPL-3.0-only
// Hardware dropped in mid-print and printed over: the pocket for it, sunk
// under a roof so it is closed all round, and the layer the print pauses
// at so the part can go in. Pure: the command places the pocket and reads
// the body's place on the bed.
//
// Layers: the first is `first` thick, every other `height`. Layer n
// (counted from 1) runs from bottom(n) to top(n) above the bed. The print
// pauses BEFORE the first layer whose bottom is at or above the pocket's
// top: every layer below the top is printed, so the pocket stands open;
// the part goes in; the next layer starts the roof.

import { bearingOf, type Fit, FITS, insertOf, magnetOf, metricOf, sizesOf } from './hardware'
import { type Cut, LEAD, PlanError, r3, type Settings, type Step } from './plan'

export interface Layers {
  /** Every layer's height but the first's, mm. */
  height: number
  /** The first layer's, mm. */
  first: number
}

/** Two heights closer than this are one, mm: a slicer writes Z to the
 *  micron at best. */
export const EPS = 1e-4

const fail = (m: string): never => {
  throw new PlanError(m)
}

export function checkLayers(l: Layers) {
  if (!(Number.isFinite(l.height) && l.height > 0 && l.height <= 2)) fail('layerHeight: more than 0, 2 at most.')
  if (!(Number.isFinite(l.first) && l.first > 0 && l.first <= 2)) fail('firstLayer: more than 0, 2 at most.')
}

/** Where layer n starts, above the bed. */
export const layerBottom = (n: number, l: Layers) => (n <= 1 ? 0 : l.first + (n - 2) * l.height)
/** Where layer n ends: the Z the slicer prints it at. */
export const layerTop = (n: number, l: Layers) => l.first + (n - 1) * l.height

export interface PauseAt {
  /** The layer to pause before, from 1. */
  layer: number
  /** Its bottom: the height the part is dropped in at, mm above the bed. */
  z: number
  /** Its top: the Z the slicer shows it at. */
  printZ: number
  /** The pocket's top lies on a layer boundary. Off one, the layer it
   *  falls in may be printed closed over the pocket, a layer early. */
  onBoundary: boolean
}

/** The layer to pause before, for a pocket whose top is `z` above the bed:
 *  the first whose bottom is at or above it. */
export function pauseLayer(z: number, l: Layers): PauseAt {
  checkLayers(l)
  if (!Number.isFinite(z) || z <= EPS) fail(`The pocket's top is ${r3(z)} above the bed: it has to be above the first layer's bottom.`)
  const layer = z <= l.first + EPS ? 2 : 2 + Math.ceil((z - l.first - EPS) / l.height)
  const bottom = layerBottom(layer, l)
  return { layer, z: r3(bottom), printZ: r3(layerTop(layer, l)), onBoundary: Math.abs(bottom - z) <= EPS }
}

/** The layer boundary at or above z (a pocket's top raised onto it). */
export const boundaryUp = (z: number, l: Layers) => layerBottom(pauseLayer(z, l).layer, l)

/** The layer boundary at or below z, above the first layer's top; null
 *  under it. */
export function boundaryDown(z: number, l: Layers): number | null {
  checkLayers(l)
  if (z < l.first - EPS) return null
  return l.first + Math.floor((z - l.first + EPS) / l.height) * l.height
}

// ---- the pocket ---------------------------------------------------------------------------

export type EmbedKind = 'nut' | 'magnet' | 'bearing' | 'insert' | 'object'
export const EMBED_KINDS: readonly EmbedKind[] = ['nut', 'magnet', 'bearing', 'insert', 'object']

/** Something of one's own to drop in: a box (width along the sheet's u,
 *  length along v, height along the hole) or a cylinder (diameter, height
 *  along the hole). */
export type ObjectSpec = { shape: 'box'; size: [number, number, number]; angleDeg?: number } | { shape: 'cylinder'; diameter: number; height: number }

export interface EncaseSpec {
  kind: EmbedKind
  /** The hardware's size, as hw.plan takes it; not for an object. */
  size?: string
  object?: ObjectSpec
  /** What goes in, in words; the hardware's name by default. */
  what?: string
  /** Material between the pocket and the surface it is cut from, mm. */
  roof: number
  /** In place of the settings' drop clearance, on the diameter or side. */
  clearance?: number
  /** In place of the kind's allowance. */
  allowance?: number
  /** The pocket's depth, in place of the part's height and headroom. */
  depth?: number
  /** A nut: the screw's clearance through it (on by default). */
  shaft?: boolean
  fit?: Fit
  /** A copy count, for the words. */
  count?: number
}

export interface Encased extends Cut {
  /** What to drop in, in words. */
  what: string
  /** The pocket's depth along the hole. */
  height: number
  /** The widest span its roof bridges: a round pocket's diameter, a hex's
   *  across flats, a box's shorter side. */
  span: number
}

/**
 * The pocket for a part dropped in mid-print, sunk `roof` under the
 * surface it is cut from: one step for the pocket (and a nut's shaft).
 * Its width takes the larger of the kind's allowance and the drop
 * clearance; its depth the part's height with headroom above it. `level`:
 * the hole lies near level — its round pocket is teardropped point up.
 */
export function encasedCut(spec: EncaseSpec, settings: Settings, level: boolean): Encased {
  if (!EMBED_KINDS.includes(spec.kind)) fail(`A ${spec.kind} is not dropped in: encase takes ${EMBED_KINDS.join(', ')}.`)
  if (!(Number.isFinite(spec.roof) && spec.roof > 0)) fail('The roof: more than 0.')
  const clear = spec.clearance ?? settings.dropClearance
  if (!(clear >= 0 && clear <= 3)) fail('clearance: 0 to 3.')
  const head = settings.dropHeadroom
  const widen = (allow: number) => Math.max(spec.allowance ?? allow, clear)
  const steps: Step[] = []
  const notes: string[] = []
  let label: string
  let what: string
  let width: number
  let height: number
  let profile: Step['profile'] = 'circle'
  let len: number | undefined
  let angle: number | undefined
  const deep = (part: number, extra: number) => {
    const d = spec.depth ?? part + Math.max(extra, head)
    if (!(d >= part)) fail(`depth ${spec.depth} is less than the part's ${r3(part)}: it would stand proud of the pocket and the nozzle would hit it.`)
    return d
  }
  const sizeOr = (kind: string, size: string | undefined, list: string[]) => `There is no ${kind} "${size ?? ''}" (sizes: ${list.join(', ')}).`
  switch (spec.kind) {
    case 'nut': {
      const m = metricOf(spec.size ?? '') ?? fail(sizeOr('nut', spec.size, sizesOf('nut')))
      const fit = spec.fit ?? settings.fit
      if (!FITS.includes(fit)) fail('fit: fine, medium or coarse.')
      width = m.nut.s + widen(settings.allowance.nut)
      height = deep(m.nut.m, settings.allowance.nut)
      profile = 'hex'
      label = `${m.size} nut`
      what = `an ${m.size} nut`
      if (spec.shaft !== false) steps.push({ role: 'shaft', profile: 'circle', diameter: r3(m.clearance[fit] + settings.allowance.screw), from: -LEAD, to: null })
      notes.push(`ISO 4032 nut, ${m.nut.s} across flats, ${m.nut.m} thick, in a ${r3(width)} × ${r3(height)} pocket.`)
      break
    }
    case 'magnet': {
      const mg = magnetOf(spec.size ?? '') ?? fail(sizeOr('magnet', spec.size, sizesOf('magnet')))
      width = mg.d + widen(settings.allowance.magnet)
      height = deep(mg.t, settings.magnetExtra)
      label = `${mg.size} magnet`
      what = `a ${mg.size} magnet`
      notes.push(`Disc magnet Ø${mg.d} × ${mg.t} in a Ø${r3(width)} × ${r3(height)} pocket. Mark the poles before it goes in.`)
      break
    }
    case 'bearing': {
      const b = bearingOf(spec.size ?? '') ?? fail(sizeOr('bearing', spec.size, sizesOf('bearing')))
      width = b.od + widen(settings.allowance.bearing)
      height = deep(b.width, 0)
      label = `${b.size} bearing`
      what = `a ${b.size} bearing`
      notes.push(`Bearing ${b.size} (${b.od} outside, ${b.width} wide) in a Ø${r3(width)} × ${r3(height)} pocket: a drop fit, not a press fit.`)
      break
    }
    case 'insert': {
      const ins = insertOf(spec.size ?? '') ?? fail(sizeOr('insert', spec.size, sizesOf('insert')))
      width = ins.od + widen(0)
      height = deep(ins.length, settings.insertExtra)
      label = `${ins.size} insert`
      what = `an ${ins.size} insert`
      notes.push(`Insert ${ins.size}, Ø${ins.od} over the knurl (typical), ${ins.length} long, dropped into a Ø${r3(width)} × ${r3(height)} pocket rather than pressed in hot.`)
      break
    }
    case 'object': {
      const o = spec.object ?? fail('object: { shape: "box", size: [width, length, height] } or { shape: "cylinder", diameter, height }.')
      if (spec.size !== undefined) fail('size: hardware’s only — give an object’s object.')
      if (o.shape === 'box') {
        const sz = o.size
        if (!Array.isArray(sz) || sz.length !== 3 || !sz.every((x) => Number.isFinite(x) && x > 0 && x <= 500)) fail('object.size: [width, length, height], each more than 0 and 500 at most.')
        width = sz[0] + clear
        len = sz[1] + clear
        height = deep(sz[2], 0)
        profile = 'rect'
        angle = o.angleDeg ?? 0
        if (!Number.isFinite(angle)) fail('object.angleDeg: a number.')
        label = `${r3(sz[0])} × ${r3(sz[1])} × ${r3(sz[2])} box`
        notes.push(`A pocket ${r3(width)} × ${r3(len)} × ${r3(height)} for a ${label.replace(' box', '')} part.`)
      } else if (o.shape === 'cylinder') {
        if (!(Number.isFinite(o.diameter) && o.diameter > 0 && o.diameter <= 500 && Number.isFinite(o.height) && o.height > 0 && o.height <= 500)) fail('object: diameter and height, each more than 0 and 500 at most.')
        width = o.diameter + clear
        height = deep(o.height, 0)
        label = `Ø${r3(o.diameter)} × ${r3(o.height)} cylinder`
        notes.push(`A Ø${r3(width)} × ${r3(height)} pocket for a Ø${r3(o.diameter)} × ${r3(o.height)} part.`)
      } else return fail('object.shape: box or cylinder.')
      what = label
      break
    }
  }
  const given = spec.what?.trim()
  if (given !== undefined && (given.length === 0 || given.length > 60)) fail('what: 1 to 60 characters.')
  if (given) what = given
  if (spec.count && spec.count > 1) what = `${what} ×${spec.count}`
  const pocket: Step = {
    role: spec.kind === 'nut' ? 'nut' : 'pocket',
    profile,
    diameter: r3(width!),
    from: r3(spec.roof),
    to: r3(spec.roof + height!),
    ...(len !== undefined ? { length: r3(len) } : {}),
    ...(angle ? { angleDeg: angle } : {}),
    ...(level && profile === 'circle' && settings.teardrop ? { teardrop: true } : {}),
  }
  steps.unshift(pocket)
  notes.push(`Encased ${r3(spec.roof)} under the surface: the print pauses at the pocket's top for ${what} to go in, then closes over it.`)
  if (spec.kind === 'nut' && spec.shaft !== false) notes.push('The screw’s clearance runs through the roof and the floor: the nut is held, not sealed.')
  if (pocket.teardrop) notes.push('Level pocket: teardropped, point up, so its roof prints without support.')
  const span = profile === 'rect' ? Math.min(width!, len!) : width!
  return { kind: spec.kind, size: spec.size ?? 'object', label: label!, steps, notes, what: what!, height: r3(height!), span: r3(span) }
}

/** How far a step's outline reaches up (world +Z) from its centre, given
 *  world Z on the sheet ([bU.z, bV.z]). */
export function profileReach(step: Step, upZ: [number, number]): number {
  const k = Math.hypot(upZ[0], upZ[1])
  if (k < 1e-12) return 0
  const r = step.diameter / 2
  if (step.profile === 'circle') return r * k * (step.teardrop ? Math.SQRT2 : 1)
  const pts: [number, number][] = []
  if (step.profile === 'rect') {
    const t = ((step.angleDeg ?? 0) * Math.PI) / 180
    const w = step.diameter / 2, h = (step.length ?? step.diameter) / 2
    for (const [a, b] of [[w, h], [-w, h], [-w, -h], [w, -h]]) pts.push([a * Math.cos(t) - b * Math.sin(t), a * Math.sin(t) + b * Math.cos(t)])
  } else {
    // A hex: stood on a corner (two 60° slopes up) where the hole is level.
    const R = r / Math.cos(Math.PI / 6)
    const up = Math.atan2(upZ[1], upZ[0])
    for (let i = 0; i < 6; i++) pts.push([R * Math.cos(up + (i * Math.PI) / 3), R * Math.sin(up + (i * Math.PI) / 3)])
  }
  return Math.max(...pts.map(([u, v]) => u * upZ[0] + v * upZ[1]))
}

// ---- pauses -------------------------------------------------------------------------------

/** An embedded part's pause, as the schedule takes it. */
export interface PauseItem {
  id: string
  body: string
  what: string
  /** The pocket's top above the bed, mm. */
  z: number
}

export interface Pause extends PauseAt {
  /** The layer finished when it pauses (0 before the first). */
  afterLayer: number
  items: PauseItem[]
  /** What to drop in, for the printer's screen. */
  note: string
}

/** The pauses for a set of pockets: one per layer, those on the same layer
 *  merged, lowest first. */
export function schedule(items: PauseItem[], l: Layers): Pause[] {
  const by = new Map<number, Pause>()
  for (const it of items) {
    const at = pauseLayer(it.z, l)
    const p = by.get(at.layer)
    if (p) {
      p.items.push(it)
      p.onBoundary = p.onBoundary && at.onBoundary
    } else by.set(at.layer, { ...at, afterLayer: at.layer - 1, items: [it], note: '' })
  }
  const out = [...by.values()].sort((a, b) => a.layer - b.layer)
  for (const p of out) p.note = noteOf(p.items.map((i) => i.what))
  return out
}

/** "Insert a 6x3 magnet, an M3 nut" — what a screen shows. The same part
 *  named twice is counted. */
export function noteOf(whats: string[]): string {
  const n = new Map<string, number>()
  for (const w of whats) n.set(w, (n.get(w) ?? 0) + 1)
  return `Insert ${[...n].map(([w, k]) => (k > 1 ? `${w} (${k})` : w)).join(', ')}`
}
