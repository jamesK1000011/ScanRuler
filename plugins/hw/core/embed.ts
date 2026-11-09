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
import { libraryMaterial, materialsFor } from '../../_shared/materials'

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
  const layer = z <= l.first + PAUSE_EPS ? 2 : 2 + Math.ceil((z - l.first - PAUSE_EPS) / l.height)
  const bottom = layerBottom(layer, l)
  return { layer, z: r3(bottom), printZ: r3(layerTop(layer, l)), onBoundary: Math.abs(bottom - z) <= PAUSE_EPS }
}

/** A pocket's top this close under a layer's bottom pauses before that
 *  layer, mm: as the pauses put into G-code read it (heights there are
 *  written to the micron, 3 places), so the layer named here is the one
 *  the print stops at. */
export const PAUSE_EPS = 0.0015

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
 * the hole lies level — its round or hex pocket gets straight sides up to
 * a flat top (a riser), so the part can be dropped in from above when the
 * print pauses: a teardrop's or a corner's point would close over it first.
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
  // Never narrower than the part, whatever the allowance.
  const part = spec.kind === 'nut' ? metricOf(spec.size!)!.nut.s : spec.kind === 'magnet' ? magnetOf(spec.size!)!.d : spec.kind === 'bearing' ? bearingOf(spec.size!)!.od : spec.kind === 'insert' ? insertOf(spec.size!)!.od : null
  if (part !== null && width! < part) fail(`The pocket (${r3(width!)}) would be narrower than the part (${part}): give a clearance or allowance of 0 or more.`)
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
  }
  // Level: straight sides from the middle up — to the circle's top, or the
  // hex's corner (it stands on one) — and a flat top bridged over the part.
  if (level && (profile === 'circle' || profile === 'hex')) pocket.riser = r3(profile === 'circle' ? width! / 2 : width! / 2 / Math.cos(Math.PI / 6))
  steps.unshift(pocket)
  notes.push(`Encased ${r3(spec.roof)} under the surface: the print pauses at the pocket's top for ${what} to go in, then closes over it.`)
  if (spec.kind === 'nut' && spec.shaft !== false) notes.push('The screw’s clearance runs through the roof and the floor: the nut is held, not sealed.')
  if (pocket.riser) notes.push('Level pocket: straight sides up to a flat top, so the part drops in from above at the pause; its top is bridged.')
  const span = profile === 'rect' ? Math.min(width!, len!) : width!
  return { kind: spec.kind, size: spec.size ?? 'object', label: label!, steps, notes, what: what!, height: r3(height!), span: r3(span) }
}

/** How far a step's outline reaches up (world +Z) from its centre, given
 *  world Z on the sheet ([bU.z, bV.z]). */
