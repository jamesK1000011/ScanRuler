// SPDX-License-Identifier: AGPL-3.0-only
// The board's copper as plane shapes, and what is measured on them: which
// pieces touch (the nets, found from the copper itself rather than from the
// file's net names), the clearance between pieces of different nets on a
// layer, and the board's figures.
//
// Every piece of copper is a core — a polygon, a line segment or a point —
// grown by a radius: a trace is a segment grown by half its width, a round
// pad a point grown by its radius, a rounded rectangle its inset rectangle
// grown by its corner radius. The distance between two such is the distance
// between their cores less both radii, which is exact for all of them.

import type { CircuitBoard, Layer, Outline, Pt } from './circuitJson'

export interface Shape {
  /** The core: a closed polygon (3+ points, anticlockwise), a segment (2) or a point (1). */
  core: Pt[]
  r: number
}

export interface Piece {
  shape: Shape
  layer: Layer
  kind: 'pad' | 'plated' | 'via' | 'trace' | 'pour'
  /** The element it came from. */
  ref: string
  box: { x0: number; y0: number; x1: number; y1: number }
}

const rotPt = (x: number, y: number, deg: number): Pt => {
  const a = (deg * Math.PI) / 180
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) }
}

/** A polygon's signed area: above 0 anticlockwise. */
export const areaOf = (p: Pt[]): number => p.reduce((s, a, i) => s + a.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * a.y, 0) / 2

/** An outline as a core and radius. */
export function shapeOf(o: Outline): Shape {
  switch (o.kind) {
    case 'circle':
      return { core: [{ x: o.x, y: o.y }], r: o.r }
    case 'rect': {
      const hw = o.w / 2 - o.r
      const hh = o.h / 2 - o.r
      if (hw <= 1e-9 && hh <= 1e-9) return { core: [{ x: o.x, y: o.y }], r: o.r }
      if (hw <= 1e-9 || hh <= 1e-9) {
        const a = rotPt(hw <= 1e-9 ? 0 : -hw, hh <= 1e-9 ? 0 : -hh, o.rot)
        return { core: [{ x: o.x + a.x, y: o.y + a.y }, { x: o.x - a.x, y: o.y - a.y }], r: o.r }
      }
      const c = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => rotPt(x, y, o.rot))
      return { core: c.map((p) => ({ x: o.x + p.x, y: o.y + p.y })), r: o.r }
    }
    case 'pill': {
      const r = Math.min(o.w, o.h) / 2
      const half = Math.max(o.w, o.h) / 2 - r
      const a = rotPt(o.w >= o.h ? half : 0, o.w >= o.h ? 0 : half, o.rot)
      return half <= 1e-9 ? { core: [{ x: o.x, y: o.y }], r } : { core: [{ x: o.x - a.x, y: o.y - a.y }, { x: o.x + a.x, y: o.y + a.y }], r }
    }
    case 'polygon': {
      const p = o.points.map((q) => ({ ...q }))
      return { core: areaOf(p) < 0 ? p.reverse() : p, r: 0 }
    }
  }
}

/** A trace's segment: grown by half its width — the wider end's, for a taper. */
export const segmentShape = (a: Pt, b: Pt, w0: number, w1: number): Shape => ({ core: a.x === b.x && a.y === b.y ? [a] : [a, b], r: Math.max(w0, w1) / 2 })

function boxOf(s: Shape) {
  const xs = s.core.map((p) => p.x)
  const ys = s.core.map((p) => p.y)
  return { x0: Math.min(...xs) - s.r, y0: Math.min(...ys) - s.r, x1: Math.max(...xs) + s.r, y1: Math.max(...ys) + s.r }
}

// ---- distances -----------------------------------------------------------------------

function segPoint(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y)
}

function segSeg(a: Pt, b: Pt, c: Pt, d: Pt): number {
  // Crossing: no distance.
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0
  return Math.min(segPoint(a, c, d), segPoint(b, c, d), segPoint(c, a, b), segPoint(d, a, b))
}

