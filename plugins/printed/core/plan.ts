// SPDX-License-Identifier: AGPL-3.0-only
// A printed circuit planned: each net's run — on a sheet (a face or plane of
// the part) or along a 3D route — its width and depth, its pads and vias,
// what it measures end to end, and the Reverse Engineer features that make
// it. Two methods:
//
//   trace    the run is a solid of its own ("Traces"), printed in a
//            conductive filament: one sketch of every outline, extruded as
//            a new body between two depths, pads as columns up to the
//            surface, vias as columns between depths, 3D routes swept; the
//            part then has the traces cut out of it (a Combine cut that
//            keeps the tool), so the two bodies never overlap.
//   channel  the run is cut out of the part for copper: a wire (by AWG or
//            diameter), copper tape, or conductive paint — a groove open at
//            the surface, or a tunnel closed under a roof, laid in at a
//            pause or threaded after printing.
//
// Depth is measured into the part from the sheet: 0 the surface, positive
// under it. Pure: the command reads the sheet and the bodies.

import { type Piece, polylineLength, routeLength, runPieces, turns, type V2, type V3, polylineDistance, MAX_TURN } from './geometry'
import { awgDiameter, copperOhmCm, customMaterial, loadOf, currentFor, type Material, materialOf, resistivityAlong, runResistance, sig } from './materials'

export type Json = Record<string, unknown>
export type Method = 'trace' | 'channel'

export interface Settings {
  /** The conductive filament: a MATERIALS id, or "custom". */
  material: string
  /** "custom": Ω·cm along the layers and through them (null: as along). */
  along: number
  through: number | null
  nozzle: number
  layerHeight: number
  /** Conductor to conductor, edge to edge, mm. */
  clearance: number
  /** A trace's width and thickness, and how far its top lies under the
   *  surface, by default, mm. */
  width: number
  thickness: number
  depth: number
  /** The current the checks are made at, A. */
  current: number
  /** Power per metre of run past which the check warns, W/m. */
  heatWarn: number
  /** Copper's resistivity, Ω·m. */
  copper: number
  /** On a wire's diameter, and on a tape's width and thickness, in its
   *  channel, mm. */
  wireClearance: number
  tapeClearance: number
  /** Layers of roof at least over a closed channel or a buried trace. */
  roofLayers: number
}

export const DEFAULT_SETTINGS: Settings = {
  material: 'protopasta',
  along: 30,
  through: null,
  nozzle: 0.4,
  layerHeight: 0.2,
  clearance: 1,
  width: 2,
  thickness: 0.6,
  depth: 0,
  current: 0.01,
  heatWarn: 1,
  copper: 1.68e-8,
  wireClearance: 0.3,
  tapeClearance: 0.2,
  roofLayers: 3,
}

export class PlanError extends Error {}
const fail = (m: string): never => {
  throw new PlanError(m)
}

const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0
const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0

/** How far a cut open at the surface starts out above it, mm. */
export const LEAD = 0.2

// ---- what goes in ------------------------------------------------------------------------

export type Carrier =
  | { kind: 'wire'; awg?: number; diameter?: number; outer?: number }
  | { kind: 'tape'; width: number; thickness: number }
  | { kind: 'paint'; width?: number; thickness?: number; sheetResistance?: number; resistivity?: number }

export interface Pad {
  at: V2
  shape: 'round' | 'square'
  size: number
  /** A hole through it for a pin or a wire, diameter mm. */
  hole?: number
  /** How deep the hole goes, mm from the surface; through the run by
   *  default. */
  holeDepth?: number
}

export interface Via {
  at: V2
  /** The depth it runs to, mm (0: up to the surface). */
  to: number
  diameter: number
}

export interface Net {
  name: string
  width: number
  /** On the sheet. */
  points?: V2[]
  /** Or a route in the part's frame. */
  path?: V3[]
  pads: Pad[]
  vias: Via[]
}

/** The sheet the runs are drawn on: a plane of the part with its u, v and
 *  normal; depth runs along `into` × normal. */
export interface Sheet {
  /** As reverse.feature.add takes a plane. */
  plane: Json
  origin: V3
  normal: V3
  basisU: V3
  basisV: V3
  into: 1 | -1
}