export function profileReach(step: Step, upZ: [number, number]): number {
  const k = Math.hypot(upZ[0], upZ[1])
  if (k < 1e-12) return 0
  const r = step.diameter / 2
  const riser = step.riser ? step.riser * k : 0
  if (step.profile === 'circle') return Math.max(riser, r * k * (step.teardrop ? Math.SQRT2 : 1))
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
  return Math.max(riser, ...pts.map(([u, v]) => u * upZ[0] + v * upZ[1]))
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

// ---- the part's own mass ------------------------------------------------------------------

/** A library material's density, g/cm³: the shared library's figure is
 *  the one every workspace weighs that material at. */
function libraryDensity(id: string): number {
  const d = libraryMaterial(id)?.density
  if (d === undefined) throw new Error(`The material library has no density for ${id}${id === 'brass' ? '' : ' (FreeCAD’s cards loaded? partMaterialsReady first)'}.`)
  return d
}

/** What the hardware is made of, g/cm³: steel nuts and bearings (the
 *  library's generic steel) and free-cutting brass inserts (its brass),
 *  read from the shared library when asked — generic steel is a FreeCAD
 *  card, loaded at run time (partMaterialsReady); sintered NdFeB magnets,
 *  which the library has no entry for, a typical figure kept here. */
export const PART_MATERIALS = {
  ndfeb: { label: 'NdFeB', density: 7.5 },
  steel: {
    label: 'steel',
    library: 'steel-generic',
    get density(): number {
      return libraryDensity('steel-generic')
    },
  },
  brass: {
    label: 'brass',
    library: 'brass',
    get density(): number {
      return libraryDensity('brass')
    },
  },
} as const

/** Ready for partSolid of this kind: a nut or a bearing waits for the
 *  library's steel (a FreeCAD card, loaded at run time). */
export function partMaterialsReady(kind: string | undefined): Promise<void> {
  return materialsFor(kind === 'nut' || kind === 'bearing' ? [PART_MATERIALS.steel.library] : [])
}

/** A deep-groove bearing is not solid steel: races, balls and cage come to
 *  about this share of the ring they fill (a 608 weighs about 12 g, its
 *  ring of steel 18). */
export const BEARING_FILL = 0.65

/** One encased part as a solid, about its own centre. */
export interface PartSolid {
  /** What it is made of, in words. */
  material: string
  /** g, one part. */
  mass: number
  /** Its length along the hole, mm: it rests at the pocket's low end. */
  length: number
  /** Moments of inertia about its centre, g·mm²: about the sheet's u and v
   *  (turned by angleDeg on the sheet), and about the hole. */
  moments: [number, number, number]
  angleDeg?: number
  /** Its furthest point from its centre, mm. */
  reach: number
}

/** A prism along the hole, as mass and moments: area A (mm²), second
 *  moments of the section about u, v (mm⁴), height h, density ρ (g/cm³). */
function prism(A: number, Iu: number, Iv: number, h: number, rho: number) {
  const m = (rho * A * h) / 1000
  const k = m / A
  return { m, moments: [k * Iu + (m * h * h) / 12, k * Iv + (m * h * h) / 12, k * (Iu + Iv)] as [number, number, number] }
}
const disc = (r: number) => ({ A: Math.PI * r * r, I: (Math.PI * r ** 4) / 4 })

/** A round part with a bore through it (none at 0). */
function ring(od: number, bore: number, h: number, rho: number) {
  const o = disc(od / 2), i = disc(bore / 2)
  const a = prism(o.A, o.I, o.I, h, rho)
  if (!(bore > 0)) return a
  const b = prism(i.A, i.I, i.I, h, rho)
  return { m: a.m - b.m, moments: [0, 1, 2].map((k) => a.moments[k] - b.moments[k]) as [number, number, number] }
}

/**
 * The part that goes into an encased pocket, as a solid: its mass, where
 * its centre sits along the hole, and its moments — from the table's size
 * and the kind's usual material (a nut as an ISO 4032 hex with its bore, a
 * bearing a ring at BEARING_FILL, an insert a brass ring over the screw).
 * grams, when given, is what one weighs: it scales the figures (an
 * object's density is worked out from it). An object without grams, or a
 * size the table has not, gives null: its mass is not known.
 */
export function partSolid(kind: string, size?: string, object?: ObjectSpec, grams?: number): PartSolid | null {
  let s: { m: number; moments: [number, number, number] }
  let length: number
  let reach: number
  let material: string
  let angleDeg: number | undefined
  const reachOf = (r: number, h: number) => Math.hypot(r, h / 2)
  if (kind === 'magnet') {
    const mg = magnetOf(size ?? '')
    if (!mg) return null
    s = ring(mg.d, 0, mg.t, PART_MATERIALS.ndfeb.density)
    length = mg.t
    reach = reachOf(mg.d / 2, mg.t)
    material = PART_MATERIALS.ndfeb.label
  } else if (kind === 'nut') {
    const m = metricOf(size ?? '')
    if (!m) return null
    // A regular hexagon across flats s: area √3/2 s², second moment about
    // any line through its centre 5√3/144 s⁴.
    const sf = m.nut.s
    const hex = prism((Math.sqrt(3) / 2) * sf * sf, ((5 * Math.sqrt(3)) / 144) * sf ** 4, ((5 * Math.sqrt(3)) / 144) * sf ** 4, m.nut.m, PART_MATERIALS.steel.density)
    const bore = ring(m.d, 0, m.nut.m, PART_MATERIALS.steel.density)
    s = { m: hex.m - bore.m, moments: [0, 1, 2].map((k) => hex.moments[k] - bore.moments[k]) as [number, number, number] }
    length = m.nut.m
    reach = reachOf(sf / Math.sqrt(3), m.nut.m)
    material = PART_MATERIALS.steel.label
  } else if (kind === 'bearing') {
    const b = bearingOf(size ?? '')
    if (!b) return null
    const r = ring(b.od, b.bore, b.width, PART_MATERIALS.steel.density)
    s = { m: r.m * BEARING_FILL, moments: r.moments.map((x) => x * BEARING_FILL) as [number, number, number] }
    length = b.width
    reach = reachOf(b.od / 2, b.width)
    material = PART_MATERIALS.steel.label
  } else if (kind === 'insert') {
    const ins = insertOf(size ?? '')
    const thread = metricOf((size ?? '').split(' ')[0])
    if (!ins || !thread) return null
    s = ring(ins.od, thread.d, ins.length, PART_MATERIALS.brass.density)
    length = ins.length
    reach = reachOf(ins.od / 2, ins.length)
    material = PART_MATERIALS.brass.label
  } else if (kind === 'object' && object && grams !== undefined) {
    if (object.shape === 'box') {
      const [w, l, h] = object.size
      s = prism(w * l, (w * l ** 3) / 12, (l * w ** 3) / 12, h, 1)
      length = h
      reach = Math.hypot(w, l, h) / 2
      angleDeg = object.angleDeg
    } else {
      s = ring(object.diameter, 0, object.height, 1)
      length = object.height
      reach = reachOf(object.diameter / 2, object.height)
    }
    material = 'as weighed'
  } else return null
  if (grams !== undefined) {
    if (!(Number.isFinite(grams) && grams > 0)) return null
    const k = grams / s.m
    s = { m: grams, moments: s.moments.map((x) => x * k) as [number, number, number] }
    if (kind !== 'object') material = `${material}, as weighed`
  }
  return { material, mass: s.m, length, moments: s.moments, ...(angleDeg ? { angleDeg } : {}), reach }
}

type M3 = [V3, V3, V3]
type V3 = [number, number, number]

/** A part's inertia about its centre in the part's frame, g·mm²: its
 *  moments about the sheet's u and v (turned by its angle) and the hole's
 *  direction. */
export function inertiaOf(p: PartSolid, direction: V3, basisU: V3, basisV: V3): M3 {
  const t = ((p.angleDeg ?? 0) * Math.PI) / 180
  const u = [0, 1, 2].map((i) => Math.cos(t) * basisU[i] + Math.sin(t) * basisV[i])
  const v = [0, 1, 2].map((i) => -Math.sin(t) * basisU[i] + Math.cos(t) * basisV[i])
  const axes = [u, v, direction]
  const I: M3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]
  for (let k = 0; k < 3; k++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) I[i][j] += p.moments[k] * axes[k][i] * axes[k][j]
  return I
}

/** Where the part's centre sits along the hole, from the surface, in a
 *  pocket running from `from` to `to`: it rests at the end lower in Z (dz,
 *  the hole's direction's Z), or in the middle of a level one. */
export function restDepth(from: number, to: number, length: number, dz: number): number {
  if (dz < -1e-6) return to - length / 2
  if (dz > 1e-6) return from + length / 2
  return (from + to) / 2
}
