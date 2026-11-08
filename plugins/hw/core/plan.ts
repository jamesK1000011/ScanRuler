// SPDX-License-Identifier: AGPL-3.0-only
// What a fastener's hole is, step by step, before it is placed: each step a
// profile (a circle, a hex, a hex run out to a side slot) cut between two
// depths along the hole's axis — depth 0 the surface it is drilled from,
// positive into the part, null through it. A countersink is a circle with
// its sides leaning in at 45°. The allowance is added to every diameter and
// across-flats (FDM holes print small); the head, insert and pocket depths
// come from the table and the settings. Pure: the command places it.

import { bearingOf, FITS, type Fit, type Head, headsOf, insertOf, type Kind, KINDS, magnetOf, metricOf, sizesOf } from './hardware'

export interface Settings {
  /** Added to each diameter and across-flats, by kind. */
  allowance: Record<Kind, number>
  /** The ISO 273 clearance class. */
  fit: Fit
  /** A counterbore's diameter over the head's. */
  headMargin: number
  /** How far a head sits below the surface. */
  headSink: number
  /** Teardrop the clearance holes whose axis lies near level. */
  teardrop: boolean
  /** A sacrificial layer left at each step of a hole drilled near upright
   *  (0 for none): the floor of a counterbore bridges over it, pushed
   *  through after. */
  bridgeLayer: number
  /** A heat-set insert's hole past the insert's length. */
  insertExtra: number
  /** A magnet's pocket past its thickness. */
  magnetExtra: number
}

export const DEFAULT_SETTINGS: Settings = {
  allowance: { screw: 0.2, nut: 0.2, insert: 0, pilot: 0, magnet: 0.2, bearing: 0.1 },
  fit: 'medium',
  headMargin: 0.4,
  headSink: 0.2,
  teardrop: true,
  bridgeLayer: 0,
  insertExtra: 1,
  magnetExtra: 0.2,
}

export interface Slot {
  /** From the nut's centre to where the slot opens. */
  length: number
  /** Its direction in the sketch's sheet, degrees from +u; the command
   *  works it out from a world direction. */
  angleDeg: number
}

export interface Spec {
  kind: Kind
  size: string
  head?: Head
  fit?: Fit
  /** The hole's depth from the surface; null through. Each kind has its
   *  own default. */
  depth?: number | null
  /** A nut: its near face's depth (0, open at the surface). */
  sunk?: number
  /** A nut: a slot to slide it in from the side. */
  slot?: Slot
  /** A nut: the screw's clearance hole through it too (the default). */
  shaft?: boolean
  /** A bearing: a hole through behind it, clear of the inner race (the
   *  default). */
  relief?: boolean
  /** In place of the kind's allowance. */
  allowance?: number
  /** In place of the setting; true teardrops every round step. */
  teardrop?: boolean
}

export type Profile = 'circle' | 'hex' | 'hexSlot'

export interface Step {
  role: 'head' | 'countersink' | 'shaft' | 'nut' | 'bore' | 'pocket' | 'relief'
  profile: Profile
  /** A circle's diameter; a hex's across flats. */
  diameter: number
  /** Depth the cut starts at; negative above the surface. */
  from: number
  /** Depth it ends at; null through the part. */
  to: number | null
  /** The depth of its sketch's plane; 0 when left out. */
  sketchAt?: number
  /** Sides leaning in going down, degrees: a countersink's 45. */
  draftDeg?: number
  /** Drawn as a teardrop, its point up — set where placed level. */
  teardrop?: boolean
  slot?: Slot
}

export interface Cut {
  kind: Kind
  size: string
  label: string
  steps: Step[]
  /** What the hole is for and how it sits, in words. */
  notes: string[]
}

/** How far a cut starts above the surface, so it opens cleanly. */
export const LEAD = 0.5

const r3 = (x: number) => Math.round(x * 1000) / 1000

export class PlanError extends Error {}
const fail = (m: string): never => {
  throw new PlanError(m)
}

const sizeOr = (kind: Kind, size: string) => `There is no ${kind} "${size}" (sizes: ${sizesOf(kind).join(', ')}).`

/** A kind's label for names and words. */
const HEAD_WORD: Record<Head, string> = { socket: 'cap screw', button: 'button screw', countersunk: 'countersunk screw', none: 'clearance' }

/**
 * The hole a piece of hardware takes, as steps. `level`: the hole's axis
 * lies near level (within 30°), as it is printed — its round clearance
 * steps are teardropped, its hex stood on a corner, and no bridge layer is
 * left (a level hole has no floor to bridge).
 */