/** Where a 3D route's profile is sketched: a plane square to its first
 *  straight, through its start, as reverse.feature.add takes one, and
 *  the start on that plane's sheet. `reversed`: the route runs from its
 *  far end. */
export interface ProfileAt {
  plane: Json
  at: V2
  reversed: boolean
}

export interface PlanSpec {
  method: Method
  /** The part's body, by name. */
  body: string
  name: string
  /** trace: the top of the run under the surface (negative stands proud);
   *  channel: the roof over it (0: a groove open at the surface). */
  depth: number
  /** trace: its thickness; channel: its height. */
  thickness?: number
  carrier?: Carrier
  /** channel: the cut's width, in place of the carrier's with clearance. */
  width?: number
  /** A closed channel: laid at a pause (level only) or threaded after. */
  lay?: 'pause' | 'thread'
  bendRadius?: number
  nets: Net[]
}

export const sheetPoint = (s: Sheet, p: V2, depth: number): V3 => [0, 1, 2].map((k) => s.origin[k] + p[0] * s.basisU[k] + p[1] * s.basisV[k] + s.into * depth * s.normal[k]) as V3

// ---- the conductor ------------------------------------------------------------------------

export interface Conductor {
  /** What it is, in words. */
  label: string
  /** Ω·cm along the layers and through them (copper and paint: the same). */
  along: number
  through: number
  /** The conducting cross-section, mm², given a run's width and thickness. */
  area(width: number, thickness: number): number
  material?: Material
}

export function filamentOf(s: Settings): Material {
  if (s.material === 'custom') return customMaterial(s.along, s.through ?? undefined)
  return materialOf(s.material) ?? fail(`There is no material "${s.material}" (printed.list gives them).`)
}

/** A channel's run: the cut's width and height, and its conductor. */
export function channelOf(c: Carrier | undefined, s: Settings, spec: { width?: number; thickness?: number }) {
  if (!c) return fail('carrier: a channel takes { kind: "wire", awg | diameter, outer? }, { kind: "tape", width, thickness } or { kind: "paint", width, … }.')
  const cu = copperOhmCm(s.copper)
  switch (c.kind) {
    case 'wire': {
      if ((c.awg === undefined) === (c.diameter === undefined)) fail('carrier: a wire’s awg or its diameter (the copper’s), one of them.')
      if (c.awg !== undefined && !(Number.isInteger(c.awg) && c.awg >= -3 && c.awg <= 40)) fail('carrier.awg: a whole gauge from 0000 (−3) to 40.')
      const d = c.awg !== undefined ? awgDiameter(c.awg) : c.diameter!
      if (!(d > 0 && d <= 20)) fail('carrier.diameter: more than 0, 20 mm at most.') // units-ok: an agent's input is in mm
      const outer = c.outer ?? d
      if (!(outer >= d && outer <= 30)) fail(`carrier.outer: the wire over its insulation, at least the copper’s ${r3(d)} and 30 at most.`)
      const w = spec.width ?? outer + s.wireClearance
      const h = spec.thickness ?? outer + s.wireClearance
      if (w < outer || h < outer) fail(`The channel (${r3(w)} × ${r3(h)}) is narrower than the wire (${r3(outer)}).`)
      return { width: w, height: h, round: true, conductor: { label: c.awg !== undefined ? `AWG ${c.awg} copper wire (Ø${r3(d)})` : `Ø${r3(d)} copper wire`, along: cu, through: cu, area: () => (Math.PI * d * d) / 4 } as Conductor, notes: c.outer === undefined ? [`The channel is sized for bare or enamelled wire (Ø${r3(d)}): give carrier.outer for an insulated one.`] : [] }
    }
    case 'tape': {
      if (!(c.width > 0 && c.width <= 100 && c.thickness > 0 && c.thickness <= 5)) fail('carrier: a tape’s width (to 100) and thickness (to 5), mm.') // units-ok: an agent's input is in mm
      const w = spec.width ?? c.width + s.tapeClearance
      const h = spec.thickness ?? c.thickness + s.tapeClearance
      if (w < c.width || h < c.thickness) fail(`The channel (${r3(w)} × ${r3(h)}) is smaller than the tape (${r3(c.width)} × ${r3(c.thickness)}).`)
      return { width: w, height: h, round: false, conductor: { label: `${r3(c.width)} × ${r3(c.thickness)} copper tape`, along: cu, through: cu, area: () => c.width * c.thickness } as Conductor, notes: ['Copper tape’s adhesive is usually not conductive: lap joints need solder or a conductive-adhesive tape.'] }
    }
    case 'paint': {
      const w = c.width ?? spec.width ?? s.width
      const t = c.thickness ?? 0.05
      if (!(w > 0 && w <= 100 && t > 0 && t <= 5)) fail('carrier: paint’s width (to 100) and the thickness it dries to (to 5), mm.') // units-ok: an agent's input is in mm
      if ((c.sheetResistance === undefined) === (c.resistivity === undefined)) fail('carrier: paint’s sheetResistance (Ω per square, at its thickness) or resistivity (Ω·cm) — one, from its data sheet or measured.')
      const rho = c.resistivity ?? c.sheetResistance! * (t / 10)
      if (!(rho > 0)) fail('carrier: the paint’s figure has to be more than 0.')
      const h = spec.thickness ?? 0.5
      return { width: w, height: h, round: false, conductor: { label: 'conductive paint', along: rho, through: rho, area: () => w * t } as Conductor, notes: ['Paint goes into an open groove after printing; its figure is what you entered.'] }
    }
  }
  return fail('carrier.kind: wire, tape or paint.')
}