function inside(p: Pt, poly: Pt[]): boolean {
  let n = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) n = !n
  }
  return n
}

const edges = (core: Pt[]): [Pt, Pt][] => (core.length === 1 ? [[core[0], core[0]]] : core.length === 2 ? [[core[0], core[1]]] : core.map((p, i) => [p, core[(i + 1) % core.length]]))

/** The gap between two shapes; 0 where they touch or overlap. */
export function gap(s: Shape, t: Shape): number {
  if (s.core.length >= 3 && inside(t.core[0], s.core)) return 0
  if (t.core.length >= 3 && inside(s.core[0], t.core)) return 0
  let d = Infinity
  for (const [a, b] of edges(s.core)) for (const [c, e] of edges(t.core)) d = Math.min(d, segSeg(a, b, c, e))
  return Math.max(0, d - s.r - t.r)
}

// ---- the copper -----------------------------------------------------------------------

/** Every piece of copper on the board, layer by layer. */
export function piecesOf(c: CircuitBoard): Piece[] {
  const out: Piece[] = []
  const add = (shape: Shape, layer: Layer, kind: Piece['kind'], ref: string) => out.push({ shape, layer, kind, ref, box: boxOf(shape) })
  for (const p of c.pads) add(shapeOf(p.outline), p.layer, 'pad', p.id)
  for (const h of c.platedHoles) for (const l of h.layers) add(shapeOf(h.pad), l, 'plated', h.id)
  for (const v of c.vias) for (const l of v.layers) add({ core: [{ x: v.x, y: v.y }], r: v.outer / 2 }, l, 'via', v.id)
  for (const t of c.traces) {
    for (const s of t.segments) add(segmentShape(s.a, s.b, s.w0, s.w1), s.layer, 'trace', t.id)
    // A via in a route with no pcb_via of its own: its pads.
    for (const v of t.vias) if (!c.vias.some((x) => Math.hypot(x.x - v.x, x.y - v.y) < 1e-6)) for (const l of [v.from, v.to]) add({ core: [{ x: v.x, y: v.y }], r: (v.outer ?? 0.6) / 2 }, l, 'via', `${t.id} via`)
  }
  for (const p of c.pours) add(shapeOf(p.outline), p.layer, 'pour', p.id)
  return out
}

/** Pairs of pieces on one layer whose boxes come within reach of each
 *  other — a sweep along x, so a board of thousands of pieces is not
 *  every pair. */
function* near(pieces: Piece[], reach: () => number): Generator<[number, number]> {
  const order = pieces.map((_, i) => i).sort((a, b) => pieces[a].box.x0 - pieces[b].box.x0)
  for (let ii = 0; ii < order.length; ii++) {
    const i = order[ii]
    const A = pieces[i]
    for (let jj = ii + 1; jj < order.length; jj++) {
      const j = order[jj]
      const B = pieces[j]
      if (B.box.x0 > A.box.x1 + reach()) break
      if (A.layer !== B.layer) continue
      if (B.box.y0 > A.box.y1 + reach() || A.box.y0 > B.box.y1 + reach()) continue
      yield [i, j]
    }
  }
}

/** The nets the copper makes: pieces that touch on a layer, a hole's or a
 *  via's pads on every layer, and a trace's segments, are one. Each piece's
 *  net by index, numbered from 0. */
export function netsOf(pieces: Piece[]): number[] {
  const up = pieces.map((_, i) => i)
  const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i])))
  const join = (a: number, b: number) => {
    const x = find(a), y = find(b)
    if (x !== y) up[x] = y
  }
  const byRef = new Map<string, number>()
  for (const [i, p] of pieces.entries()) {
    if (p.kind === 'pad' || p.kind === 'pour') continue
    const k = `${p.kind} ${p.ref.replace(/ via$/, '')}`
    const first = byRef.get(k)
    if (first === undefined) byRef.set(k, i)
    else join(first, i)
  }
  for (const [i, j] of near(pieces, () => 1e-6)) if (gap(pieces[i].shape, pieces[j].shape) <= 1e-6) join(i, j)
  const ids = new Map<number, number>()
  return pieces.map((_, i) => {
    const r = find(i)
    if (!ids.has(r)) ids.set(r, ids.size)
    return ids.get(r)!
  })
}

