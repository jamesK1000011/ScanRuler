// SPDX-License-Identifier: AGPL-3.0-only
// What a trace would measure end to end, in copper or in a printed
// conductor: R = ρ·L / (w·t) for each straight run, a taper integrated
// along its length, and each via's barrel (copper) or filled column
// (printed) through the board. A first figure for printed circuits, which
// the resistivity of the material printed decides — so the printed ones
// are labelled typical.

import type { CircuitBoard, Segment, Trace } from './circuitJson'
import { netsOf, piecesOf, type Piece } from './geometry'

export interface Conductor {
  id: string
  label: string
  /** Ω·mm along the layers (in the board's plane). */
  rhoPlane: number
  /** Ω·mm across them (through the board). */
  rhoThrough: number
  /** The trace's thickness unless one is given, mm. */
  thickness: number
  /** Where the figure comes from. */
  source: string
  typical: boolean
}

/** Ω·cm to Ω·mm. */
const CM = 10

export const CONDUCTORS: Conductor[] = [
  // circuit-json's pcb_stackup: conductivity 5.8e7 S/m (annealed copper) when not given.
  { id: 'copper', label: 'Copper, 1 oz (35 µm)', rhoPlane: 1e3 / 5.8e7, rhoThrough: 1e3 / 5.8e7, thickness: 0.035, source: 'Annealed copper, 5.8 × 10⁷ S/m; 1 oz/ft² is 35 µm.', typical: false },
  { id: 'protopasta', label: 'Protopasta conductive PLA', rhoPlane: 30 * CM, rhoThrough: 115 * CM, thickness: 0.6, source: 'Typical, from the maker’s figures for printed parts: ~30 Ω·cm along the layers, ~115 Ω·cm across them.', typical: true },
  { id: 'electrifi', label: 'Multi3D Electrifi', rhoPlane: 0.006 * CM, rhoThrough: 0.006 * CM, thickness: 0.6, source: 'Typical, from the maker’s figure: ~0.006 Ω·cm.', typical: true },
]

export const conductorOf = (id: string): Conductor | undefined => CONDUCTORS.find((c) => c.id === id)

/** A via's copper plating, the barrel's wall: typical, mm. */
export const PLATING = 0.025

export interface ResistanceOptions {
  conductor: Conductor
  /** The trace's thickness, mm; the conductor's own when left out. */
  thickness?: number
  /** The board's, for the vias, mm. */
  boardThickness: number
}

/** One straight run: ρL/(w·t), or for a linear taper from w0 to w1,
 *  ρL·ln(w1/w0) / (t·(w1 − w0)). */
export function segmentOhms(s: Pick<Segment, 'a' | 'b' | 'w0' | 'w1'>, rho: number, t: number): number {
  const L = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)
  if (Math.abs(s.w1 - s.w0) < 1e-12) return (rho * L) / (s.w0 * t)
  return (rho * L * Math.log(s.w1 / s.w0)) / (t * (s.w1 - s.w0))
}

/** Through the board at a via: copper's plated barrel of drill d, or a
 *  printed conductor's column filling it, across the layers. */
export function viaOhms(drill: number, o: ResistanceOptions): number {
  const r = drill / 2
  if (o.conductor.id === 'copper') {
    const wall = Math.min(PLATING, r)
    return (o.conductor.rhoThrough * o.boardThickness) / (Math.PI * (r * r - (r - wall) * (r - wall)))
  }
  return (o.conductor.rhoThrough * o.boardThickness) / (Math.PI * r * r)
}

export interface TraceOhms {
  trace: string
  length: number
  segments: number
  vias: number
  ohms: number
  viaOhms: number
  minWidth: number | null
}

/** A trace's resistance from its first point to its last, through its vias. */
export function traceOhms(tr: Trace, c: CircuitBoard, o: ResistanceOptions): TraceOhms {
  const t = o.thickness ?? o.conductor.thickness
  let ohms = 0
  let length = 0
  let minWidth: number | null = null
  for (const s of tr.segments) {
    ohms += segmentOhms(s, o.conductor.rhoPlane, t)
    length += Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)
    minWidth = minWidth === null ? Math.min(s.w0, s.w1) : Math.min(minWidth, s.w0, s.w1)
  }
  let vOhms = 0
  for (const v of tr.vias) {
    // The via's drill: the route's, else the pcb_via standing there, else circuit-json's default.
    const drill = v.drill ?? c.vias.find((x) => Math.hypot(x.x - v.x, x.y - v.y) < 1e-6)?.drill ?? 0.25
    vOhms += viaOhms(drill, o)
  }
  return { trace: tr.id, length, segments: tr.segments.length, vias: tr.vias.length, ohms: ohms + vOhms, viaOhms: vOhms, minWidth }
}

export interface NetOhms {
  net: number
  traces: TraceOhms[]
  length: number
  /** Every trace of the net end to end: the most any path through it can be. */
  seriesOhms: number
  /** What the net joins: pads and holes by id. */
  joins: string[]
}

/** Each net's traces and their resistance. A net's traces in series is an
 *  upper bound for a path through it; a trace alone is exact for its own
 *  run. */
export function resistanceByNet(c: CircuitBoard, o: ResistanceOptions, pieces: Piece[] = piecesOf(c), nets: number[] = netsOf(pieces)): NetOhms[] {
  const netOfTrace = new Map<string, number>()
  const joins = new Map<number, Set<string>>()
  for (const [i, p] of pieces.entries()) {
    if (p.kind === 'trace') netOfTrace.set(p.ref, nets[i])
    else if (p.kind === 'pad' || p.kind === 'plated') {
      if (!joins.has(nets[i])) joins.set(nets[i], new Set())
      joins.get(nets[i])!.add(p.ref)
    }
  }
  const by = new Map<number, TraceOhms[]>()
  for (const tr of c.traces) {
    if (!tr.segments.length) continue
    const n = netOfTrace.get(tr.id) ?? -1
    if (!by.has(n)) by.set(n, [])
    by.get(n)!.push(traceOhms(tr, c, o))
  }
  return [...by.entries()]
    .map(([net, traces]) => ({ net, traces, length: traces.reduce((s, t) => s + t.length, 0), seriesOhms: traces.reduce((s, t) => s + t.ohms, 0), joins: [...(joins.get(net) ?? [])] }))
    .sort((a, b) => b.seriesOhms - a.seriesOhms)
}