// ---- a net measured ----------------------------------------------------------------------

export interface NetOut {
  name: string
  /** Centreline end to end, mm (a 3D route's with its bends rounded). */
  length: number
  width: number
  thickness: number
  /** Conducting cross-section, mm². */
  area: number
  /** End to end, Ω: the run and a pad's column at each end. */
  resistance: number
  /** Of the run alone, and per metre along the layers. */
  run: number
  terminals: number
  vias: { at: V2; to: number; resistance: number }[]
  /** One mitred outline (else rectangles and discs). */
  mitred?: boolean
  /** At the settings' current. */
  volts: number
  watts: number
  wPerM: number
  /** The current at which the run reaches the heat warning, A. */
  maxCurrent: number
  warnings: string[]
}

/** Resistance of a polyline run of cross-section a: each straight at
 *  its own resistivity by how steeply it climbs. `dzOf` gives a straight's
 *  climb (the Z part of its unit direction). */
function runOhms(pts: number[][], cond: Pick<Conductor, 'along' | 'through'>, a: number, dzOf: (i: number) => number): number {
  let R = 0
  for (let i = 1; i < pts.length; i++) {
    const L = Math.hypot(...pts[i].map((x, k) => x - pts[i - 1][k]))
    R += runResistance(resistivityAlong(cond, dzOf(i)), L, a)
  }
  return R
}

const unitZ = (a: V3, b: V3) => {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const l = Math.hypot(d[0], d[1], d[2])
  return l > 0 ? d[2] / l : 0
}

/** A dimension along world direction e is set by layers where it stands
 *  up (|e_z| ≥ 0.7), by the nozzle where it lies. */
const printedMin = (ez: number, s: Settings) => (Math.abs(ez) >= 0.7 ? { min: 2 * s.layerHeight, hard: s.layerHeight, by: `${s.layerHeight} layers` } : { min: 2 * s.nozzle, hard: s.nozzle, by: `a ${s.nozzle} nozzle` })

export interface Measured {
  nets: NetOut[]
  warnings: string[]
  notes: string[]
}

/**
 * Each net measured: length, cross-section, end-to-end resistance with
 * the pads' columns, the vias, the drop and heat at the current, and the
 * printing checks — width and thickness against the nozzle and layers,
 * the cover over a buried run, clearance between nets.
 */