export function planCut(spec: Spec, settings: Settings, level: boolean): Cut {
  if (!KINDS.includes(spec.kind)) fail(`There is no kind "${spec.kind}" (kinds: ${KINDS.join(', ')}).`)
  const fit = spec.fit ?? settings.fit
  if (!FITS.includes(fit)) fail(`fit: fine, medium or coarse.`)
  const allow = (k: Kind) => spec.allowance ?? settings.allowance[k]
  const depth = spec.depth
  if (depth !== undefined && depth !== null && !(depth > 0)) fail('depth: more than 0, or null for through.')
  const bridge = !level && settings.bridgeLayer > 0 ? settings.bridgeLayer : 0
  const notes: string[] = []
  const steps: Step[] = []
  let label = ''
  const round = (role: Step['role'], diameter: number, from: number, to: number | null, extra: Partial<Step> = {}): Step => ({ role, profile: 'circle', diameter: r3(diameter), from: r3(from), to: to === null ? null : r3(to), ...extra })
  /** A step below a wider one: from the step's floor, a bridge layer under
   *  it where one is left. */
  let bridged = false
  const below = (floor: number) => {
    if (bridge <= 0) return -LEAD
    bridged = true
    return floor + bridge
  }

  switch (spec.kind) {
    case 'screw': {
      const m = metricOf(spec.size) ?? fail(sizeOr('screw', spec.size))
      const head = spec.head ?? 'socket'
      if (!headsOf(m).includes(head)) fail(`An ${m.size} ${HEAD_WORD[head]} is not in the standard (heads for ${m.size}: ${headsOf(m).join(', ')}).`)
      const clr = m.clearance[fit] + allow('screw')
      label = `${m.size} ${HEAD_WORD[head]}`
      if (head === 'socket' || head === 'button') {
        const h = m[head]!
        const floor = h.k + settings.headSink
        if (depth != null && depth <= floor) fail(`depth ${depth} is within the head's counterbore (${r3(floor)} deep): give more, or null for through.`)
        steps.push(round('head', h.dk + settings.headMargin + allow('screw'), -LEAD, floor))
        steps.push(round('shaft', clr, below(floor), depth ?? null))
        notes.push(`Head Ø${h.dk} × ${h.k} (ISO ${head === 'socket' ? '4762' : '7380'}) sits ${settings.headSink} below the surface in a Ø${r3(h.dk + settings.headMargin + allow('screw'))} counterbore; ${fit} clearance Ø${m.clearance[fit]} (ISO 273).`)
      } else if (head === 'countersunk') {
        const h = m.countersunk!
        const top = h.dk + allow('screw')
        const sink = settings.headSink
        const cone = (top - clr) / 2
        if (depth != null && depth <= sink + cone) fail(`depth ${depth} is within the countersink (${r3(sink + cone)} deep): give more, or null for through.`)
        if (sink > 0) steps.push(round('head', top, -LEAD, sink))
        steps.push(round('countersink', top, sink - LEAD, sink + cone, { sketchAt: sink, draftDeg: 45 }))
        steps.push(round('shaft', clr, -LEAD, depth ?? null))
        notes.push(`90° countersink Ø${r3(top)} at ${sink > 0 ? `${sink} below the surface` : 'the surface'} (ISO 10642 head Ø${h.dk}, ${h.k} high); ${fit} clearance Ø${m.clearance[fit]} (ISO 273).`)
      } else {
        steps.push(round('shaft', clr, -LEAD, depth ?? null))
        notes.push(`${fit} clearance Ø${m.clearance[fit]} (ISO 273) for ${m.size}.`)
      }
      break
    }
    case 'nut': {
      const m = metricOf(spec.size) ?? fail(sizeOr('nut', spec.size))
      const s = m.nut.s + allow('nut')
      const thick = m.nut.m + allow('nut')
      const sunk = spec.sunk ?? 0
      if (sunk < 0) fail('sunk: 0 or more.')
      const slot = spec.slot
      const corner = s / 2 / Math.cos(Math.PI / 6)
      if (slot && !(slot.length >= corner)) fail(`slot.length: from the nut's centre to the part's side — ${r3(corner)} at least for an ${m.size} nut.`)
      if (depth != null && depth < sunk + thick) fail(`depth ${depth} is short of the nut's pocket (${r3(sunk + thick)} deep).`)
      label = `${m.size} nut${slot ? ' slot' : ' trap'}`
      steps.push({ role: 'nut', profile: slot ? 'hexSlot' : 'hex', diameter: r3(s), from: r3(sunk > 0 ? sunk : -LEAD), to: r3(sunk + thick), ...(slot ? { slot } : {}) })
      if (spec.shaft !== false) steps.push(round('shaft', m.clearance[fit] + allow('screw'), sunk > 0 ? -LEAD : below(sunk + thick), depth ?? null))
      notes.push(`ISO 4032 nut, ${m.nut.s} across flats, ${m.nut.m} thick, in a ${r3(s)} × ${r3(thick)} pocket${sunk > 0 ? ` ${sunk} down` : ''}.`)
      if (sunk > 0 && !slot) notes.push(`Buried with no slot: pause the print at the pocket's top, ${r3(sunk + thick)} from this surface, and drop the nut in.`)
      break
    }
    case 'insert': {
      const ins = insertOf(spec.size) ?? fail(sizeOr('insert', spec.size))
      const d = depth === undefined ? ins.length + settings.insertExtra : depth
      if (d !== null && d < ins.length) fail(`depth ${d} is shorter than the ${ins.size} insert (${ins.length} long).`)
      label = `${ins.size} insert`
      steps.push(round('bore', ins.hole + allow('insert'), -LEAD, d))
      notes.push(`Heat-set insert ${ins.size}, ${ins.length} long, in a Ø${r3(ins.hole + allow('insert'))} hole (typical; check your insert's sheet). Leave ${ins.wall} of wall round it at least.`)
      break
    }
    case 'pilot': {
      const m = metricOf(spec.size) ?? fail(sizeOr('pilot', spec.size))
      const d = depth === undefined ? 2 * m.d + 1 : depth
      label = `${m.size} pilot`
      steps.push(round('bore', m.pilot + allow('pilot'), -LEAD, d))
      notes.push(`Pilot Ø${r3(m.pilot + allow('pilot'))} for a thread-forming ${m.size} screw in plastic (typical; test in your material). Walls of 3 perimeters or more give it something to bite.`)
      break
    }
    case 'magnet': {
      const mg = magnetOf(spec.size) ?? fail(sizeOr('magnet', spec.size))
      const d = depth === undefined ? mg.t + settings.magnetExtra : depth
      if (d === null) return fail('A magnet pocket has a floor: give a depth, or leave it out.')
      label = `${mg.size} magnet`
      steps.push(round('pocket', mg.d + allow('magnet'), -LEAD, d))
      notes.push(`Disc magnet Ø${mg.d} × ${mg.t} in a Ø${r3(mg.d + allow('magnet'))} × ${r3(d)} pocket${d < mg.t ? ` — it stands ${r3(mg.t - d)} proud` : ''}. Mark the poles before gluing a pair.`)
      break
    }
    case 'bearing': {
      const b = bearingOf(spec.size) ?? fail(sizeOr('bearing', spec.size))
      const d = depth === undefined ? b.width : depth
      if (d === null) return fail('A bearing pocket has a floor: give a depth, or leave it out; relief cuts through behind it.')
      label = `${b.size} bearing`
      steps.push(round('pocket', b.od + allow('bearing'), -LEAD, d))
      if (spec.relief !== false) steps.push(round('relief', (b.bore + b.od) / 2, below(d), null))
      notes.push(`Bearing ${b.size}: ${b.bore} bore, ${b.od} outside, ${b.width} wide, in a Ø${r3(b.od + allow('bearing'))} × ${r3(d)} pocket${spec.relief !== false ? `, a Ø${r3((b.bore + b.od) / 2)} relief through behind it clear of the inner race` : ''}.`)
      break
    }
  }

  // An allowance taken below nothing: the hole smaller than what goes in it.
  const under = (what: string, hole: number, part: number) => {
    if (hole < part) notes.push(`Warning: the ${what} (${r3(hole)}) is smaller than the hardware (${part}) — check the allowance.`)
  }
  const m = metricOf(spec.size)
  if (m && (spec.kind === 'screw' || spec.kind === 'nut')) {
    const shaft = steps.find((s) => s.role === 'shaft')
    if (shaft) under('clearance hole', shaft.diameter, m.d)
    const head = steps.find((s) => s.role === 'head')
    const h = spec.head ?? 'socket'
    if (head && (h === 'socket' || h === 'button')) under('counterbore', head.diameter, m[h]!.dk)
    const nut = steps.find((s) => s.role === 'nut')
    if (nut) under('nut pocket', nut.diameter, m.nut.s)
  }
  const pocket = steps.find((s) => s.role === 'pocket')
  if (pocket && spec.kind === 'magnet') under('pocket', pocket.diameter, magnetOf(spec.size)!.d)
  const brg = spec.kind === 'bearing' ? bearingOf(spec.size)! : null
  if (pocket && brg && pocket.diameter < brg.od - 0.1) notes.push(`Warning: the seat (${pocket.diameter}) is more than 0.1 under the bearing (${brg.od}) — too tight to press in; check the allowance.`)

  // Teardrops: round steps that are no countersink, on a level hole — the
  // clearance and pilot holes by the setting, every one when asked.
  const tear = spec.teardrop ?? settings.teardrop
  if (level && tear) {
    const plain = new Set<Step['role']>(['head', 'shaft', ...(spec.kind === 'pilot' ? (['bore'] as const) : [])])
    for (const s of steps) if (s.profile === 'circle' && !s.draftDeg && (spec.teardrop === true || plain.has(s.role))) s.teardrop = true
    if (steps.some((s) => s.teardrop)) notes.push('Level hole: teardropped, point up, so its roof prints without support.')
  }
  if (bridged) {
    notes.push(`A ${bridge} layer is left at the step to bridge over: push it through after printing.`)
  }
  return { kind: spec.kind, size: spec.size, label, steps, notes }
}

/** Depth of the deepest blind step, or null when a step runs through. */
export function cutDepth(cut: Cut): number | null {
  return cut.steps.some((s) => s.to === null) ? null : Math.max(...cut.steps.map((s) => s.to as number))
}