export interface Clearance {
  mm: number
  layer: Layer
  a: { kind: Piece['kind']; ref: string }
  b: { kind: Piece['kind']; ref: string }
  /** Where it is: halfway between the two pieces' cores' nearest points. */
}

/** The least gap between copper of two different nets on one layer. */
export function minClearance(pieces: Piece[], nets: number[]): Clearance | null {
  let best: Clearance | null = null
  let reach = Infinity
  for (const [i, j] of near(pieces, () => reach)) {
    if (nets[i] === nets[j]) continue
    const g = gap(pieces[i].shape, pieces[j].shape)
    if (!best || g < best.mm) {
      best = { mm: g, layer: pieces[i].layer, a: { kind: pieces[i].kind, ref: pieces[i].ref }, b: { kind: pieces[j].kind, ref: pieces[j].ref } }
      reach = g
    }
  }
  return best
}

// ---- figures ---------------------------------------------------------------------------

export interface BoardStats {
  board: { width: number; height: number; thickness: number; area: number; shaped: boolean } | null
  layers: { declared: number | null; withCopper: Layer[] }
  traces: { count: number; segments: number; length: number; byLayer: Record<string, number>; minWidth: number | null; tapered: number }
  pads: number
  platedHoles: number
  holes: number
  vias: number
  components: number
  pours: number
  minDrill: number | null
  nets: number
  minClearance: Clearance | null
  errors: number
  warnings: number
}

const drillSize = (o: Outline): number => (o.kind === 'circle' ? 2 * o.r : o.kind === 'polygon' ? Infinity : Math.min(o.w, o.h))

/** The board's figures, from the JSON alone. */
export function statsOf(c: CircuitBoard, pieces = piecesOf(c), nets = netsOf(pieces)): BoardStats {
  const b = c.boards[0] ?? null
  const byLayer: Record<string, number> = {}
  let length = 0
  let segments = 0
  let minWidth: number | null = null
  let tapered = 0
  for (const t of c.traces)
    for (const s of t.segments) {
      const l = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)
      length += l
      segments++
      byLayer[s.layer] = (byLayer[s.layer] ?? 0) + l
      const w = Math.min(s.w0, s.w1)
      minWidth = minWidth === null ? w : Math.min(minWidth, w)
      if (s.w0 !== s.w1) tapered++
    }
  const drills = [...c.holes.map((h) => drillSize(h.drill)), ...c.platedHoles.map((h) => drillSize(h.drill)), ...c.vias.map((v) => v.drill)].filter(Number.isFinite)
  const order: Layer[] = ['top', ...([1, 2, 3, 4, 5, 6, 7, 8].map((n) => `inner${n}`) as Layer[]), 'bottom']
  return {
    board: b ? { width: b.width, height: b.height, thickness: b.thickness, area: b.outline ? Math.abs(areaOf(b.outline)) : b.width * b.height, shaped: !!b.outline } : null,
    layers: { declared: b?.layers ?? null, withCopper: order.filter((l) => pieces.some((p) => p.layer === l)) },
    traces: { count: c.traces.length, segments, length, byLayer, minWidth, tapered },
    pads: c.pads.length,
    platedHoles: c.platedHoles.length,
    holes: c.holes.length,
    vias: c.vias.length,
    components: c.components.length,
    pours: c.pours.length,
    minDrill: drills.length ? Math.min(...drills) : null,
    nets: new Set(nets).size,
    minClearance: minClearance(pieces, nets),
    errors: c.errors.length,
    warnings: c.warnings.length,
  }
}