export function measure(spec: PlanSpec, sheet: Sheet | null, s: Settings, current = s.current): Measured {
  const trace = spec.method === 'trace'
  const ch = trace ? null : channelOf(spec.carrier, s, { width: spec.width, thickness: spec.thickness })
  const cond: Conductor = trace ? (() => {
    const m = filamentOf(s)
    return { label: m.name, along: m.along, through: m.through, area: (w: number, t: number) => w * t, material: m }
  })() : ch!.conductor
  const t = trace ? (spec.thickness ?? s.thickness) : ch!.height
  const notes: string[] = [...(ch?.notes ?? []), ...(cond.material?.notes ?? [])]
  const warnings: string[] = []
  const nz = sheet ? sheet.normal[2] : 0
  const nets: NetOut[] = []
  const minRoof = s.roofLayers * s.layerHeight
  for (const n of spec.nets) {
    const w = trace ? n.width : ch!.width
    const a = cond.area(w, t)
    const warn: string[] = []
    let length: number
    let run: number
    let mitred: boolean | undefined
    if (n.points) {
      if (!sheet) fail(`${n.name}: points on a sheet need on: a face or a plane.`)
      const pts = n.points
      if (pts.length < 2) fail(`${n.name}: two points at least.`)
      const tn = turns(pts)
      const sharp = tn.findIndex((x) => x > MAX_TURN)
      if (sharp >= 0) fail(`${n.name}: the bend at point ${sharp + 1} turns back more than 135° — a mitre there would reach far past the run. Add a point to ease it.`)
      length = polylineLength(pts)
      run = runOhms(pts, cond, a, (i) => {
        const du = pts[i][0] - pts[i - 1][0], dv = pts[i][1] - pts[i - 1][1], l = Math.hypot(du, dv)
        return (du * sheet!.basisU[2] + dv * sheet!.basisV[2]) / l
      })
      mitred = runPieces(pts, w).mitred
      // Width across each straight, thickness along the normal.
      if (trace) {
        for (let i = 1; i < pts.length; i++) {
          const du = pts[i][0] - pts[i - 1][0], dv = pts[i][1] - pts[i - 1][1], l = Math.hypot(du, dv)
          // Across: normal × direction; its Z.
          const d: V3 = [0, 1, 2].map((k) => (du * sheet!.basisU[k] + dv * sheet!.basisV[k]) / l) as V3
          const nn = sheet!.normal
          const acrossZ = nn[0] * d[1] - nn[1] * d[0]
          const m = printedMin(acrossZ, s)
          if (w < m.hard - 1e-9) fail(`${n.name}: ${r3(w)} wide is under one ${m.by === `${s.layerHeight} layers` ? 'layer' : 'line'} (${m.hard}) where it runs ${Math.abs(acrossZ) >= 0.7 ? 'level across a standing face' : 'on the sheet'} — it can’t print.`)
          if (w < m.min - 1e-9) {
            warn.push(`${r3(w)} wide is under ${r3(m.min)} (two lines at ${m.by}): it may print broken.`)
            break
          }
        }
      }
    } else if (n.path) {
      const pts = n.path
      if (pts.length < 2) fail(`${n.name}: a route of two points at least.`)
      const R = spec.bendRadius ?? Math.max(w, t)
      const rl = routeLength(pts, R)
      if (!rl) fail(`${n.name}: a straight of the route is too short for its bends at radius ${r3(R)} — lengthen it, or give a smaller bendRadius.`)
      length = rl!.length
      // Straights shortened at the bends; the arcs taken at the mean climb
      // of the two straights they join.
      run = runOhms(pts, cond, a, (i) => unitZ(pts[i - 1], pts[i])) * (length / polylineLength(pts))
      const tn = turns(pts)
      if (tn.some((x) => x > MAX_TURN)) fail(`${n.name}: a bend of the route turns back more than 135°.`)
      if (trace) {
        const m = printedMin(0, s)
        if (w < m.min - 1e-9) warn.push(`${r3(w)} wide is under ${r3(m.min)} (two lines at ${m.by}): it may print broken.`)
      }
    } else return fail(`${n.name}: give points (on the sheet) or path (a 3D route) — or route it (printed.route).`)
    // The run's thickness, along the sheet's normal.
    if (trace && n.points) {
      const m = printedMin(nz, s)
      if (t < m.hard - 1e-9) fail(`${n.name}: ${r3(t)} thick is under one ${Math.abs(nz) >= 0.7 ? 'layer' : 'line'} (${m.hard}).`)
      if (t < m.min - 1e-9) warn.push(`${r3(t)} thick is under ${r3(m.min)} (${m.by}): it may print broken.`)
      if (Math.abs(nz) >= 0.7) {
        const k = t / s.layerHeight
        if (Math.abs(k - Math.round(k)) > 1e-6) warn.push(`${r3(t)} thick is not a whole number of ${s.layerHeight} layers: the slicer rounds it.`)
      }
    }
    // The pads' columns, surface to the run's middle.
    let terminals = 0
    const ends = n.points ? [n.points[0], n.points[n.points.length - 1]] : []
    const col = Math.max(0, spec.depth) + t / 2
    for (const p of n.pads) {
      const atEnd = ends.some((e) => Math.hypot(e[0] - p.at[0], e[1] - p.at[1]) < 1e-6)
      if (!atEnd) continue
      const pa = p.shape === 'round' ? (Math.PI * p.size * p.size) / 4 : p.size * p.size
      if (trace) terminals += runResistance(resistivityAlong(cond, nz), col, pa)
      else terminals += runResistance(cond.along, Math.max(0, spec.depth) + t / 2, cond.area(w, t))
    }
    const vias = n.vias.map((v) => {
      const L = Math.abs(v.to - (spec.depth + t / 2))
      return { at: v.at, to: v.to, resistance: sig(runResistance(resistivityAlong(cond, nz), L, (Math.PI * v.diameter * v.diameter) / 4)) }
    })
    const R = run + terminals
    const ld = loadOf({ resistance: run, length, current })
    const total = loadOf({ resistance: R, length, current })
    const ohmPerM = run / (length / 1000)
    const heatWarn = s.heatWarn * (cond.material?.maxUseC === undefined && cond.material ? 0.5 : 1)
    if (ld.wPerM > heatWarn) warn.push(`At ${current} A it dissipates ${sig(ld.wPerM)} W per metre (${sig(total.watts)} W in all), over the ${sig(heatWarn)} W/m warning: it will warm the part${cond.material?.maxUseC ? ` (keep it under ${cond.material.maxUseC} °C)` : ''}. Below ${sig(currentFor(ohmPerM, heatWarn))} A it stays under.`)
    // Cover over a buried run, or a closed channel's roof.
    if (spec.depth > 1e-9 && spec.depth < minRoof - 1e-9) warn.push(`${trace ? 'Cover over it' : 'The roof'} is ${r3(spec.depth)}, under ${s.roofLayers} layers (${r3(minRoof)}): it may print thin or open.`)
    for (const p of n.pads) {
      if (p.size < w - 1e-9) warn.push(`Pad at [${p.at.map(r3).join(', ')}] (${r3(p.size)}) is narrower than the run (${r3(w)}).`)
      if (p.hole !== undefined && p.hole >= p.size - 2 * s.nozzle + 1e-9 && trace) warn.push(`Pad at [${p.at.map(r3).join(', ')}]: a ${r3(p.hole)} hole leaves under a line (${s.nozzle}) of ring round it.`)
    }
    nets.push({ name: n.name, length: sig(length), width: r3(w), thickness: r3(t), area: sig(a), resistance: sig(R), run: sig(run), terminals: sig(terminals), vias, ...(mitred !== undefined ? { mitred } : {}), volts: sig(total.volts), watts: sig(total.watts), wPerM: sig(ld.wPerM), maxCurrent: sig(currentFor(ohmPerM, heatWarn)), warnings: warn })
  }
  // Clearance between nets: their centrelines (a sheet's at its middle
  // depth) apart by the half widths and the clearance at least; pads by
  // their half size.
  const shapes = spec.nets.map((n) => {
    const w = trace ? n.width : ch!.width
    const line: V3[] = n.points ? n.points.map((p) => sheetPoint(sheet!, p, spec.depth + t / 2)) : n.path!
    const half = n.points ? w / 2 : Math.max(w, t) / 2
    const pads = sheet ? n.pads.map((p) => ({ at: sheetPoint(sheet!, p.at, spec.depth + t / 2), half: p.shape === 'round' ? p.size / 2 : (p.size / 2) * Math.SQRT2 })) : []
    return { name: n.name, line, half, pads }
  })
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++) {
      const A = shapes[i], B = shapes[j]
      let gap = polylineDistance(A.line, B.line) - A.half - B.half
      for (const p of A.pads) gap = Math.min(gap, polylineDistance([p.at], B.line) - p.half - B.half, ...B.pads.map((q) => polylineDistance([p.at], [q.at]) - p.half - q.half))
      for (const q of B.pads) gap = Math.min(gap, polylineDistance([q.at], A.line) - q.half - A.half)
      if (gap < s.clearance - 1e-6) warnings.push(`${A.name} and ${B.name} come ${r3(Math.max(0, gap))} apart, under the ${s.clearance} clearance${gap <= 1e-9 ? ' — they touch: one conductor' : ''}.`)
    }
  if (trace && s.clearance < 2 * s.nozzle - 1e-9) warnings.push(`A clearance of ${s.clearance} is under two lines (${2 * s.nozzle}): conductive filament oozes, and the gap may bridge.`)
  return { nets, warnings, notes }
}

// ---- features ----------------------------------------------------------------------------

const shapeOf = (p: Piece): Json => (p.kind === 'polygon' ? { kind: 'polyline', points: p.points, closed: true, fixed: true } : { kind: 'circle', center: p.center, radius: p.radius, fixed: true })

export function padPiece(p: Pad, grow = 0): Piece {
  if (p.shape === 'round') return { kind: 'circle', center: p.at, radius: r6(p.size / 2 + grow) }
  const h = p.size / 2 + grow
  return { kind: 'polygon', points: [[p.at[0] - h, p.at[1] - h], [p.at[0] + h, p.at[1] - h], [p.at[0] + h, p.at[1] + h], [p.at[0] - h, p.at[1] + h]].map(([u, v]) => [r6(u), r6(v)] as V2) }
}

/** A depth range as an extrude's offsets along the sketch plane's normal. */
const extentOf = (sheet: Sheet, a: number, b: number): Json => ({ kind: 'distance', from: r6(sheet.into * a), to: r6(sheet.into * b) })

export interface Built {
  features: Json[]
  names: string[]
  /** The feature whose body is the traces (trace method). */
  traces?: string
}

/**
 * The features for a plan: every sketch first (so one on a face finds it
 * as it stood), then the extrudes and sweeps, then the cut of the traces
 * out of the part, then the pads' holes.
 */
export function featuresOf(spec: PlanSpec, sheet: Sheet | null, s: Settings, profiles: Record<string, ProfileAt>): Built {
  const N = spec.name
  const trace = spec.method === 'trace'
  const ch = trace ? null : channelOf(spec.carrier, s, { width: spec.width, thickness: spec.thickness })
  const t = trace ? (spec.thickness ?? s.thickness) : ch!.height
  const sketches: Json[] = []
  const solids: Json[] = []
  const after: Json[] = []
  const planar = spec.nets.filter((n) => n.points)
  const routes = spec.nets.filter((n) => n.path)
  const top = spec.depth
  // A groove open at the surface starts out above it.
  const from = !trace && spec.depth <= 1e-9 ? -LEAD : top
  const tracesName = N
  let made = false
  // The first solid of the traces is the new body, named the plan's name
  // (Reverse Engineer takes a feature's name for its body); the rest join
  // it. A channel's every solid cuts the part.
  const solid = (f: Json) => {
    if (!trace) return solids.push({ ...f, op: 'cut', target: spec.body })
    if (made) return solids.push({ ...f, op: 'join', target: tracesName })
    made = true
    return solids.push({ ...f, name: tracesName, op: 'new' })
  }
  if (planar.length) {
    if (!sheet) fail('Runs on a sheet need on: a face or a plane.')
    const pieces: Json[] = []
    for (const n of planar) {
      const w = trace ? n.width : ch!.width
      pieces.push(...runPieces(n.points!, w).pieces.map(shapeOf))
      // A pad lies in the run's layer too.
      if (trace) pieces.push(...n.pads.map((p) => shapeOf(padPiece(p))))
    }
    sketches.push({ kind: 'sketch', name: `${N} sketch`, plane: sheet!.plane, sketch: { shapes: pieces } })
    solid({ kind: 'extrude', name: trace ? N : `${N} channels`, sketchId: `${N} sketch`, regions: 'all', extent: extentOf(sheet!, from, top + t) })
  }
  const pads = spec.nets.flatMap((n) => (n.points ? n.pads : []))
  // Pads up to the surface: a column of conductor (trace), an exit for
  // the wire (channel).
  if (pads.length && (trace ? top > 1e-9 : true)) {
    sketches.push({ kind: 'sketch', name: `${N} pads sketch`, plane: sheet!.plane, sketch: { shapes: pads.map((p) => shapeOf(padPiece(p))) } })
    solid({ kind: 'extrude', name: `${N} pads`, sketchId: `${N} pads sketch`, regions: 'all', extent: trace ? extentOf(sheet!, Math.min(0, top), top + t / 2) : extentOf(sheet!, -LEAD, top + t / 2) })
  }
  // Vias: columns between the run's middle and another depth, by range.
  const byRange = new Map<string, { a: number; b: number; shapes: Json[] }>()
  for (const n of spec.nets)
    for (const v of n.vias) {
      if (!sheet) fail('Vias are placed on a sheet: give on.')
      const mid = top + t / 2
      const a = Math.min(v.to, mid), b = Math.max(v.to, mid)
      const key = `${r6(a)}:${r6(b)}`
      const g = byRange.get(key) ?? { a: v.to <= 1e-9 && !trace ? -LEAD : a, b, shapes: [] }
      g.shapes.push({ kind: 'circle', center: v.at, radius: r6(v.diameter / 2), fixed: true })
      byRange.set(key, g)
    }
  let k = 0
  for (const g of byRange.values()) {
    k++
    const nm = `${N} vias${byRange.size > 1 ? ` ${k}` : ''}`
    sketches.push({ kind: 'sketch', name: `${nm} sketch`, plane: sheet!.plane, sketch: { shapes: g.shapes } })
    solid({ kind: 'extrude', name: nm, sketchId: `${nm} sketch`, regions: 'all', extent: extentOf(sheet!, g.a, g.b) })
  }
  // 3D routes: a profile square to the first straight, swept.
  for (const n of routes) {
    const p = profiles[n.name] ?? fail(`${n.name}: its profile plane was not found.`)
    const w = trace ? n.width : ch!.width
    const path = p.reversed ? [...n.path!].reverse() : n.path!
    const prof: Json = !trace && ch!.round ? { kind: 'circle', center: p.at, radius: r6(w / 2), fixed: true } : { kind: 'polyline', points: [[-w / 2, -t / 2], [w / 2, -t / 2], [w / 2, t / 2], [-w / 2, t / 2]].map(([u, v]) => [r6(p.at[0] + u), r6(p.at[1] + v)]), closed: true, fixed: true }
    sketches.push({ kind: 'sketch', name: `${N} ${n.name} profile`, plane: p.plane, sketch: { shapes: [prof] } })
    solid({ kind: 'sweep', name: `${N} ${n.name}`, profile: `${N} ${n.name} profile`, route: { points: path.map((q) => q.map(r6)), bendRadius: r6(spec.bendRadius ?? Math.max(w, t)) } })
  }
  if (trace && made && top + t > 1e-9) after.push({ kind: 'boolean', name: `${N} cut`, op: 'cut', body: spec.body, tool: tracesName, keep: true })
  // Holes through pads, for a pin or a wire: out of the traces and the part.
  const holes = pads.filter((p) => p.hole)
  if (holes.length) {
    sketches.push({ kind: 'sketch', name: `${N} holes sketch`, plane: sheet!.plane, sketch: { shapes: holes.map((p) => ({ kind: 'circle', center: p.at, radius: r6(p.hole! / 2), fixed: true })) } })
    const deep = Math.max(...holes.map((p) => p.holeDepth ?? top + t))
    if (trace && made) after.push({ kind: 'extrude', name: `${N} holes`, sketchId: `${N} holes sketch`, regions: 'all', extent: extentOf(sheet!, -LEAD, deep), op: 'cut', target: tracesName })
    after.push({ kind: 'extrude', name: `${N} holes in part`, sketchId: `${N} holes sketch`, regions: 'all', extent: extentOf(sheet!, -LEAD, deep), op: 'cut', target: spec.body })
  }
  const features = [...sketches, ...solids, ...after]
  return { features, names: features.map((f) => f.name as string), ...(trace && made ? { traces: tracesName } : {}) }
}

/** A closed channel's top, Z in the part's frame, on a level sheet: where
 *  the print pauses for the wire. Null where the sheet is not level. */
export function channelTop(sheet: Sheet, roof: number, height: number): number | null {
  if (Math.abs(Math.abs(sheet.normal[2]) - 1) > 1e-6) return null
  const z = (d: number) => sheet.origin[2] + sheet.into * d * sheet.normal[2]
  return r6(Math.max(z(roof), z(roof + height)))
}
